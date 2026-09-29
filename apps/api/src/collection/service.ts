import type { AppConfig } from "@anveshan/config";
import { requireHackerOneCredentials } from "@anveshan/config";
import type { Db } from "@anveshan/database";
import {
  advisoryUnlock,
  bulkInsertAssetSnapshots,
  bulkInsertProgramSnapshots,
  bulkUpsertAssets,
  bulkUpsertPrograms,
  completeRun,
  countCompletedRuns,
  countPrograms,
  createDb,
  createRun,
  failRun,
  failStaleRunningRuns,
  findAllPrograms,
  findLiveAssetsByProgramIds,
  insertChange,
  markMissingAssetsOut,
  setPersistStatementTimeout,
  tryAdvisoryLock,
} from "@anveshan/database";
import type { UpsertAssetInput } from "@anveshan/database";
import type { Pool } from "pg";
import type { Logger } from "pino";
import { CollectorError, HackerOneClient, HackerOneCollector } from "@anveshan/collector";
import type { ProgramCollector } from "@anveshan/collector";
import { PLATFORM_HACKERONE, assetKey, diffProgram } from "@anveshan/domain";
import type { CollectedProgram, PreviousProgramState } from "@anveshan/domain";

export type CollectionStatus = "completed" | "failed" | "skipped";

export interface CollectionSummary {
  runId: string | null;
  status: CollectionStatus;
  programsSeen: number;
  assetsSeen: number;
  programsAdded: number;
  assetsAdded: number;
  assetsRemoved: number;
  errorCode?: string;
  errorMessage?: string;
}

export interface RunCollectionDeps {
  config: AppConfig;
  pool: Pool;
  /** Injected in tests; defaults to the real HackerOne collector. */
  collector?: ProgramCollector;
  logger: Logger;
  /**
   * Fetch scopes for at most N programs (live-test/debug aid that keeps
   * manual runs cheap). Production leaves this unset (all programs).
   */
  maxPrograms?: number;
}

interface FetchedProgram {
  program: CollectedProgram;
  assets: Awaited<ReturnType<ProgramCollector["getProgramAssets"]>>;
}

/** Bound each persist statement: a hang fails loudly instead of orphaning. */
const PERSIST_STATEMENT_TIMEOUT_MS = 60_000;

/**
 * One collection run. Implements docs/snapshot-algorithm.md §6:
 * session lock → stale recovery → fetch (no tx) → short persist tx.
 * Fail-closed: any fetch failure marks the run failed with zero live changes.
 */
export async function runCollection(deps: RunCollectionDeps): Promise<CollectionSummary> {
  const { config, pool, logger } = deps;
  const client = await pool.connect();
  const sessionDb = createDb(client);
  try {
    const locked = await tryAdvisoryLock(sessionDb);
    if (!locked) {
      logger.warn("collection already running, skipping");
      return {
        runId: null,
        status: "skipped",
        programsSeen: 0,
        assetsSeen: 0,
        programsAdded: 0,
        assetsAdded: 0,
        assetsRemoved: 0,
      };
    }
    try {
      await failStaleRunningRuns(sessionDb, config.COLLECTION_STALE_RUNNING_MS);
      const run = await createRun(sessionDb);
      const runLogger = logger.child({ collection: run.id });
      runLogger.info("starting collection");
      try {
        const summary = await fetchAndPersist(deps, sessionDb, run.id, runLogger);
        runLogger.info(
          {
            programsSeen: summary.programsSeen,
            assetsSeen: summary.assetsSeen,
            programsAdded: summary.programsAdded,
            assetsAdded: summary.assetsAdded,
            assetsRemoved: summary.assetsRemoved,
          },
          "collection completed",
        );
        return summary;
      } catch (error) {
        const { code, message } = classifyError(error);
        try {
          await failRun(sessionDb, run.id, code, message);
        } catch (failError) {
          runLogger.error({ err: failError }, "failed to mark run as failed");
        }
        runLogger.error({ err: error, errorCode: code }, "collection failed");
        return {
          runId: run.id,
          status: "failed",
          programsSeen: 0,
          assetsSeen: 0,
          programsAdded: 0,
          assetsAdded: 0,
          assetsRemoved: 0,
          errorCode: code,
          errorMessage: message,
        };
      }
    } finally {
      try {
        await advisoryUnlock(sessionDb);
      } catch (error) {
        logger.error({ err: error }, "failed to release collection lock");
      }
    }
  } finally {
    client.release();
  }
}

