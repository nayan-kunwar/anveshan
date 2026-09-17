import { beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { loadConfig } from "@anveshan/config";
import type { AppConfig } from "@anveshan/config";
import type { ProgramCollector } from "@anveshan/collector";
import type { CollectedAsset, CollectedProgram } from "@anveshan/domain";
import {
  closePool,
  createDb,
  createPool,
  findAssetsByProgram,
  findProgramById,
  listChanges,
  runMigrations,
  truncateAll,
} from "@anveshan/database";
import { runCollection } from "../src/collection/service.js";
import { createLogger } from "../src/logger.js";

const logger = createLogger({ LOG_LEVEL: "silent" });

function program(handle: string, name: string): CollectedProgram {
  return {
    externalId: handle,
    name,
    platform: "hackerone",
    url: `https://hackerone.com/${handle}`,
  };
}

function asset(identifier: string, scope: "IN" | "OUT" = "IN"): CollectedAsset {
  return { identifier, type: "DOMAIN", scope };
}

class FakeCollector implements ProgramCollector {
  constructor(private state: Map<string, { name: string; assets: CollectedAsset[] }>) {}

  setState(state: Map<string, { name: string; assets: CollectedAsset[] }>): void {
    this.state = state;
  }

  async getPrograms(): Promise<CollectedProgram[]> {
    return [...this.state.entries()].map(([handle, p]) => program(handle, p.name));
  }

  async getProgramAssets(handle: string): Promise<CollectedAsset[]> {
    return this.state.get(handle)?.assets ?? [];
  }
}

let pool: Pool | null = null;
let config: AppConfig | null = null;
// Same file-level exclusion as packages/database tests (shared Postgres).
let serialClient: PoolClient | null = null;

beforeAll(async () => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    process.stderr.write("DATABASE_URL not set — skipping collection tests\n");
    return;
  }
  try {
    config = loadConfig({ ...process.env, DATABASE_URL: databaseUrl });
    pool = createPool(config.DATABASE_URL);
    serialClient = await pool.connect();
    await serialClient.query("SELECT pg_advisory_lock(hashtext('anveshan_test_serial'))");
    await pool.query("SELECT 1");
    await runMigrations(config.DATABASE_URL);
    await truncateAll(createDb(pool));
  } catch (error) {
    process.stderr.write(
      `Postgres unreachable — skipping collection tests: ${String(error)}\n`,
    );
    pool = null;
    config = null;
  }
  return async () => {
    if (serialClient) {
      await serialClient.query(
        "SELECT pg_advisory_unlock(hashtext('anveshan_test_serial'))",
      );
      serialClient.release();
      serialClient = null;
    }
    if (pool) {
      await pool.end();
      pool = null;
    }
    await closePool();
  };
}, 120000);

function totalChanges(): Promise<number> {
  if (!pool || !config) throw new Error("no db");
  // Count across programs via a direct query on the pool.
  return pool
    .query("SELECT COUNT(*)::int AS n FROM changes")
    .then((r) => (r.rows[0] as { n: number }).n);
}

