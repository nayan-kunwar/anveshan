import { loadConfig } from "@anveshan/config";
import type { AppConfig } from "@anveshan/config";
import { Pool, type PoolClient } from "pg";
import { closePool, createDb, createPool, type Database } from "./db.js";
import { runMigrations } from "./migrate.js";
import { truncateAll } from "./repositories.js";

/**
 * Integration-test database helpers. TEST-ONLY: never import from
 * production code paths. Every DB-backed suite runs here instead of the
 * dev database, so `pnpm test` can never wipe real local data.
 */

export const TEST_DATABASE_NAME = "anveshan_test";
const TEST_SERIAL_LOCK_KEY = "anveshan_test_serial";

/**
 * Test database URL: TEST_DATABASE_URL verbatim when set (assumed already
 * provisioned, e.g. CI), otherwise derived from the dev DATABASE_URL by
 * swapping only the database name (host, port, user, params preserved).
 */
export function resolveTestDatabaseUrl(devDatabaseUrl: string): string {
  const override = process.env["TEST_DATABASE_URL"];
  if (override && override.trim().length > 0) return override;
  const url = new URL(devDatabaseUrl);
  url.pathname = `/${TEST_DATABASE_NAME}`;
  return url.toString();
}

async function ensureDatabase(serverUrl: string): Promise<void> {
  const admin = new Pool({ connectionString: serverUrl, max: 1 });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
      TEST_DATABASE_NAME,
    ]);
    if ((existing.rowCount ?? 0) === 0) {
      // Name is a module constant, never user input.
      await admin.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    }
  } finally {
    await admin.end();
  }
}

export interface IntegrationTestDb {
  pool: Pool;
  db: Database;
  config: AppConfig;
  teardown: () => Promise<void>;
}

/**
 * Provision + migrate + lock + truncate the shared test database.
 * Returns null (after a stderr notice) when DATABASE_URL is unset, so
 * suites keep their skip-without-DB behavior. The serial lock is taken on
 * a test-DB connection: advisory locks are per-database, so the lock must
 * live where the data lives. Extra env entries (e.g. test secrets) merge
 * under DATABASE_URL, which always points at the test database.
 */
export async function setupIntegrationTestDb(
  envOverrides: Record<string, string> = {},
): Promise<IntegrationTestDb | null> {
  const devUrl = process.env["DATABASE_URL"];
  if (!devUrl) {
    process.stderr.write("DATABASE_URL not set — skipping database integration tests\n");
    return null;
  }
  const explicitOverride = process.env["TEST_DATABASE_URL"];
  if (!explicitOverride || explicitOverride.trim().length === 0) {
    const server = new URL(devUrl);
    server.pathname = "/postgres";
    await ensureDatabase(server.toString());
  }
  const testUrl = resolveTestDatabaseUrl(devUrl);
  const config = loadConfig({ ...process.env, ...envOverrides, DATABASE_URL: testUrl });
  const pool = createPool(testUrl);
  const serialClient: PoolClient = await pool.connect();
  try {
    await serialClient.query("SELECT pg_advisory_lock(hashtext($1))", [
      TEST_SERIAL_LOCK_KEY,
    ]);
    await pool.query("SELECT 1");
    await runMigrations(testUrl);
  } catch (error) {
    serialClient.release();
    await pool.end();
    throw error;
  }
  const db = createDb(pool);
  await truncateAll(db);
  return {
    pool,
    db,
    config,
    teardown: async () => {
      await serialClient.query("SELECT pg_advisory_unlock(hashtext($1))", [
        TEST_SERIAL_LOCK_KEY,
      ]);
      serialClient.release();
      await pool.end();
      await closePool();
    },
  };
}