async function fetchAndPersist(
  deps: RunCollectionDeps,
  sessionDb: Db,
  runId: string,
  runLogger: Logger,
): Promise<CollectionSummary> {
  const { config } = deps;

  // --- fetch (minutes; rate-limited; NO transaction) ---
  const collector = deps.collector ?? createRealCollector(config, runLogger);
  const h1ProgramsAll = await collector.getPrograms();
  const h1Programs =
    deps.maxPrograms !== undefined
      ? h1ProgramsAll.slice(0, deps.maxPrograms)
      : h1ProgramsAll;
  runLogger.info({ programsDiscovered: h1Programs.length }, "fetching program scopes");
  const incoming: FetchedProgram[] = [];
  for (const program of h1Programs) {
    const assets = await collector.getProgramAssets(program.externalId);
    incoming.push({ program, assets });
  }
  const assetsDiscovered = incoming.reduce((n, p) => n + p.assets.length, 0);
  runLogger.info(
    { programsDiscovered: incoming.length, assetsDiscovered },
    "fetch complete",
  );

  const completedRuns = await countCompletedRuns(sessionDb);
  const programCount = await countPrograms(sessionDb);
  const isFirst = completedRuns === 0 || programCount === 0;

  // --- persist (bulk statements; single transaction preserves atomicity) ---
  const stats = await sessionDb.transaction(async (tx) => {
    await setPersistStatementTimeout(tx, PERSIST_STATEMENT_TIMEOUT_MS);

    const prevPrograms = await findAllPrograms(tx);
    const prevByKey = new Map(
      prevPrograms.map((p) => [`${p.platform}|${p.externalIdLower}`, p.id]),
    );
    // One preload for every previously-seen program (diff-before-upsert).
    const prevLive = await findLiveAssetsByProgramIds(tx, [...prevByKey.values()]);
    const prevInByProgram = new Map<string, Map<string, string>>();
    const prevIdByProgram = new Map<string, Map<string, string>>();
    for (const live of prevLive) {
      let inMap = prevInByProgram.get(live.programId);
      if (!inMap) {
        inMap = new Map<string, string>();
        prevInByProgram.set(live.programId, inMap);
      }
      if (live.scope === "IN") inMap.set(live.assetKey, live.identifier);
      let idMap = prevIdByProgram.get(live.programId);
      if (!idMap) {
        idMap = new Map<string, string>();
        prevIdByProgram.set(live.programId, idMap);
      }
      idMap.set(live.assetKey, live.id);
    }
    runLogger.info(
      { programs: prevPrograms.length, liveAssets: prevLive.length },
      "previous state loaded",
    );

    const programRows = await bulkUpsertPrograms(
      tx,
      incoming.map(({ program }) => ({
        platform: PLATFORM_HACKERONE,
        externalId: program.externalId,
        name: program.name,
        url: program.url,
        externalNumericId: program.externalNumericId,
      })),
    );
    runLogger.info({ programs: programRows.size }, "programs upserted");
    await bulkInsertProgramSnapshots(
      tx,
      runId,
      [...programRows.values()].map((row) => row.id),
    );

    const assetInputs: UpsertAssetInput[] = [];
    const seenByProgram = new Map<string, string[]>();
    for (const { program, assets } of incoming) {
      const key = `${PLATFORM_HACKERONE}|${program.externalId.toLowerCase()}`;
      const row = programRows.get(key);
      if (!row) throw new Error(`bulkUpsertPrograms returned no row for ${key}`);
      const seenKeys: string[] = [];
      for (const asset of assets) {
        assetInputs.push({
          programId: row.id,
          externalId: asset.externalId,
          identifier: asset.identifier,
          normalizedIdentifier: asset.identifier,
          type: asset.type,
          scope: asset.scope,
        });
        seenKeys.push(assetKey(asset.type, asset.identifier));
      }
      seenByProgram.set(row.id, seenKeys);
    }
    const assetRows = await bulkUpsertAssets(tx, assetInputs);
    runLogger.info({ assets: assetRows.size }, "assets upserted");
    await bulkInsertAssetSnapshots(
      tx,
      runId,
      [...assetRows.values()].map((row) => ({
        programId: row.programId,
        assetId: row.id,
        assetKey: row.assetKey,
      })),
    );
    runLogger.info("asset snapshots recorded");

    let programsAdded = 0;
    let assetsAdded = 0;
    let assetsRemoved = 0;

    for (const { program, assets } of incoming) {
      const key = `${PLATFORM_HACKERONE}|${program.externalId.toLowerCase()}`;
      const row = programRows.get(key);
      if (!row) throw new Error(`bulkUpsertPrograms returned no row for ${key}`);
      // Reconcile seen programs only: missing keys flip to OUT (never delete).
      await markMissingAssetsOut(tx, row.id, seenByProgram.get(row.id) ?? []);

      if (!isFirst) {
        const prevProgramId = prevByKey.get(key);
        const prev: PreviousProgramState | null = prevProgramId
          ? {
              programId: prevProgramId,
              inAssets: prevInByProgram.get(prevProgramId) ?? new Map<string, string>(),
            }
          : null;
        const prevIdByKey = prevProgramId
          ? (prevIdByProgram.get(prevProgramId) ?? new Map<string, string>())
          : new Map<string, string>();
        const diff = diffProgram(prev, program, assets, false);
        if (diff.programAdded) {
          programsAdded += 1;
          await insertChange(tx, {
            type: "PROGRAM_ADDED",
            programId: row.id,
            assetId: null,
            assetKey: null,
            assetIdentifier: null,
            collectionRunId: runId,
          });
        }
        for (const added of diff.added) {
          assetsAdded += 1;
          await insertChange(tx, {
            type: "ASSET_ADDED",
            programId: row.id,
            assetId: assetRows.get(`${row.id}|${added.assetKey}`)?.id ?? null,
            assetKey: added.assetKey,
            assetIdentifier: added.assetIdentifier,
            collectionRunId: runId,
          });
        }
        for (const removed of diff.removed) {
          assetsRemoved += 1;
          await insertChange(tx, {
            type: "ASSET_REMOVED",
            programId: row.id,
            assetId: prevIdByKey.get(removed.assetKey) ?? null,
            assetKey: removed.assetKey,
            assetIdentifier: removed.assetIdentifier,
            collectionRunId: runId,
          });
        }
      }
    }
    runLogger.info({ programs: incoming.length }, "programs reconciled");

    // Programs missing from the API: no deletes, no asset reconcile.
    await completeRun(tx, runId, {
      programsSeen: incoming.length,
      assetsSeen: assetsDiscovered,
      programsAdded,
      assetsAdded,
      assetsRemoved,
    });
    return { programsAdded, assetsAdded, assetsRemoved };
  });

  return {
    runId,
    status: "completed",
    programsSeen: incoming.length,
    assetsSeen: assetsDiscovered,
    programsAdded: stats.programsAdded,
    assetsAdded: stats.assetsAdded,
    assetsRemoved: stats.assetsRemoved,
  };
}

function createRealCollector(config: AppConfig, runLogger: Logger): ProgramCollector {
  const creds = requireHackerOneCredentials(config);
  const client = new HackerOneClient({
    baseUrl: config.H1_BASE_URL,
    username: creds.username,
    apiToken: creds.apiToken,
    timeoutMs: config.H1_TIMEOUT_MS,
    minDelayMs: config.H1_MIN_DELAY_MS,
    logger: { warn: (message, context) => runLogger.warn(context ?? {}, message) },
  });
  return new HackerOneCollector(client, {
    warn: (message, context) => runLogger.warn(context ?? {}, message),
  });
}

function classifyError(error: unknown): { code: string; message: string } {
  if (error instanceof CollectorError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error && /Missing HackerOne credentials/.test(error.message)) {
    return { code: "AUTH_FAILED", message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "COLLECTION_FAILED", message };
}
