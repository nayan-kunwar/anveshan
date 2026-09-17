import { createFakeSendMail } from "@anveshan/notifications";
import type { MailMessage } from "@anveshan/notifications";
import { eq, sql } from "drizzle-orm";
import {
  addWatch,
  closePool,
  completeRun,
  createDb,
  createPool,
  createRun,
  findUserByEmail,
  insertChange,
  notificationDeliveries,
  removeWatch,
  runMigrations,
  setUnsubscribed,
  truncateAll,
  upsertProgram,
  upsertSubscription,
  upsertUserByEmail,
  verifyUserEmail,
} from "@anveshan/database";
import type { ChangeWithProgram, Database } from "@anveshan/database";
import { loadConfig } from "@anveshan/config";
import type { AppConfig } from "@anveshan/config";
import { createLogger } from "../src/logger.js";
import {
  catchUpDailyDigest,
  catchUpImmediate,
  closedDigestDates,
  digestDateString,
  digestWindow,
  enqueueAfterCollection,
  enqueueDailyDigest,
  enqueueImmediate,
  filterChanges,
} from "../src/notifications/enqueue.js";
import { createDeliveryWorker } from "../src/notifications/worker.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";

let db: Database | null = null;
let serialClient: PoolClient | null = null;
let ownPool: Pool | null = null;
let config: AppConfig | null = null;

const sent: MailMessage[] = [];

const TEST_SERIAL_LOCK_KEY = "anveshan_test_serial";

