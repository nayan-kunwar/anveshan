import { beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { count, eq, sql } from "drizzle-orm";
import { loadConfig } from "@anveshan/config";
import {
  advisoryUnlock,
  assetSnapshots,
  bulkInsertAssetSnapshots,
  bulkInsertProgramSnapshots,
  bulkUpsertAssets,
  bulkUpsertPrograms,
  closePool,
  countCompletedRuns,
  countPrograms,
  createDb,
  createPool,
  createRun,
  deleteSchedulerSetting,
  failStaleRunningRuns,
  findAssetsByProgram,
  findLiveAssetsByProgramIds,
  findSchedulerSetting,
  insertChange,
  listChanges,
  runMigrations,
  setPersistStatementTimeout,
  truncateAll,
  tryAdvisoryLock,
  upsertAsset,
  upsertProgram,
  upsertSchedulerSetting,
} from "../src/index.js";
import type { Database, UpsertAssetInput } from "../src/index.js";

let db: Database | null = null;
// File-level mutual exclusion: DB-backed files share one Postgres, so they
// must never interleave (truncateAll + advisory-lock assertions). Blocking
// lock on a dedicated session; released in the beforeAll teardown.
let serialClient: PoolClient | null = null;
let ownPool: Pool | null = null;

const TEST_SERIAL_LOCK_KEY = "anveshan_test_serial";

beforeAll(async () => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    process.stderr.write("DATABASE_URL not set — skipping database integration tests\n");
    return;
  }
  try {
    const config = loadConfig({ ...process.env, DATABASE_URL: databaseUrl });
    ownPool = createPool(config.DATABASE_URL);
    serialClient = await ownPool.connect();
    await serialClient.query("SELECT pg_advisory_lock(hashtext($1))", [
      TEST_SERIAL_LOCK_KEY,
    ]);
    await ownPool.query("SELECT 1");
    await runMigrations(config.DATABASE_URL);
    db = createDb(ownPool);
    await truncateAll(db);
  } catch (error) {
    process.stderr.write(
      `Postgres unreachable — skipping database integration tests: ${String(error)}\n`,
    );
    db = null;
  }
  return async () => {
    if (serialClient) {
      await serialClient.query("SELECT pg_advisory_unlock(hashtext($1))", [
        TEST_SERIAL_LOCK_KEY,
      ]);
      serialClient.release();
      serialClient = null;
    }
    if (ownPool) {
      await ownPool.end();
      ownPool = null;
    }
    await closePool();
  };
}, 60000);

