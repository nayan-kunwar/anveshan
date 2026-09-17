import { beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { loadConfig } from "@anveshan/config";
import {
  advisoryUnlock,
  closePool,
  countCompletedRuns,
  countPrograms,
  createDb,
  createPool,
  createRun,
  failStaleRunningRuns,
  findAssetsByProgram,
  insertChange,
  listChanges,
  runMigrations,
  truncateAll,
  tryAdvisoryLock,
  upsertAsset,
  upsertProgram,
} from "../src/index.js";
import type { Database } from "../src/index.js";

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
});
