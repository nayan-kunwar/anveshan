import { createFakeSendMail } from "@anveshan/notifications";
import {
  closePool,
  createDb,
  createPool,
  findUserByEmail,
  insertSession,
  runMigrations,
  setUnsubscribed,
  truncateAll,
  upsertProgram,
  upsertUserByEmail,
} from "@anveshan/database";
import type { Database } from "@anveshan/database";
import { loadConfig } from "@anveshan/config";
import type { AppConfig } from "@anveshan/config";
import { beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { hashSessionToken } from "../src/auth/tokens.js";
import { createApp } from "../src/app.js";
import type { ProgramStore } from "../src/services/programs.js";
import { createLogger } from "../src/logger.js";

let db: Database | null = null;
let serialClient: PoolClient | null = null;
let ownPool: Pool | null = null;
let config: AppConfig | null = null;

const store: ProgramStore = {
  listPrograms: async () => ({ items: [], total: 0 }),
  findProgramById: async () => undefined,
  listAssets: async () => ({ items: [], total: 0 }),
  listChanges: async () => ({ items: [], total: 0 }),
};

const TEST_SERIAL_LOCK_KEY = "anveshan_test_serial";

beforeAll(async () => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    process.stderr.write("DATABASE_URL not set — skipping subscription tests\n");
    return;
  }
  try {
    config = loadConfig({
      ...process.env,
      DATABASE_URL: databaseUrl,
      MAGIC_LINK_SECRET: "m".repeat(32),
      SESSION_SECRET: "s".repeat(32),
      UNSUBSCRIBE_SECRET: "u".repeat(32),
      AUTH_EMAIL_ENABLED: "false",
      FRONTEND_URL: "http://localhost:3001",
    });
    ownPool = createPool(config.DATABASE_URL);
    serialClient = await ownPool.connect();
    await serialClient.query("SELECT pg_advisory_lock(hashtext($1))", [
      TEST_SERIAL_LOCK_KEY,
    ]);
    await runMigrations(config.DATABASE_URL);
    db = createDb(ownPool);
    await truncateAll(db);
  } catch (error) {
    process.stderr.write(
      `Postgres unreachable — skipping subscription tests: ${String(error)}\n`,
    );
    db = null;
    config = null;
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

function needDeps(): { db: Database; config: AppConfig } {
  if (!db || !config) throw new Error("database unavailable");
  return { db, config };
}

/** Logged-in session cookie without going through the magic-link flow. */
async function loginAs(email: string): Promise<string> {
  const { db: database, config: cfg } = needDeps();
  const user = await upsertUserByEmail(database, email);
  const raw = `session-for-${email}`;
  await insertSession(
    database,
    user.id,
    hashSessionToken(raw, cfg.SESSION_SECRET as string),
    new Date(Date.now() + 3600_000),
  );
  return `session=${raw}`;
}

function buildApp() {
  const { db: database, config: cfg } = needDeps();
  return createApp({
    store,
    logger: createLogger({ LOG_LEVEL: "silent" }),
    db: database,
    config: cfg,
    sendMail: createFakeSendMail([]),
  });
}

describe("subscriptions", () => {
  it("GET returns null when no subscription exists", async () => {
    if (!db) return;
    const app = buildApp();
    const cookie = await loginAs("nosub@example.com");
    const res = await request(app)
      .get("/api/v1/subscriptions")
      .set("Cookie", cookie)
      .expect(200);
    expect(res.body).toEqual({ data: null });
  });

  it("PUT creates a subscription and clears unsubscribed_at", async () => {
    if (!db) return;
    const { db: database } = needDeps();
    const app = buildApp();
    const cookie = await loginAs("resub@example.com");
    const user = await findUserByEmail(database, "resub@example.com");
    await setUnsubscribed(database, user!.id);
    const res = await request(app)
      .put("/api/v1/subscriptions")
      .set("Cookie", cookie)
      .send({ frequency: "daily", watchNewPrograms: true, watchAllPrograms: false })
      .expect(200);
    expect(res.body.data).toMatchObject({
      frequency: "daily",
      watchNewPrograms: true,
      watchAllPrograms: false,
    });
    const after = await findUserByEmail(database, "resub@example.com");
    expect(after?.unsubscribedAt).toBeNull();
  });

  it("PUT rejects invalid frequency with BAD_REQUEST", async () => {
    if (!db) return;
    const app = buildApp();
    const cookie = await loginAs("badfreq@example.com");
    const res = await request(app)
      .put("/api/v1/subscriptions")
      .set("Cookie", cookie)
      .send({ frequency: "hourly", watchNewPrograms: false, watchAllPrograms: false })
      .expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("watches add/list/remove round-trip", async () => {
    if (!db) return;
    const { db: database } = needDeps();
    const app = buildApp();
    const cookie = await loginAs("watcher@example.com");
    const program = await upsertProgram(database, {
      platform: "hackerone",
      externalId: "watched",
      name: "Watched Prog",
    });
    await request(app)
      .post("/api/v1/subscriptions/watches")
      .set("Cookie", cookie)
      .send({ programId: program.id })
      .expect(200);
    const listed = await request(app)
      .get("/api/v1/subscriptions/watches")
      .set("Cookie", cookie)
      .expect(200);
    expect(listed.body.data).toMatchObject([
      { programId: program.id, name: "Watched Prog", externalId: "watched" },
    ]);
    await request(app)
      .delete(`/api/v1/subscriptions/watches/${program.id}`)
      .set("Cookie", cookie)
      .expect(200);
    const empty = await request(app)
      .get("/api/v1/subscriptions/watches")
      .set("Cookie", cookie)
      .expect(200);
    expect(empty.body.data).toEqual([]);
  });

  it("POST watch with unknown program returns PROGRAM_NOT_FOUND", async () => {
    if (!db) return;
    const app = buildApp();
    const cookie = await loginAs("unknown-watch@example.com");
    const res = await request(app)
      .post("/api/v1/subscriptions/watches")
      .set("Cookie", cookie)
      .send({ programId: "00000000-0000-0000-0000-000000000000" })
      .expect(404);
    expect(res.body.error.code).toBe("PROGRAM_NOT_FOUND");
  });

  it("subscription routes require a session", async () => {
    if (!db) return;
    const app = buildApp();
    for (const [method, path] of [
      ["get", "/api/v1/subscriptions"],
      ["put", "/api/v1/subscriptions"],
      ["get", "/api/v1/subscriptions/watches"],
      ["post", "/api/v1/subscriptions/watches"],
      ["delete", "/api/v1/subscriptions/watches/00000000-0000-0000-0000-000000000000"],
    ] as const) {
      const res = await request(app)[method](path).send({}).expect(401);
      expect(res.body.error.code).toBe("UNAUTHORIZED");
    }
  });
});
