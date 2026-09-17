import { loadConfig } from "@anveshan/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

/**
 * pnpm db:migrate — applies ./drizzle migrations.
 * Enables pgcrypto first (uuid gen_random_uuid() defaults need it).
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);
    const db = drizzle(pool);
    // Absolute path: works from any CWD, in src (tsx) and dist (node).
    const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  await runMigrations(config.DATABASE_URL);
  process.stdout.write("migrations applied\n");
}

const invokedAsScript = (process.argv[1] ?? "")
  .replace(/\\/g, "/")
  .endsWith("migrate.ts");
if (invokedAsScript) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`db:migrate failed: ${message}\n`);
    process.exitCode = 1;
  });
}