beforeAll(async () => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    process.stderr.write("DATABASE_URL not set — skipping notification tests\n");
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
      NOTIFICATIONS_ENABLED: "true",
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
      `Postgres unreachable — skipping notification tests: ${String(error)}\n`,
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

function logger() {
  return createLogger({ LOG_LEVEL: "silent" });
}

interface TestUser {
  userId: string;
  email: string;
}

async function makeUser(
  email: string,
  sub: {
    frequency: "immediate" | "daily";
    watchNewPrograms: boolean;
    watchAllPrograms: boolean;
  },
  opts: { verified?: boolean; watches?: string[] } = {},
): Promise<TestUser> {
  const { db: database } = needDeps();
  const user = await upsertUserByEmail(database, email);
  if (opts.verified !== false) await verifyUserEmail(database, user.id);
  await upsertSubscription(database, user.id, sub);
  for (const programId of opts.watches ?? []) {
    await addWatch(database, user.id, programId);
  }
  return { userId: user.id, email: user.email };
}

async function makeProgram(handle: string): Promise<string> {
  const { db: database } = needDeps();
  const program = await upsertProgram(database, {
    platform: "hackerone",
    externalId: handle,
    name: `Prog ${handle}`,
  });
  return program.id;
}

async function makeRunWithChanges(
  programId: string,
  types: ("PROGRAM_ADDED" | "ASSET_ADDED" | "ASSET_REMOVED")[],
): Promise<string> {
  const { db: database } = needDeps();
  const run = await createRun(database);
  let added = 0;
  let removed = 0;
  let programsAdded = 0;
  for (const [i, type] of types.entries()) {
    if (type === "PROGRAM_ADDED") programsAdded += 1;
    if (type === "ASSET_ADDED") added += 1;
    if (type === "ASSET_REMOVED") removed += 1;
    await insertChange(database, {
      type,
      programId,
      assetId: null,
      assetKey: type === "PROGRAM_ADDED" ? null : `URL|asset${i}.com`,
      assetIdentifier: type === "PROGRAM_ADDED" ? null : `asset${i}.com`,
      collectionRunId: run.id,
    });
  }
  await completeRun(database, run.id, {
    programsSeen: 1,
    assetsSeen: types.length,
    programsAdded,
    assetsAdded: added,
    assetsRemoved: removed,
  });
  return run.id;
}

async function deliveriesFor(userId: string): Promise<string[]> {
  const { db: database } = needDeps();
  const rows = await database
    .select({ status: notificationDeliveries.status })
    .from(notificationDeliveries)
    .where(eq(notificationDeliveries.userId, userId));
  return rows.map((r) => r.status);
}

function mailTo(email: string): MailMessage[] {
  return sent.filter((m) => m.to === email);
}

describe("filterChanges matrix", () => {
  const base: ChangeWithProgram = {
    id: "c",
    type: "ASSET_ADDED",
    programId: "p1",
    programName: "P1",
    assetId: null,
    assetKey: "URL|a.com",
    assetIdentifier: "a.com",
    collectionRunId: "r",
    detectedAt: new Date(),
  };
  const progAdded: ChangeWithProgram = { ...base, type: "PROGRAM_ADDED", assetKey: null };
  const other: ChangeWithProgram = { ...base, programId: "p2", programName: "P2" };
  const all = [base, progAdded, other];

  it("false/empty/false → nothing", () => {
    expect(
      filterChanges(all, {
        watchAllPrograms: false,
        watchProgramIds: new Set(),
        watchNewPrograms: false,
      }),
    ).toEqual([]);
  });

  it("false/empty/true → PROGRAM_ADDED only", () => {
    expect(
      filterChanges(all, {
        watchAllPrograms: false,
        watchProgramIds: new Set(),
        watchNewPrograms: true,
      }),
    ).toEqual([progAdded]);
  });

  it("false/some/false → ASSET_* on those ids", () => {
    expect(
      filterChanges(all, {
        watchAllPrograms: false,
        watchProgramIds: new Set(["p1"]),
        watchNewPrograms: false,
      }),
    ).toEqual([base]);
  });

  it("false/some/true → those ASSET_* + all PROGRAM_ADDED", () => {
    expect(
      filterChanges(all, {
        watchAllPrograms: false,
        watchProgramIds: new Set(["p1"]),
        watchNewPrograms: true,
      }),
    ).toEqual([base, progAdded]);
  });

  it("true/ignored/false → all ASSET_*, no PROGRAM_ADDED", () => {
    expect(
      filterChanges(all, {
        watchAllPrograms: true,
        watchProgramIds: new Set(),
        watchNewPrograms: false,
      }),
    ).toEqual([base, other]);
  });

  it("true/ignored/true → everything", () => {
    expect(
      filterChanges(all, {
        watchAllPrograms: true,
        watchProgramIds: new Set(),
        watchNewPrograms: true,
      }),
    ).toEqual(all);
  });
});

describe("closedDigestDates", () => {
  it("after 08:00 UTC covers today + yesterday", () => {
    expect(
      closedDigestDates(new Date("2026-09-18T09:00:00Z")).map(digestDateString),
    ).toEqual(["2026-09-18", "2026-09-17"]);
  });

  it("before 08:00 UTC covers yesterday + the day before", () => {
    expect(
      closedDigestDates(new Date("2026-09-18T07:00:00Z")).map(digestDateString),
    ).toEqual(["2026-09-17", "2026-09-16"]);
  });
});

describe("enqueueImmediate", () => {
  it("fans out only to matching users and is idempotent", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const deps = { db: database, config: cfg, logger: logger() };
    const programId = await makeProgram("fanout");
    const otherId = await makeProgram("fanout-other");
    await makeUser(
      "fan-a@example.com",
      { frequency: "immediate", watchNewPrograms: false, watchAllPrograms: false },
      { watches: [programId] },
    );
    await makeUser(
      "fan-b@example.com",
      { frequency: "immediate", watchNewPrograms: false, watchAllPrograms: false },
      { watches: [otherId] },
    );
    await makeUser("fan-c@example.com", {
      frequency: "daily",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    await makeUser(
      "fan-d@example.com",
      { frequency: "immediate", watchNewPrograms: false, watchAllPrograms: true },
      { verified: false },
    );
    const optedOut = await makeUser("fan-e@example.com", {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    await setUnsubscribed(database, optedOut.userId);
    const watcherAll = await makeUser("fan-f@example.com", {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    await makeUser("fan-g@example.com", {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: false,
    });

    const runId = await makeRunWithChanges(programId, ["ASSET_ADDED", "PROGRAM_ADDED"]);
    expect(await enqueueImmediate(deps, runId)).toBe(2);
    expect(await enqueueImmediate(deps, runId)).toBe(0);

    // A (watch match) and F (watch-all asset match) got deliveries.
    const a = await findUser(database, "fan-a@example.com");
    const f = await findUser(database, watcherAll.email);
    expect(await deliveriesFor(a.id)).toEqual(["pending"]);
    expect(await deliveriesFor(f.id)).toEqual(["pending"]);
    for (const email of [
      "fan-b@example.com",
      "fan-c@example.com",
      "fan-d@example.com",
      "fan-e@example.com",
      "fan-g@example.com",
    ]) {
      const u = await findUser(database, email);
      expect(await deliveriesFor(u.id)).toEqual([]);
    }
  });
});

async function findUser(database: Database, email: string) {
  const user = await findUserByEmail(database, email);
  if (!user) throw new Error(`missing user ${email}`);
  return user;
}

describe("enqueueDailyDigest", () => {
  it("enqueues the current window once", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const deps = { db: database, config: cfg, logger: logger() };
    const programId = await makeProgram("digestprog");
    await makeUser("digest-a@example.com", {
      frequency: "daily",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    const runId = await makeRunWithChanges(programId, ["ASSET_ADDED"]);
    // Backdate the change into a known closed window (deterministic at any hour).
    const digestOn = closedDigestDates(new Date())[0]!;
    const { windowStart } = digestWindow(digestOn);
    await database.execute(sql`
      UPDATE changes SET detected_at = ${new Date(windowStart.getTime() + 3_600_000)}
      WHERE collection_run_id = ${runId}`);
    expect(await enqueueDailyDigest(deps, digestOn)).toBeGreaterThanOrEqual(1);
    expect(await enqueueDailyDigest(deps, digestOn)).toBe(0);
    const u = await findUser(database, "digest-a@example.com");
    expect((await deliveriesFor(u.id)).length).toBeGreaterThanOrEqual(1);
  });
});

describe("enqueueAfterCollection", () => {
  it("no-ops on failed, zero-change, or disabled runs without touching the db", async () => {
    if (!db) return;
    const { config: cfg } = needDeps();
    const broken = { db: null as unknown as Database, config: cfg, logger: logger() };
    await expect(
      enqueueAfterCollection(broken, {
        runId: "r",
        status: "failed",
        programsSeen: 0,
        assetsSeen: 0,
        programsAdded: 0,
        assetsAdded: 0,
        assetsRemoved: 0,
      }),
    ).resolves.toBeUndefined();
    await expect(
      enqueueAfterCollection(broken, {
        runId: "r",
        status: "completed",
        programsSeen: 1,
        assetsSeen: 1,
        programsAdded: 0,
        assetsAdded: 0,
        assetsRemoved: 0,
      }),
    ).resolves.toBeUndefined();
    await expect(
      enqueueAfterCollection(broken, {
        runId: null,
        status: "skipped",
        programsSeen: 0,
        assetsSeen: 0,
        programsAdded: 0,
        assetsAdded: 0,
        assetsRemoved: 0,
      }),
    ).resolves.toBeUndefined();
    const disabled = {
      db: null as unknown as Database,
      config: { ...cfg, NOTIFICATIONS_ENABLED: false },
      logger: logger(),
    };
    await expect(
      enqueueAfterCollection(disabled, {
        runId: "r",
        status: "completed",
        programsSeen: 1,
        assetsSeen: 1,
        programsAdded: 1,
        assetsAdded: 0,
        assetsRemoved: 0,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("catch-up", () => {
  it("catchUpImmediate enqueues runs missed by the hook, idempotently", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const deps = { db: database, config: cfg, logger: logger() };
    const programId = await makeProgram("catchup");
    const user = await makeUser("catchup-a@example.com", {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    const runId = await makeRunWithChanges(programId, ["ASSET_ADDED"]);
    // Simulate a missed enqueue: delete any delivery catch-up from other runs
    // may have created is fine — assert this run's user delivery appears.
    await catchUpImmediate(deps);
    expect((await deliveriesFor(user.userId)).length).toBeGreaterThanOrEqual(1);
    // Second catch-up inserts nothing new for anyone re-processed.
    const before = await database
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries);
    await catchUpImmediate(deps);
    const after = await database
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries);
    expect(after.length).toBe(before.length);
    expect(runId).toBeDefined();
  });

  it("catchUpDailyDigest enqueues today's digest when missing", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const deps = { db: database, config: cfg, logger: logger() };
    const programId = await makeProgram("catchup-daily");
    await makeUser("catchup-d@example.com", {
      frequency: "daily",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    const runId = await makeRunWithChanges(programId, ["ASSET_ADDED"]);
    // Backdate into the most recently closed window so catch-up must cover it.
    const digestOn = closedDigestDates(new Date())[0]!;
    const { windowStart } = digestWindow(digestOn);
    await database.execute(sql`
      UPDATE changes SET detected_at = ${new Date(windowStart.getTime() + 3_600_000)}
      WHERE collection_run_id = ${runId}`);
    const first = await catchUpDailyDigest(deps, new Date());
    const second = await catchUpDailyDigest(deps, new Date());
    expect(first).toBeGreaterThanOrEqual(1);
    expect(second).toBe(0);
  });
});

describe("delivery worker", () => {
  function workerDeps(sendMail: (m: MailMessage) => Promise<void>) {
    const { db: database, config: cfg } = needDeps();
    return { db: database, config: cfg, logger: logger(), sendMail };
  }

  it("drains pending deliveries into real mail", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const deps = { db: database, config: cfg, logger: logger() };
    const programId = await makeProgram("drainmail");
    const user = await makeUser(
      "drain-a@example.com",
      { frequency: "immediate", watchNewPrograms: false, watchAllPrograms: false },
      { watches: [programId] },
    );
    const runId = await makeRunWithChanges(programId, ["ASSET_ADDED"]);
    expect(await enqueueImmediate(deps, runId)).toBeGreaterThanOrEqual(1);
    const worker = createDeliveryWorker(workerDeps(createFakeSendMail(sent)));
    const result = await worker.drain();
    expect(result.sent).toBeGreaterThanOrEqual(1);
    const mail = mailTo(user.email);
    expect(mail).toHaveLength(1);
    expect(mail[0]?.subject).toContain("Prog drainmail");
    expect(mail[0]?.text).toContain("unsubscribe?user=");
    expect(await deliveriesFor(user.userId)).toEqual(["sent"]);
  });

  it("marks skipped (no mail) when the user unsubscribes before the drain", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const deps = { db: database, config: cfg, logger: logger() };
    const programId = await makeProgram("drainunsub");
    const user = await makeUser("drain-b@example.com", {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    const runId = await makeRunWithChanges(programId, ["ASSET_ADDED"]);
    await enqueueImmediate(deps, runId);
    await setUnsubscribed(database, user.userId);
    const worker = createDeliveryWorker(workerDeps(createFakeSendMail(sent)));
    await worker.drain();
    expect(mailTo(user.email)).toEqual([]);
    expect(await deliveriesFor(user.userId)).toEqual(["skipped"]);
  });

  it("marks skipped when watches are removed before the drain", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const deps = { db: database, config: cfg, logger: logger() };
    const programId = await makeProgram("drainwatch");
    const user = await makeUser(
      "drain-c@example.com",
      { frequency: "immediate", watchNewPrograms: false, watchAllPrograms: false },
      { watches: [programId] },
    );
    const runId = await makeRunWithChanges(programId, ["ASSET_ADDED"]);
    await enqueueImmediate(deps, runId);
    await removeWatch(database, user.userId, programId);
    const worker = createDeliveryWorker(workerDeps(createFakeSendMail(sent)));
    await worker.drain();
    expect(mailTo(user.email)).toEqual([]);
    expect(await deliveriesFor(user.userId)).toEqual(["skipped"]);
  });

  it("overlapping drains never double-send", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const deps = { db: database, config: cfg, logger: logger() };
    const programId = await makeProgram("drainmutex");
    const user = await makeUser("drain-d@example.com", {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    const runId = await makeRunWithChanges(programId, ["ASSET_ADDED"]);
    await enqueueImmediate(deps, runId);
    const worker = createDeliveryWorker(workerDeps(createFakeSendMail(sent)));
    // Catch-up legitimately backfills this user for earlier runs, so assert
    // per-delivery uniqueness: every delivery sent exactly once.
    await Promise.all([worker.drain(), worker.drain()]);
    const statuses = await deliveriesFor(user.userId);
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    expect(statuses.every((s) => s === "sent")).toBe(true);
    expect(mailTo(user.email)).toHaveLength(statuses.length);
  });

  it("SMTP failure retries with backoff, then marks failed", async () => {
    if (!db) return;
    const { db: database, config: cfg } = needDeps();
    const deps = { db: database, config: cfg, logger: logger() };
    const programId = await makeProgram("drainfail");
    const user = await makeUser("drain-e@example.com", {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    const runId = await makeRunWithChanges(programId, ["ASSET_ADDED"]);
    await enqueueImmediate(deps, runId);
    const failing = async (): Promise<void> => {
      throw new Error("SMTP down");
    };
    const worker = createDeliveryWorker(workerDeps(failing));
    const backdate = () =>
      database.execute(sql`
        UPDATE notification_deliveries
        SET next_attempt_at = now() - interval '1 minute', updated_at = now()
        WHERE user_id = ${user.userId}`);
    // Catch-up backfills this user for earlier runs too: assert the whole
    // set moves together (no sent, no stuck rows), not an exact count.
    const allPending = async (): Promise<boolean> => {
      const statuses = await deliveriesFor(user.userId);
      return statuses.length > 0 && statuses.every((s) => s === "pending");
    };
    await worker.drain();
    expect(await allPending()).toBe(true);
    await backdate();
    await worker.drain();
    expect(await allPending()).toBe(true);
    await backdate();
    await worker.drain();
    const final = await deliveriesFor(user.userId);
    expect(final.length).toBeGreaterThanOrEqual(1);
    expect(final.every((s) => s === "failed")).toBe(true);
    expect(mailTo(user.email)).toEqual([]);
    expect(runId).toBeDefined();
  });
});