describe("runCollection (fake HackerOne, real Postgres)", () => {
  it("run 1 establishes baseline with zero changes", async () => {
    if (!pool || !config) return;
    const collector = new FakeCollector(
      new Map([
        [
          "acme",
          { name: "Acme", assets: [asset("example.com"), asset("api.example.com")] },
        ],
        ["globex", { name: "Globex", assets: [asset("globex.com")] }],
      ]),
    );
    const summary = await runCollection({ config, pool, collector, logger });
    expect(summary.status).toBe("completed");
    expect(summary.programsSeen).toBe(2);
    expect(summary.assetsSeen).toBe(3);
    expect(await totalChanges()).toBe(0);
  });

  it("run 2 with identical data produces zero changes", async () => {
    if (!pool || !config) return;
    const collector = new FakeCollector(
      new Map([
        [
          "acme",
          { name: "Acme", assets: [asset("api.example.com"), asset("example.com")] },
        ],
        ["globex", { name: "Globex", assets: [asset("globex.com")] }],
      ]),
    );
    const summary = await runCollection({ config, pool, collector, logger });
    expect(summary.status).toBe("completed");
    expect(summary.programsAdded).toBe(0);
    expect(summary.assetsAdded).toBe(0);
    expect(summary.assetsRemoved).toBe(0);
    expect(await totalChanges()).toBe(0);
  });

  it("run 3 detects PROGRAM_ADDED, ASSET_ADDED, ASSET_REMOVED", async () => {
    if (!pool || !config) return;
    const collector = new FakeCollector(
      new Map([
        [
          "acme",
          {
            name: "Acme",
            assets: [
              asset("example.com"),
              asset("new.example.com"),
              asset("vdp.example.com", "OUT"),
            ],
          },
        ],
        ["globex", { name: "Globex", assets: [asset("globex.com")] }],
        ["initech", { name: "Initech", assets: [asset("initech.com")] }],
      ]),
    );
    const summary = await runCollection({ config, pool, collector, logger });
    expect(summary.status).toBe("completed");
    expect(summary.programsAdded).toBe(1);
    expect(summary.assetsAdded).toBe(1);
    expect(summary.assetsRemoved).toBe(1);
    // OUT scopes persist but never emit.
    expect(await totalChanges()).toBe(3);
  });

  it("removed assets flip to OUT in live rows and keep history", async () => {
    if (!pool || !config) return;
    const db = createDb(pool);
    const programs = await db.query.programs.findMany();
    const acme = programs.find((p) => p.externalId === "acme");
    expect(acme).toBeDefined();
    if (!acme) return;
    const live = await findAssetsByProgram(db, acme.id);
    const removed = live.find((a) => a.assetKey === "DOMAIN|api.example.com");
    expect(removed?.scope).toBe("OUT");
    const { items } = await listChanges(db, acme.id, undefined, 1, 50);
    const removedChange = items.find((c) => c.type === "ASSET_REMOVED");
    expect(removedChange?.assetIdentifier).toBe("api.example.com");
    expect(removedChange?.assetId).toBe(removed?.id);
  });

  it("run 4 ignores programs missing from the API (no PROGRAM_REMOVED)", async () => {
    if (!pool || !config) return;
    const before = await totalChanges();
    const collector = new FakeCollector(
      new Map([
        [
          "acme",
          { name: "Acme", assets: [asset("example.com"), asset("new.example.com")] },
        ],
        // globex + initech absent from this fetch
      ]),
    );
    const summary = await runCollection({ config, pool, collector, logger });
    expect(summary.status).toBe("completed");
    expect(summary.programsSeen).toBe(1);
    // No removals for the unseen programs' assets.
    expect(summary.assetsRemoved).toBe(0);
    expect(await totalChanges()).toBe(before);
    // Rows for unseen programs are kept.
    const db = createDb(pool);
    const kept = await db.query.programs.findMany();
    expect(kept.some((p) => p.externalId === "globex")).toBe(true);
  });

  it("run 5 repeat produces zero new changes", async () => {
    if (!pool || !config) return;
    const before = await totalChanges();
    const collector = new FakeCollector(
      new Map([
        [
          "acme",
          { name: "Acme", assets: [asset("example.com"), asset("new.example.com")] },
        ],
      ]),
    );
    const summary = await runCollection({ config, pool, collector, logger });
    expect(summary.status).toBe("completed");
    expect(await totalChanges()).toBe(before);
  });

  it("program renames update the row without emitting changes", async () => {
    if (!pool || !config) return;
    const before = await totalChanges();
    const collector = new FakeCollector(
      new Map([
        [
          "acme",
          {
            name: "Acme Corporation",
            assets: [asset("example.com"), asset("new.example.com")],
          },
        ],
      ]),
    );
    const summary = await runCollection({ config, pool, collector, logger });
    expect(summary.status).toBe("completed");
    expect(await totalChanges()).toBe(before);
    const db = createDb(pool);
    const programs = await db.query.programs.findMany();
    expect(programs.find((p) => p.externalId === "acme")?.name).toBe("Acme Corporation");
  });

  it("fetch failure fails the run with zero live changes", async () => {
    if (!pool || !config) return;
    const before = await totalChanges();
    const failing: ProgramCollector = {
      getPrograms: async () => [program("acme", "Acme")],
      getProgramAssets: async () => {
        throw new Error("boom");
      },
    };
    const summary = await runCollection({ config, pool, collector: failing, logger });
    expect(summary.status).toBe("failed");
    expect(summary.errorCode).toBe("COLLECTION_FAILED");
    expect(await totalChanges()).toBe(before);
  });

  it("missing credentials fail closed as AUTH_FAILED", async () => {
    if (!pool || !config) return;
    const noCreds = {
      ...config,
      HACKERONE_USERNAME: undefined,
      HACKERONE_API_TOKEN: undefined,
    };
    const summary = await runCollection({ config: noCreds, pool, logger });
    expect(summary.status).toBe("failed");
    expect(summary.errorCode).toBe("AUTH_FAILED");
  });

  it("asset rows are addressable for the read API", async () => {
    if (!pool || !config) return;
    const db = createDb(pool);
    const programs = await db.query.programs.findMany();
    const acme = programs.find((p) => p.externalId === "acme");
    const found = acme ? await findProgramById(db, acme.id) : undefined;
    expect(found?.name).toBe("Acme Corporation");
  });
});
