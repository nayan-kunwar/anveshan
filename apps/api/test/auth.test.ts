import { createFakeSendMail } from "@anveshan/notifications";
import type { MailMessage } from "@anveshan/notifications";
import {
  closePool,
  createDb,
  createPool,
  findUserByEmail,
  insertSession,
  runMigrations,
  truncateAll,
} from "@anveshan/database";
import type { Database } from "@anveshan/database";
import { loadConfig } from "@anveshan/config";
import type { AppConfig } from "@anveshan/config";
import { beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { ProgramStore } from "../src/services/programs.js";
import { hashSessionToken, signUnsubscribe } from "../src/auth/tokens.js";
import { createLogger } from "../src/logger.js";

let db: Database | null = null;
let serialClient: PoolClient | null = null;
let ownPool: Pool | null = null;
let config: AppConfig | null = null;

const sent: MailMessage[] = [];

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
    process.stderr.write("DATABASE_URL not set — skipping auth tests\n");
    return;
  }
  try {
    config = loadConfig({
      ...process.env,
      DATABASE_URL: databaseUrl,
      MAGIC_LINK_SECRET: "m".repeat(32),
      SESSION_SECRET: "s".repeat(32),
      UNSUBSCRIBE_SECRET: "u".repeat(32),
      AUTH_EMAIL_ENABLED: "true",
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
      `Postgres unreachable — skipping auth tests: ${String(error)}\n`,
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

function buildApp() {
  const { db: database, config: cfg } = needDeps();
  return createApp({
    store,
    logger: createLogger({ LOG_LEVEL: "silent" }),
    db: database,
    config: cfg,
    sendMail: createFakeSendMail(sent),
  });
}

function tokenFromLastMail(): string {
  const last = sent[sent.length - 1];
  const match = /token=([0-9a-f]+)/.exec(last?.text ?? "");
  if (!match?.[1]) throw new Error("no token in last mail");
  return match[1];
}

function firstSetCookie(res: request.Response): string {
  const setCookie = res.headers["set-cookie"];
  if (!setCookie || setCookie.length === 0) throw new Error("no Set-Cookie header");
  const first = setCookie[0];
  if (!first) throw new Error("no Set-Cookie header");
  return first;
}

function cookieFrom(res: request.Response): string {
  const first = firstSetCookie(res);
  const value = first.split(";")[0];
  if (!value) throw new Error("empty session cookie");
  return value;
}

describe("magic-link auth", () => {
  it("request-magic-link sends mail and creates an unverified user", async () => {
    if (!db) return;
    const app = buildApp();
    await request(app)
      .post("/api/v1/auth/request-magic-link")
      .send({ email: "New@Example.com" })
      .expect(200, { ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "new@example.com" });
    expect(sent[0]?.text).toContain("http://localhost:3001/auth/callback?token=");
    const user = await findUserByEmail(needDeps().db, "new@example.com");
    expect(user?.emailVerifiedAt).toBeNull();
  });

  it("request-magic-link rejects invalid email with BAD_REQUEST", async () => {
    if (!db) return;
    const app = buildApp();
    const res = await request(app)
      .post("/api/v1/auth/request-magic-link")
      .send({ email: "not-an-email" })
      .expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("request-magic-link rate-limits repeated requests per email", async () => {
    if (!db) return;
    const app = buildApp();
    const email = "ratelimit@example.com";
    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post("/api/v1/auth/request-magic-link")
        .send({ email })
        .expect(200);
    }
    const res = await request(app)
      .post("/api/v1/auth/request-magic-link")
      .send({ email })
      .expect(429);
    expect(res.body.error.code).toBe("EMAIL_RATE_LIMITED");
  });

  it("verify consumes the token, verifies email, and sets a session cookie", async () => {
    if (!db) return;
    const app = buildApp();
    await request(app)
      .post("/api/v1/auth/request-magic-link")
      .send({ email: "verify-flow@example.com" })
      .expect(200);
    const token = tokenFromLastMail();
    const res = await request(app)
      .post("/api/v1/auth/verify")
      .send({ token })
      .expect(200);
    expect(res.body.data).toMatchObject({ email: "verify-flow@example.com" });
    expect(res.body.data.emailVerifiedAt).not.toBeNull();
    const cookie = cookieFrom(res);
    expect(cookie.startsWith("session=")).toBe(true);
    expect(firstSetCookie(res)).toContain("HttpOnly");

    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookie)
      .expect(200);
    expect(me.body.data).toMatchObject({ email: "verify-flow@example.com" });

    // Single-use: second verify fails.
    const replay = await request(app)
      .post("/api/v1/auth/verify")
      .send({ token })
      .expect(401);
    expect(replay.body.error.code).toBe("INVALID_TOKEN");
  });

  it("me without a session returns UNAUTHORIZED", async () => {
    if (!db) return;
    const app = buildApp();
    const res = await request(app).get("/api/v1/auth/me").expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("logout clears the session", async () => {
    if (!db) return;
    const app = buildApp();
    await request(app)
      .post("/api/v1/auth/request-magic-link")
      .send({ email: "logout@example.com" })
      .expect(200);
    const login = await request(app)
      .post("/api/v1/auth/verify")
      .send({ token: tokenFromLastMail() })
      .expect(200);
    const cookie = cookieFrom(login);
    await request(app).post("/api/v1/auth/logout").set("Cookie", cookie).expect(200);
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookie)
      .expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("expired session is deleted, cookie cleared, UNAUTHORIZED", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const app = buildApp();
    await request(app)
      .post("/api/v1/auth/request-magic-link")
      .send({ email: "expired@example.com" })
      .expect(200);
    await request(app)
      .post("/api/v1/auth/verify")
      .send({ token: tokenFromLastMail() })
      .expect(200);
    const user = await findUserByEmail(database, "expired@example.com");
    const rawSession = "expired-session-token";
    await insertSession(
      database,
      user!.id,
      hashSessionToken(rawSession, cfg.SESSION_SECRET as string),
      new Date(Date.now() - 1000),
    );
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", `session=${rawSession}`)
      .expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
    expect(firstSetCookie(res)).toContain("Max-Age=0");
  });

  it("second verify on a new device inserts a second session", async () => {
    if (!db) return;
    const app = buildApp();
    await request(app)
      .post("/api/v1/auth/request-magic-link")
      .send({ email: "multidevice@example.com" })
      .expect(200);
    const first = await request(app)
      .post("/api/v1/auth/verify")
      .send({ token: tokenFromLastMail() })
      .expect(200);
    await request(app)
      .post("/api/v1/auth/request-magic-link")
      .send({ email: "multidevice@example.com" })
      .expect(200);
    const second = await request(app)
      .post("/api/v1/auth/verify")
      .send({ token: tokenFromLastMail() })
      .expect(200);
    // Both sessions work independently.
    await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookieFrom(first))
      .expect(200);
    await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", cookieFrom(second))
      .expect(200);
  });
});

describe("unsubscribe", () => {
  it("POST /api/v1/unsubscribe sets unsubscribed_at with a valid token", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const app = buildApp();
    await request(app)
      .post("/api/v1/auth/request-magic-link")
      .send({ email: "leaving@example.com" })
      .expect(200);
    await request(app)
      .post("/api/v1/auth/verify")
      .send({ token: tokenFromLastMail() })
      .expect(200);
    const user = await findUserByEmail(database, "leaving@example.com");
    const token = signUnsubscribe(user!.id, cfg.UNSUBSCRIBE_SECRET as string);
    await request(app)
      .post("/api/v1/unsubscribe")
      .send({ userId: user!.id, token })
      .expect(200);
    const after = await findUserByEmail(database, "leaving@example.com");
    expect(after?.unsubscribedAt).toBeInstanceOf(Date);
  });

  it("unsubscribe rejects a bad token with INVALID_TOKEN", async () => {
    if (!db) return;
    const app = buildApp();
    const res = await request(app)
      .post("/api/v1/unsubscribe")
      .send({ userId: "11111111-2222-3333-4444-555555555555", token: "bad" })
      .expect(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("unsubscribe works with only UNSUBSCRIBE_SECRET set", async () => {
    if (!db) return;
    const { db: database } = needDeps();
    const minimalConfig = loadConfig({
      ...process.env,
      DATABASE_URL: process.env["DATABASE_URL"] as string,
      UNSUBSCRIBE_SECRET: "u".repeat(32),
    });
    const minimalApp = createApp({
      store,
      logger: createLogger({ LOG_LEVEL: "silent" }),
      db: database,
      config: minimalConfig,
      sendMail: createFakeSendMail([]),
    });
    await request(minimalApp)
      .post("/api/v1/auth/request-magic-link")
      .send({ email: "anyone@example.com" })
      .expect(500);
    const user = await findUserByEmail(database, "leaving@example.com");
    const token = signUnsubscribe(user!.id, "u".repeat(32));
    await request(minimalApp)
      .post("/api/v1/unsubscribe")
      .send({ userId: user!.id, token })
      .expect(200);
  });
});
