import { beforeAll, describe, expect, it } from "vitest";
import { count, eq, sql } from "drizzle-orm";
import {
  advisoryUnlock,
  assetSnapshots,
  bulkInsertAssetSnapshots,
  bulkInsertProgramSnapshots,
  bulkUpsertAssets,
  bulkUpsertPrograms,
  countCompletedRuns,
  countPrograms,
  createRun,
  deleteSchedulerSetting,
  failStaleRunningRuns,
  findAssetsByProgram,
  findLiveAssetsByProgramIds,
  findSchedulerSetting,
  insertChange,
  listChanges,
  listRecentChanges,
  setPersistStatementTimeout,
  setupIntegrationTestDb,
  tryAdvisoryLock,
  upsertAsset,
  upsertProgram,
  upsertSchedulerSetting,
} from "../src/index.js";
import type { Database, UpsertAssetInput } from "../src/index.js";

let db: Database | null = null;
let teardown: (() => Promise<void>) | null = null;

beforeAll(async () => {
  try {
    const setup = await setupIntegrationTestDb();
    if (!setup) return;
    db = setup.db;
    teardown = setup.teardown;
  } catch (error) {
    process.stderr.write(
      `Postgres unreachable — skipping database integration tests: ${String(error)}\n`,
    );
    db = null;
  }
  return async () => {
    await teardown?.();
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

  it("lists recent changes globally newest-first with program names", async () => {
    if (!db) return;
    const progs = await bulkUpsertPrograms(db, [
      { platform: "hackerone", externalId: "feed-a", name: "Feed A" },
      { platform: "hackerone", externalId: "feed-b", name: "Feed B" },
    ]);
    const aId = progs.get("hackerone|feed-a")?.id;
    const bId = progs.get("hackerone|feed-b")?.id;
    if (!aId || !bId) throw new Error("feed programs missing");
    const run = await createRun(db);
    await insertChange(db, {
      type: "ASSET_ADDED",
      programId: aId,
      assetId: null,
      assetKey: "DOMAIN|x.example.com",
      assetIdentifier: "x.example.com",
      collectionRunId: run.id,
    });
    await insertChange(db, {
      type: "PROGRAM_ADDED",
      programId: bId,
      assetId: null,
      assetKey: null,
      assetIdentifier: null,
      collectionRunId: run.id,
    });
    // Pin distinct timestamps (defaultNow would tie inside one test).
    await db.execute(
      sql`UPDATE changes SET detected_at = '2026-01-02T00:00:00Z' WHERE collection_run_id = ${run.id} AND type = 'ASSET_ADDED'`,
    );
    await db.execute(
      sql`UPDATE changes SET detected_at = '2026-01-01T00:00:00Z' WHERE collection_run_id = ${run.id} AND type = 'PROGRAM_ADDED'`,
    );
    const mine = <T extends { collectionRunId: string }>(items: T[]): T[] =>
      items.filter((c) => c.collectionRunId === run.id);
    const all = await listRecentChanges(db, { page: 1, pageSize: 50 });
    expect(mine(all.items).map((c) => c.type)).toEqual(["ASSET_ADDED", "PROGRAM_ADDED"]);
    expect(mine(all.items)[0]?.programName).toBe("Feed A");
    expect(mine(all.items)[0]?.platform).toBe("hackerone");
    const typed = await listRecentChanges(db, {
      type: "PROGRAM_ADDED",
      page: 1,
      pageSize: 50,
    });
    expect(mine(typed.items)).toHaveLength(1);
    const since = await listRecentChanges(db, {
      since: new Date("2026-01-01T12:00:00Z"),
      page: 1,
      pageSize: 50,
    });
    expect(mine(since.items).map((c) => c.type)).toEqual(["ASSET_ADDED"]);
    const paged = await listRecentChanges(db, { page: 1, pageSize: 1 });
    expect(paged.total).toBeGreaterThanOrEqual(2);
    expect(paged.items).toHaveLength(1);
  });
});