describe("database repositories", () => {
  it("upserts programs on (platform, handle) and updates name/url", async () => {
    if (!db) return;
    const first = await upsertProgram(db, {
      platform: "hackerone",
      externalId: "Acme",
      name: "Acme",
      url: "https://hackerone.com/acme",
    });
    const second = await upsertProgram(db, {
      platform: "hackerone",
      externalId: "acme",
      name: "Acme Corp",
      url: "https://hackerone.com/acme",
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Acme Corp");
    expect(await countPrograms(db)).toBe(1);
  });

  it("upserts assets on (program_id, asset_key) and reconciles scope", async () => {
    if (!db) return;
    const program = await upsertProgram(db, {
      platform: "hackerone",
      externalId: "scope-test",
      name: "Scope Test",
    });
    await upsertAsset(db, {
      programId: program.id,
      identifier: "a.example.com",
      normalizedIdentifier: "a.example.com",
      type: "DOMAIN",
      scope: "IN",
    });
    const again = await upsertAsset(db, {
      programId: program.id,
      identifier: "a.example.com",
      normalizedIdentifier: "a.example.com",
      type: "DOMAIN",
      scope: "OUT",
    });
    const rows = await findAssetsByProgram(db, program.id);
    expect(rows).toHaveLength(1);
    expect(again.scope).toBe("OUT");
    expect(rows[0]?.assetKey).toBe("DOMAIN|a.example.com");
  });

  it("dedupes PROGRAM_ADDED via partial unique index", async () => {
    if (!db) return;
    const program = await upsertProgram(db, {
      platform: "hackerone",
      externalId: "dedupe-test",
      name: "Dedupe Test",
    });
    const run = await createRun(db);
    const input = {
      type: "PROGRAM_ADDED",
      programId: program.id,
      assetId: null,
      assetKey: null,
      assetIdentifier: null,
      collectionRunId: run.id,
    } as const;
    await insertChange(db, { ...input });
    await insertChange(db, { ...input });
    const { total } = await listChanges(db, program.id, undefined, 1, 10);
    expect(total).toBe(1);
  });

  it("tracks runs and fails stale running rows", async () => {
    if (!db) return;
    expect(await countCompletedRuns(db)).toBe(0);
    const failed = await failStaleRunningRuns(db, 7200000);
    expect(failed).toBeGreaterThanOrEqual(0);
  });

  it("acquires and releases the advisory lock on one session", async () => {
    if (!db) return;
    expect(await tryAdvisoryLock(db)).toBe(true);
    await advisoryUnlock(db);
    expect(await tryAdvisoryLock(db)).toBe(true);
    await advisoryUnlock(db);
  });

  it("upserts scheduler settings and deletes back to env-driven state", async () => {
    if (!db) return;
    expect(await findSchedulerSetting(db, "collection")).toBeUndefined();
    const created = await upsertSchedulerSetting(db, "collection", {
      enabled: false,
      cron: "*/15 * * * *",
      timezone: "Asia/Kolkata",
    });
    expect(created.enabled).toBe(false);
    expect(created.cron).toBe("*/15 * * * *");
    expect(created.timezone).toBe("Asia/Kolkata");
    const updated = await upsertSchedulerSetting(db, "collection", {
      enabled: true,
      cron: "0 * * * *",
      timezone: "UTC",
    });
    expect(updated.jobKey).toBe(created.jobKey);
    expect(await findSchedulerSetting(db, "collection")).toMatchObject({
      enabled: true,
      cron: "0 * * * *",
      timezone: "UTC",
    });
    await deleteSchedulerSetting(db, "collection");
    expect(await findSchedulerSetting(db, "collection")).toBeUndefined();
    // Delete is idempotent.
    await deleteSchedulerSetting(db, "collection");
    expect(await findSchedulerSetting(db, "collection")).toBeUndefined();
  });

  it("bulk upserts programs with per-row conflict updates", async () => {
    if (!db) return;
    const first = await bulkUpsertPrograms(db, [
      { platform: "hackerone", externalId: "BulkA", name: "A" },
      { platform: "hackerone", externalId: "bulkb", name: "B" },
    ]);
    expect(first.size).toBe(2);
    const second = await bulkUpsertPrograms(db, [
      { platform: "hackerone", externalId: "bulka", name: "A Renamed" },
      { platform: "hackerone", externalId: "bulkb", name: "B" },
    ]);
    expect(second.get("hackerone|bulka")?.id).toBe(first.get("hackerone|bulka")?.id);
    expect(second.get("hackerone|bulka")?.name).toBe("A Renamed");
    expect(await bulkUpsertPrograms(db, [])).toEqual(new Map());
    expect(await bulkUpsertAssets(db, [])).toEqual(new Map());
  });

  it("bulk upserts assets across chunk boundaries with id mapping", async () => {
    if (!db) return;
    const programs = await bulkUpsertPrograms(db, [
      { platform: "hackerone", externalId: "bulk-prog", name: "Bulk Prog" },
    ]);
    const programId = programs.get("hackerone|bulk-prog")?.id;
    if (!programId) throw new Error("bulk program missing");
    // 2,100 rows forces multi-chunk bulk statements (2k rows/chunk).
    const inputs: UpsertAssetInput[] = Array.from({ length: 2100 }, (_, i) => ({
      programId,
      identifier: `bulk${i}.example.com`,
      normalizedIdentifier: `bulk${i}.example.com`,
      type: "DOMAIN",
      scope: "IN",
    }));
    const rows = await bulkUpsertAssets(db, inputs);
    expect(rows.size).toBe(2100);
    expect(rows.get(`${programId}|DOMAIN|bulk2099.example.com`)?.id).toBeDefined();
    const run = await createRun(db);
    await bulkInsertProgramSnapshots(db, run.id, [programId]);
    await bulkInsertAssetSnapshots(
      db,
      run.id,
      [...rows.values()].map((r) => ({
        programId: r.programId,
        assetId: r.id,
        assetKey: r.assetKey,
      })),
    );
    const snaps = await db
      .select({ n: count() })
      .from(assetSnapshots)
      .where(eq(assetSnapshots.collectionRunId, run.id));
    expect(snaps[0]?.n).toBe(2100);
    const preloaded = await findLiveAssetsByProgramIds(db, [programId]);
    expect(preloaded).toHaveLength(2100);
    expect(await findLiveAssetsByProgramIds(db, [])).toEqual([]);
    // Update path through bulk: scope flips, no duplicate rows.
    await bulkUpsertAssets(db, [
      {
        programId,
        identifier: "bulk0.example.com",
        normalizedIdentifier: "bulk0.example.com",
        type: "DOMAIN",
        scope: "OUT",
      },
    ]);
    const reloaded = await findLiveAssetsByProgramIds(db, [programId]);
    expect(reloaded).toHaveLength(2100);
    expect(reloaded.find((a) => a.assetKey === "DOMAIN|bulk0.example.com")?.scope).toBe(
      "OUT",
    );
  });

  it("setPersistStatementTimeout guards input and applies in-transaction", async () => {
    if (!db) return;
    await expect(setPersistStatementTimeout(db, 0)).rejects.toThrow();
    await expect(setPersistStatementTimeout(db, -1)).rejects.toThrow();
    await db.transaction(async (tx) => {
      await setPersistStatementTimeout(tx, 60_000);
      await tx.execute(sql`SELECT 1`);
    });
  });
});
