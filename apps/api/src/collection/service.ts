import type { AppConfig } from "@anveshan/config";
import { requireHackerOneCredentials } from "@anveshan/config";
import type { Db } from "@anveshan/database";
import {
  advisoryUnlock,
  completeRun,
  countCompletedRuns,
  countPrograms,
  createDb,
  createRun,
  failRun,
  failStaleRunningRuns,
  findAllPrograms,
  findAssetsByProgram,
  insertAssetSnapshot,
  insertChange,
  insertProgramSnapshot,
  markMissingAssetsOut,
  tryAdvisoryLock,
  upsertAsset,
  upsertProgram,
} from "@anveshan/database";
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

  // --- persist (seconds; single transaction) ---
  const stats = await sessionDb.transaction(async (tx) => {
    const prevPrograms = await findAllPrograms(tx);
    const prevByKey = new Map(
      prevPrograms.map((p) => [`${p.platform}|${p.externalIdLower}`, p.id]),
    );

    let programsAdded = 0;
    let assetsAdded = 0;
    let assetsRemoved = 0;

    for (const { program, assets } of incoming) {
      const key = `${PLATFORM_HACKERONE}|${program.externalId.toLowerCase()}`;
      const prevProgramId = prevByKey.get(key);

      let prev: PreviousProgramState | null = null;
      let prevIdByKey = new Map<string, string>();
      if (prevProgramId) {
        const live = await findAssetsByProgram(tx, prevProgramId);
        prevIdByKey = new Map(live.map((a) => [a.assetKey, a.id]));
        prev = {
          programId: prevProgramId,
          inAssets: new Map(
            live.filter((a) => a.scope === "IN").map((a) => [a.assetKey, a.identifier]),
          ),
        };
      }

      const row = await upsertProgram(tx, {
        platform: PLATFORM_HACKERONE,
        externalId: program.externalId,
        name: program.name,
        url: program.url,
        externalNumericId: program.externalNumericId,
      });
      await insertProgramSnapshot(tx, runId, row.id);

      const seenKeys: string[] = [];
      const upsertedIds = new Map<string, string>();
      for (const asset of assets) {
        const live = await upsertAsset(tx, {
          programId: row.id,
          externalId: asset.externalId,
          identifier: asset.identifier,
          normalizedIdentifier: asset.identifier,
          type: asset.type,
          scope: asset.scope,
        });
        const liveKey = assetKey(asset.type, asset.identifier);
        seenKeys.push(liveKey);
        upsertedIds.set(liveKey, live.id);
        await insertAssetSnapshot(tx, runId, row.id, live.id, liveKey);
      }
      // Reconcile seen programs only: missing keys flip to OUT (never delete).
      await markMissingAssetsOut(tx, row.id, seenKeys);

      if (!isFirst) {
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
            assetId: upsertedIds.get(added.assetKey) ?? null,
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
    logger: { warn: (message: string) => runLogger.warn(message) },
  });
  return new HackerOneCollector(client, {
    warn: (message: string) => runLogger.warn(message),
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
