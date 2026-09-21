import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";
import { loadConfig } from "@anveshan/config";
import {
  addWatch,
  claimDeliveries,
  clearUnsubscribed,
  closePool,
  completeRun,
  consumeMagicLinkToken,
  createDb,
  createPool,
  createRun,
  deleteSessionByHash,
  enqueueDailyDelivery,
  enqueueImmediateDelivery,
  findChangesByRun,
  findChangesInWindow,
  findEligibleUsers,
  findRunsWithChangesSince,
  findSessionByHash,
  findSubscription,
  findUserByEmail,
  findValidMagicLinkToken,
  findWatchProgramIds,
  insertChange,
  insertMagicLinkToken,
  insertSession,
  invalidateUserTokens,
  listWatches,
  markDeliveryFailed,
  markDeliverySent,
  markDeliverySkipped,
  removeWatch,
  resetStaleSending,
  retryDeliveryLater,
  runMigrations,
  setUnsubscribed,
  truncateAll,
  upsertProgram,
  upsertSubscription,
  upsertUserByEmail,
  verifyUserEmail,
} from "../src/index.js";
import type { Database } from "../src/index.js";

let db: Database | null = null;
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

function needDb(): Database {
  if (!db) throw new Error("database unavailable");
  return db;
}

describe("notification repositories", () => {
  it("upserts users by lowercased email", async () => {
    if (!db) return;
    const first = await upsertUserByEmail(needDb(), "Alice@Example.com");
    const second = await upsertUserByEmail(needDb(), "alice@example.com");
    expect(second.id).toBe(first.id);
    expect(first.email).toBe("alice@example.com");
    expect(first.emailVerifiedAt).toBeNull();
    expect(await findUserByEmail(needDb(), "ALICE@EXAMPLE.COM")).toMatchObject({
      id: first.id,
    });
  });

  it("verifyUserEmail sets once and preserves the first timestamp", async () => {
    if (!db) return;
    const user = await upsertUserByEmail(needDb(), "verify@example.com");
    await verifyUserEmail(needDb(), user.id);
    const once = await findUserByEmail(needDb(), "verify@example.com");
    expect(once?.emailVerifiedAt).toBeInstanceOf(Date);
    await verifyUserEmail(needDb(), user.id);
    const twice = await findUserByEmail(needDb(), "verify@example.com");
    expect(twice?.emailVerifiedAt?.getTime()).toBe(once?.emailVerifiedAt?.getTime());
  });

  it("magic-link token lifecycle: insert, find, consume, invalidate", async () => {
    if (!db) return;
    const user = await upsertUserByEmail(needDb(), "token@example.com");
    const expires = new Date(Date.now() + 15 * 60_000);
    const token = await insertMagicLinkToken(needDb(), user.id, "hash-1", expires);
    expect(await findValidMagicLinkToken(needDb(), "hash-1")).toMatchObject({
      id: token.id,
    });
    await consumeMagicLinkToken(needDb(), token.id);
    expect(await findValidMagicLinkToken(needDb(), "hash-1")).toBeUndefined();

    const expired = await insertMagicLinkToken(
      needDb(),
      user.id,
      "hash-expired",
      new Date(Date.now() - 1000),
    );
    expect(await findValidMagicLinkToken(needDb(), "hash-expired")).toBeUndefined();
    expect(expired.id).toBeDefined();

    await insertMagicLinkToken(needDb(), user.id, "hash-2", expires);
    await insertMagicLinkToken(needDb(), user.id, "hash-3", expires);
    // hash-expired is expired but unconsumed, so it is invalidated too.
    expect(await invalidateUserTokens(needDb(), user.id)).toBe(3);
    expect(await findValidMagicLinkToken(needDb(), "hash-2")).toBeUndefined();
    expect(await findValidMagicLinkToken(needDb(), "hash-3")).toBeUndefined();
  });

  it("sessions: insert, find, delete", async () => {
    if (!db) return;
    const user = await upsertUserByEmail(needDb(), "session@example.com");
    const session = await insertSession(
      needDb(),
      user.id,
      "sess-hash",
      new Date(Date.now() + 30 * 24 * 3600_000),
    );
    expect(await findSessionByHash(needDb(), "sess-hash")).toMatchObject({
      id: session.id,
    });
    await deleteSessionByHash(needDb(), "sess-hash");
    expect(await findSessionByHash(needDb(), "sess-hash")).toBeUndefined();
  });

  it("subscriptions upsert and watches add/list/remove", async () => {
    if (!db) return;
    const user = await upsertUserByEmail(needDb(), "sub@example.com");
    expect(await findSubscription(needDb(), user.id)).toBeUndefined();
    const program = await upsertProgram(needDb(), {
      platform: "hackerone",
      externalId: "watchme",
      name: "Watch Me",
    });
    await upsertSubscription(needDb(), user.id, {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: false,
    });
    await addWatch(needDb(), user.id, program.id);
    await addWatch(needDb(), user.id, program.id);
    expect(await findWatchProgramIds(needDb(), user.id)).toEqual([program.id]);
    expect(await listWatches(needDb(), user.id)).toMatchObject([
      { programId: program.id, name: "Watch Me", externalId: "watchme" },
    ]);
    await removeWatch(needDb(), user.id, program.id);
    expect(await findWatchProgramIds(needDb(), user.id)).toEqual([]);
  });

  it("upsertSubscription defaults digest prefs and round-trips custom values", async () => {
    if (!db) return;
    const user = await upsertUserByEmail(needDb(), "digestpref@example.com");
    await verifyUserEmail(needDb(), user.id);
    const created = await upsertSubscription(needDb(), user.id, {
      frequency: "daily",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    expect(created.digestTimezone).toBe("UTC");
    expect(created.digestTimeLocal).toBe("08:00:00");
    const updated = await upsertSubscription(needDb(), user.id, {
      frequency: "daily",
      watchNewPrograms: false,
      watchAllPrograms: true,
      digestTimezone: "Asia/Kolkata",
      digestTimeLocal: "13:30",
    });
    expect(updated.digestTimezone).toBe("Asia/Kolkata");
    expect(updated.digestTimeLocal).toBe("13:30:00");
    // Omitted digest fields leave stored values unchanged.
    const kept = await upsertSubscription(needDb(), user.id, {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    expect(kept.digestTimezone).toBe("Asia/Kolkata");
    expect(kept.digestTimeLocal).toBe("13:30:00");
    const eligible = await findEligibleUsers(needDb(), "immediate");
    const row = eligible.find((u) => u.userId === user.id);
    expect(row?.digestTimezone).toBe("Asia/Kolkata");
    expect(row?.digestTimeLocal).toBe("13:30:00");
  });

  it("findEligibleUsers filters by verified, subscribed, frequency", async () => {
    if (!db) return;
    const immediate = await upsertUserByEmail(needDb(), "elig-immediate@example.com");
    await verifyUserEmail(needDb(), immediate.id);
    await upsertSubscription(needDb(), immediate.id, {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    const unverified = await upsertUserByEmail(needDb(), "elig-unverified@example.com");
    await upsertSubscription(needDb(), unverified.id, {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    const optedOut = await upsertUserByEmail(needDb(), "elig-optout@example.com");
    await verifyUserEmail(needDb(), optedOut.id);
    await upsertSubscription(needDb(), optedOut.id, {
      frequency: "immediate",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });
    await setUnsubscribed(needDb(), optedOut.id);
    const daily = await upsertUserByEmail(needDb(), "elig-daily@example.com");
    await verifyUserEmail(needDb(), daily.id);
    await upsertSubscription(needDb(), daily.id, {
      frequency: "daily",
      watchNewPrograms: false,
      watchAllPrograms: true,
    });

    const immediates = await findEligibleUsers(needDb(), "immediate");
    const emails = immediates.map((u) => u.email);
    expect(emails).toContain("elig-immediate@example.com");
    expect(emails).not.toContain("elig-unverified@example.com");
    expect(emails).not.toContain("elig-optout@example.com");
    expect(emails).not.toContain("elig-daily@example.com");

    await clearUnsubscribed(needDb(), optedOut.id);
    const afterResub = await findEligibleUsers(needDb(), "immediate");
    expect(afterResub.map((u) => u.email)).toContain("elig-optout@example.com");
  });

  it("enqueueImmediateDelivery is idempotent", async () => {
    if (!db) return;
    const user = await upsertUserByEmail(needDb(), "idem@example.com");
    const run = await createRun(needDb());
    expect(await enqueueImmediateDelivery(needDb(), user.id, run.id)).toBe(true);
    expect(await enqueueImmediateDelivery(needDb(), user.id, run.id)).toBe(false);
  });

  it("enqueueDailyDelivery is idempotent per close instant", async () => {
    if (!db) return;
    const user = await upsertUserByEmail(needDb(), "idem-daily@example.com");
    const closeA = new Date("2026-09-18T08:00:00Z");
    const closeB = new Date("2026-09-18T23:30:00Z");
    expect(await enqueueDailyDelivery(needDb(), user.id, "2026-09-18", closeA)).toBe(
      true,
    );
    expect(await enqueueDailyDelivery(needDb(), user.id, "2026-09-18", closeA)).toBe(
      false,
    );
    // Same UTC date but a different close (23h DST day) is a new digest.
    expect(await enqueueDailyDelivery(needDb(), user.id, "2026-09-18", closeB)).toBe(
      true,
    );
    // Same close instant under a different date string is the same digest.
    expect(await enqueueDailyDelivery(needDb(), user.id, "2026-09-19", closeA)).toBe(
      false,
    );
    expect(
      await enqueueDailyDelivery(
        needDb(),
        user.id,
        "2026-09-19",
        new Date("2026-09-19T08:00:00Z"),
      ),
    ).toBe(true);
  });

  it("claimDeliveries claims once; second claim is empty", async () => {
    if (!db) return;
    const user = await upsertUserByEmail(needDb(), "claim@example.com");
    const run = await createRun(needDb());
    await enqueueImmediateDelivery(needDb(), user.id, run.id);
    const first = await claimDeliveries(needDb(), 50);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((d) => d.status === "sending")).toBe(true);
    expect(first.every((d) => d.attempts === 1)).toBe(true);
    expect(await claimDeliveries(needDb(), 50)).toEqual([]);
  });

  it("resetStaleSending requeues crashes without exhausting retries", async () => {
    if (!db) return;
    const user = await upsertUserByEmail(needDb(), "stale@example.com");
    const run = await createRun(needDb());
    await enqueueImmediateDelivery(needDb(), user.id, run.id);
    const [claimed] = await claimDeliveries(needDb(), 50);
    expect(claimed).toBeDefined();
    // Backdate updated_at to simulate a crash 11 minutes ago.
    await needDb().execute(sql`
      UPDATE notification_deliveries
      SET updated_at = now() - interval '11 minutes'
      WHERE id = ${claimed!.id}`);
    expect(await resetStaleSending(needDb(), 10 * 60_000)).toBe(1);
    const reclaimed = await claimDeliveries(needDb(), 50);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]?.attempts).toBe(1);
  });

  it("delivery status transitions: sent, skipped, failed, retry", async () => {
    if (!db) return;
    const user = await upsertUserByEmail(needDb(), "trans@example.com");
    const run = await createRun(needDb());
    await enqueueImmediateDelivery(needDb(), user.id, run.id);
    const [claimed] = await claimDeliveries(needDb(), 50);
    await markDeliverySent(needDb(), claimed!.id);
    await enqueueDailyDelivery(
      needDb(),
      user.id,
      "2026-09-18",
      new Date("2026-09-18T08:00:00Z"),
    );
    await enqueueDailyDelivery(
      needDb(),
      user.id,
      "2026-09-19",
      new Date("2026-09-19T08:00:00Z"),
    );
    await enqueueDailyDelivery(
      needDb(),
      user.id,
      "2026-09-20",
      new Date("2026-09-20T08:00:00Z"),
    );
    const batch = await claimDeliveries(needDb(), 50);
    expect(batch).toHaveLength(3);
    await markDeliverySkipped(needDb(), batch[0]!.id);
    await markDeliveryFailed(needDb(), batch[1]!.id, "boom");
    await retryDeliveryLater(needDb(), batch[2]!.id, batch[2]!.attempts, "timeout");
    // Failed + skipped rows are never reclaimed; retry row waits for backoff.
    expect(await claimDeliveries(needDb(), 50)).toEqual([]);
    expect(await resetStaleSending(needDb(), 10 * 60_000)).toBe(0);
  });

  it("findChangesByRun, findChangesInWindow, findRunsWithChangesSince", async () => {
    if (!db) return;
    const program = await upsertProgram(needDb(), {
      platform: "hackerone",
      externalId: "changesprog",
      name: "Changes Prog",
    });
    const run = await createRun(needDb());
    await insertChange(needDb(), {
      type: "PROGRAM_ADDED",
      programId: program.id,
      assetId: null,
      assetKey: null,
      assetIdentifier: null,
      collectionRunId: run.id,
    });
    await completeRun(needDb(), run.id, {
      programsSeen: 1,
      assetsSeen: 0,
      programsAdded: 1,
      assetsAdded: 0,
      assetsRemoved: 0,
    });

    const byRun = await findChangesByRun(needDb(), run.id);
    expect(byRun).toHaveLength(1);
    expect(byRun[0]).toMatchObject({
      programId: program.id,
      programName: "Changes Prog",
    });

    const byWindow = await findChangesInWindow(
      needDb(),
      new Date(Date.now() - 3600_000),
      new Date(Date.now() + 3600_000),
    );
    expect(byWindow.map((c) => c.id)).toContain(byRun[0]!.id);

    const runs = await findRunsWithChangesSince(
      needDb(),
      new Date(Date.now() - 24 * 3600_000),
    );
    expect(runs.map((r) => r.id)).toContain(run.id);
  });
});
