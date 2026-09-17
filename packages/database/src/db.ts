import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool, type PoolClient } from "pg";
import { schema } from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;
/** Transaction object passed to `db.transaction(async (tx) => …)`. */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything repositories accept: pool-backed db, single-client db, or tx. */
export type Db = Database | DbTransaction;

export const ADVISORY_LOCK_KEY = "anveshan_collect";

let pool: Pool | null = null;

export function getPool(databaseUrl: string): Pool {
  if (!pool) {
    pool = createPool(databaseUrl);
  }
  return pool;
}

/** Fresh pool (tests use one per file so teardowns never close a shared pool). */
export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 5 });
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export function createDb(poolOrClient: Pool | PoolClient): Database {
  return drizzleNode(poolOrClient, { schema });
}

/**
 * Checkout a dedicated client for the whole collection run.
 * Required: the session advisory lock must be held on one connection
 * across fetch + persist, and a Pool would spread queries over sessions.
 */
export async function checkoutSessionClient(poolInstance: Pool): Promise<PoolClient> {
  return poolInstance.connect();
}

export async function tryAdvisoryLock(db: Db): Promise<boolean> {
  const rows = await db.execute<{ locked: boolean }>(sql`
    SELECT pg_try_advisory_lock(hashtext(${ADVISORY_LOCK_KEY})) AS "locked"
  `);
  const first = rows.rows[0];
  return first !== undefined && first.locked;
}

export async function advisoryUnlock(db: Db): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${ADVISORY_LOCK_KEY}))`);
}
