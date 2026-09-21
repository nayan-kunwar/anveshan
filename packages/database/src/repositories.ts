import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  notInArray,
  sql,
} from "drizzle-orm";
import type {
  AssetRow,
  DeliveryRow,
  MagicLinkTokenRow,
  NewChangeRow,
  ProgramRow,
  SessionRow,
  SubscriptionRow,
  UserRow,
} from "./schema.js";
import {
  assetSnapshots,
  assets,
  changes,
  collectionRuns,
  magicLinkTokens,
  notificationDeliveries,
  programSnapshots,
  programs,
  sessions,
  subscriptions,
  users,
  watches,
} from "./schema.js";
import type { Db } from "./db.js";

// --- programs ---

export interface UpsertProgramInput {
  platform: string;
  externalId: string;
  name: string;
  url?: string | undefined;
  externalNumericId?: string | undefined;
}

export async function upsertProgram(
  db: Db,
  input: UpsertProgramInput,
): Promise<ProgramRow> {
  const externalIdLower = input.externalId.toLowerCase();
  const rows = await db
    .insert(programs)
    .values({
      platform: input.platform,
      externalId: input.externalId,
      externalIdLower,
      externalNumericId: input.externalNumericId ?? null,
      name: input.name,
      url: input.url ?? null,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [programs.platform, programs.externalIdLower],
      set: {
        name: input.name,
        url: input.url ?? null,
        externalNumericId: input.externalNumericId ?? null,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("upsertProgram returned no row");
  return row;
}

export async function findAllPrograms(
  db: Db,
): Promise<Pick<ProgramRow, "id" | "platform" | "externalIdLower">[]> {
  return db
    .select({
      id: programs.id,
      platform: programs.platform,
      externalIdLower: programs.externalIdLower,
    })
    .from(programs);
}

export async function findProgramById(
  db: Db,
  id: string,
): Promise<ProgramRow | undefined> {
  const rows = await db.select().from(programs).where(eq(programs.id, id)).limit(1);
  return rows[0];
}

export async function countPrograms(db: Db): Promise<number> {
  const rows = await db.select({ value: count() }).from(programs);
  return rows[0]?.value ?? 0;
}

export async function listPrograms(
  db: Db,
  page: number,
  pageSize: number,
): Promise<{ items: ProgramRow[]; total: number }> {
  const totalRows = await db.select({ value: count() }).from(programs);
  const total = totalRows[0]?.value ?? 0;
  const items = await db
    .select()
    .from(programs)
    .orderBy(programs.name)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, total };
}

// --- assets ---

export interface UpsertAssetInput {
  programId: string;
  externalId?: string | undefined;
  identifier: string;
  normalizedIdentifier: string;
  type: string;
  scope: "IN" | "OUT";
}

export async function upsertAsset(db: Db, input: UpsertAssetInput): Promise<AssetRow> {
  const assetKey = `${input.type}|${input.normalizedIdentifier}`;
  const rows = await db
    .insert(assets)
    .values({
      programId: input.programId,
      externalId: input.externalId ?? null,
      identifier: input.identifier,
      normalizedIdentifier: input.normalizedIdentifier,
      type: input.type,
      scope: input.scope,
      assetKey,
    })
    .onConflictDoUpdate({
      target: [assets.programId, assets.assetKey],
      set: {
        externalId: input.externalId ?? null,
        identifier: input.identifier,
        normalizedIdentifier: input.normalizedIdentifier,
        type: input.type,
        scope: input.scope,
        updatedAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("upsertAsset returned no row");
  return row;
}

export type LiveAsset = Pick<AssetRow, "id" | "assetKey" | "scope" | "identifier">;

export async function findAssetsByProgram(
  db: Db,
  programId: string,
): Promise<LiveAsset[]> {
  return db
    .select({
      id: assets.id,
      assetKey: assets.assetKey,
      scope: assets.scope,
      identifier: assets.identifier,
    })
    .from(assets)
    .where(eq(assets.programId, programId));
}

/**
 * Reconcile missing scopes: every live row for this program whose key was
 * NOT in the latest fetch is flipped to OUT (never deleted).
 */
export async function markMissingAssetsOut(
  db: Db,
  programId: string,
  seenKeys: string[],
): Promise<void> {
  if (seenKeys.length === 0) {
    await db
      .update(assets)
      .set({ scope: "OUT", updatedAt: new Date() })
      .where(eq(assets.programId, programId));
    return;
  }
  await db
    .update(assets)
    .set({ scope: "OUT", updatedAt: new Date() })
    .where(and(eq(assets.programId, programId), notInArray(assets.assetKey, seenKeys)));
}

export async function listAssets(
  db: Db,
  programId: string,
  scope: "ALL" | "IN" | "OUT",
  page: number,
  pageSize: number,
): Promise<{ items: AssetRow[]; total: number }> {
  const where =
    scope === "ALL"
      ? eq(assets.programId, programId)
      : and(eq(assets.programId, programId), eq(assets.scope, scope));
  const totalRows = await db.select({ value: count() }).from(assets).where(where);
  const total = totalRows[0]?.value ?? 0;
  const items = await db
    .select()
    .from(assets)
    .where(where)
    .orderBy(assets.identifier)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, total };
}

// --- collection runs ---

export async function createRun(db: Db): Promise<{ id: string }> {
  const rows = await db
    .insert(collectionRuns)
    .values({ status: "running" })
    .returning({ id: collectionRuns.id });
  const row = rows[0];
  if (!row) throw new Error("createRun returned no row");
  return row;
}

export interface RunStats {
  programsSeen: number;
  assetsSeen: number;
  programsAdded: number;
  assetsAdded: number;
  assetsRemoved: number;
}

export async function completeRun(db: Db, id: string, stats: RunStats): Promise<void> {
  await db
    .update(collectionRuns)
    .set({ status: "completed", completedAt: new Date(), ...stats })
    .where(eq(collectionRuns.id, id));
}

export async function failRun(
  db: Db,
  id: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(collectionRuns)
    .set({ status: "failed", completedAt: new Date(), errorCode, errorMessage })
    .where(eq(collectionRuns.id, id));
}

export async function countCompletedRuns(db: Db): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(collectionRuns)
    .where(eq(collectionRuns.status, "completed"));
  return rows[0]?.value ?? 0;
}

export async function failStaleRunningRuns(db: Db, staleMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await db
    .update(collectionRuns)
    .set({
      status: "failed",
      completedAt: new Date(),
      errorCode: "COLLECTION_FAILED",
      errorMessage: "stale running row",
    })
    .where(
      and(eq(collectionRuns.status, "running"), lt(collectionRuns.startedAt, cutoff)),
    )
    .returning({ id: collectionRuns.id });
  return rows.length;
}

// --- snapshots (pointers) ---

export async function insertProgramSnapshot(
  db: Db,
  runId: string,
  programId: string,
): Promise<void> {
  await db
    .insert(programSnapshots)
    .values({ collectionRunId: runId, programId })
    .onConflictDoNothing();
}

export async function insertAssetSnapshot(
  db: Db,
  runId: string,
  programId: string,
  assetId: string,
  assetKey: string,
): Promise<void> {
  await db
    .insert(assetSnapshots)
    .values({ collectionRunId: runId, programId, assetId, assetKey })
    .onConflictDoNothing();
}

// --- changes ---

export type NewChangeInput = Omit<NewChangeRow, "id" | "detectedAt">;

export async function insertChange(db: Db, input: NewChangeInput): Promise<void> {
  // Bare ON CONFLICT DO NOTHING: set-diff guarantees no duplicates;
  // the partial unique indexes are the backstop.
  await db.insert(changes).values(input).onConflictDoNothing();
}

export async function listChanges(
  db: Db,
  programId: string,
  since: Date | undefined,
  page: number,
  pageSize: number,
): Promise<{ items: (typeof changes.$inferSelect)[]; total: number }> {
  const where =
    since === undefined
      ? eq(changes.programId, programId)
      : and(eq(changes.programId, programId), gte(changes.detectedAt, since));
  const totalRows = await db.select({ value: count() }).from(changes).where(where);
  const total = totalRows[0]?.value ?? 0;
  const items = await db
    .select()
    .from(changes)
    .where(where)
    .orderBy(desc(changes.detectedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  return { items, total };
}

/** Test helper: wipe all rows (never used in production code paths). */
export async function truncateAll(db: Db): Promise<void> {
  await db.execute(
    sql`TRUNCATE notification_deliveries, watches, subscriptions, sessions, magic_link_tokens, users, changes, asset_snapshots, program_snapshots, assets, programs, collection_runs`,
  );
}

// --- Milestone 2: users ---

export async function upsertUserByEmail(db: Db, email: string): Promise<UserRow> {
  const lower = email.toLowerCase();
  const inserted = await db
    .insert(users)
    .values({ email: lower })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (inserted[0]) return inserted[0];
  const rows = await db.select().from(users).where(eq(users.email, lower)).limit(1);
  const row = rows[0];
  if (!row) throw new Error("upsertUserByEmail returned no row");
  return row;
}

export async function findUserById(db: Db, id: string): Promise<UserRow | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function findUserByEmail(
  db: Db,
  email: string,
): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1);
  return rows[0];
}

/** Set email_verified_at on first successful verify; preserves the original. */
export async function verifyUserEmail(db: Db, userId: string): Promise<void> {
  await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)));
}

export async function setUnsubscribed(db: Db, userId: string): Promise<void> {
  await db.update(users).set({ unsubscribedAt: new Date() }).where(eq(users.id, userId));
}

export async function clearUnsubscribed(db: Db, userId: string): Promise<void> {
  await db.update(users).set({ unsubscribedAt: null }).where(eq(users.id, userId));
}

// --- Milestone 2: magic-link tokens ---

export async function insertMagicLinkToken(
  db: Db,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<MagicLinkTokenRow> {
  const rows = await db
    .insert(magicLinkTokens)
    .values({ userId, tokenHash, expiresAt })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("insertMagicLinkToken returned no row");
  return row;
}

export async function findValidMagicLinkToken(
  db: Db,
  tokenHash: string,
): Promise<MagicLinkTokenRow | undefined> {
  const rows = await db
    .select()
    .from(magicLinkTokens)
    .where(
      and(
        eq(magicLinkTokens.tokenHash, tokenHash),
        isNull(magicLinkTokens.consumedAt),
        gte(magicLinkTokens.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function consumeMagicLinkToken(db: Db, id: string): Promise<void> {
  await db
    .update(magicLinkTokens)
    .set({ consumedAt: new Date() })
    .where(eq(magicLinkTokens.id, id));
}

/** Invalidate all unconsumed tokens for a user (called when issuing a new link). */
export async function invalidateUserTokens(db: Db, userId: string): Promise<number> {
  const rows = await db
    .update(magicLinkTokens)
    .set({ consumedAt: new Date() })
    .where(and(eq(magicLinkTokens.userId, userId), isNull(magicLinkTokens.consumedAt)))
    .returning({ id: magicLinkTokens.id });
  return rows.length;
}

// --- Milestone 2: sessions ---

export async function insertSession(
  db: Db,
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<SessionRow> {
  const rows = await db
    .insert(sessions)
    .values({ userId, tokenHash, expiresAt })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("insertSession returned no row");
  return row;
}

export async function findSessionByHash(
  db: Db,
  tokenHash: string,
): Promise<SessionRow | undefined> {
  const rows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  return rows[0];
}

export async function deleteSessionByHash(db: Db, tokenHash: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

// --- Milestone 2: subscriptions + watches ---

export interface UpsertSubscriptionInput {
  frequency: "immediate" | "daily";
  watchNewPrograms: boolean;
  watchAllPrograms: boolean;
  /** IANA timezone for the daily close. Omitted = leave stored value. */
  digestTimezone?: string | undefined;
  /** Wall-clock "HH:MM" daily close. Omitted = leave stored value. */
  digestTimeLocal?: string | undefined;
}

export async function upsertSubscription(
  db: Db,
  userId: string,
  input: UpsertSubscriptionInput,
): Promise<SubscriptionRow> {
  const patch: {
    frequency: "immediate" | "daily";
    watchNewPrograms: boolean;
    watchAllPrograms: boolean;
    digestTimezone?: string;
    digestTimeLocal?: string;
    updatedAt: Date;
  } = {
    frequency: input.frequency,
    watchNewPrograms: input.watchNewPrograms,
    watchAllPrograms: input.watchAllPrograms,
    updatedAt: new Date(),
  };
  if (input.digestTimezone !== undefined) patch.digestTimezone = input.digestTimezone;
  if (input.digestTimeLocal !== undefined) patch.digestTimeLocal = input.digestTimeLocal;
  const rows = await db
    .insert(subscriptions)
    .values({ userId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("upsertSubscription returned no row");
  return row;
}

export async function findSubscription(
  db: Db,
  userId: string,
): Promise<SubscriptionRow | undefined> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  return rows[0];
}

export async function addWatch(db: Db, userId: string, programId: string): Promise<void> {
  await db.insert(watches).values({ userId, programId }).onConflictDoNothing();
}

export async function removeWatch(
  db: Db,
  userId: string,
  programId: string,
): Promise<void> {
  await db
    .delete(watches)
    .where(and(eq(watches.userId, userId), eq(watches.programId, programId)));
}

export async function findWatchProgramIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .select({ programId: watches.programId })
    .from(watches)
    .where(eq(watches.userId, userId));
  return rows.map((r) => r.programId);
}

export interface WatchedProgram {
  programId: string;
  name: string;
  externalId: string;
}

export async function listWatches(db: Db, userId: string): Promise<WatchedProgram[]> {
  return db
    .select({
      programId: programs.id,
      name: programs.name,
      externalId: programs.externalId,
    })
    .from(watches)
    .innerJoin(programs, eq(watches.programId, programs.id))
    .where(eq(watches.userId, userId))
    .orderBy(programs.name);
}

// --- Milestone 2: notification deliveries ---

export interface ChangeWithProgram {
  id: string;
  type: string;
  programId: string;
  programName: string;
  assetId: string | null;
  assetKey: string | null;
  assetIdentifier: string | null;
  collectionRunId: string;
  detectedAt: Date;
}

/** Load a run's changes once (enqueue fans out per user in memory). */
export async function findChangesByRun(
  db: Db,
  runId: string,
): Promise<ChangeWithProgram[]> {
  return db
    .select({
      id: changes.id,
      type: changes.type,
      programId: changes.programId,
      programName: programs.name,
      assetId: changes.assetId,
      assetKey: changes.assetKey,
      assetIdentifier: changes.assetIdentifier,
      collectionRunId: changes.collectionRunId,
      detectedAt: changes.detectedAt,
    })
    .from(changes)
    .innerJoin(programs, eq(changes.programId, programs.id))
    .where(eq(changes.collectionRunId, runId))
    .orderBy(programs.name, changes.detectedAt);
}

/** Load a digest window's changes once (same shape as findChangesByRun). */
export async function findChangesInWindow(
  db: Db,
  windowStart: Date,
  windowEnd: Date,
): Promise<ChangeWithProgram[]> {
  return db
    .select({
      id: changes.id,
      type: changes.type,
      programId: changes.programId,
      programName: programs.name,
      assetId: changes.assetId,
      assetKey: changes.assetKey,
      assetIdentifier: changes.assetIdentifier,
      collectionRunId: changes.collectionRunId,
      detectedAt: changes.detectedAt,
    })
    .from(changes)
    .innerJoin(programs, eq(changes.programId, programs.id))
    .where(and(gte(changes.detectedAt, windowStart), lt(changes.detectedAt, windowEnd)))
    .orderBy(programs.name, changes.detectedAt);
}

export interface EligibleUser {
  userId: string;
  email: string;
  frequency: string;
  watchNewPrograms: boolean;
  watchAllPrograms: boolean;
  digestTimezone: string;
  digestTimeLocal: string;
}

/** Verified, subscribed, not globally unsubscribed — for one cadence. */
export async function findEligibleUsers(
  db: Db,
  frequency: "immediate" | "daily",
): Promise<EligibleUser[]> {
  return db
    .select({
      userId: users.id,
      email: users.email,
      frequency: subscriptions.frequency,
      watchNewPrograms: subscriptions.watchNewPrograms,
      watchAllPrograms: subscriptions.watchAllPrograms,
      digestTimezone: subscriptions.digestTimezone,
      digestTimeLocal: subscriptions.digestTimeLocal,
    })
    .from(users)
    .innerJoin(subscriptions, eq(subscriptions.userId, users.id))
    .where(
      and(
        eq(subscriptions.frequency, frequency),
        isNull(users.unsubscribedAt),
        isNotNull(users.emailVerifiedAt),
      ),
    );
}

/** Recent completed runs that produced changes (catch-up source). */
export async function findRunsWithChangesSince(
  db: Db,
  since: Date,
): Promise<{ id: string }[]> {
  return db
    .select({ id: collectionRuns.id })
    .from(collectionRuns)
    .where(
      and(
        eq(collectionRuns.status, "completed"),
        gte(collectionRuns.completedAt, since),
        sql`(${collectionRuns.programsAdded} + ${collectionRuns.assetsAdded} + ${collectionRuns.assetsRemoved}) > 0`,
      ),
    )
    .orderBy(collectionRuns.completedAt);
}

/**
 * Idempotent enqueue: second call for the same (user, run) inserts nothing.
 * Partial-unique inference (target + where) — verified by Phase 0 spike.
 */
export async function enqueueImmediateDelivery(
  db: Db,
  userId: string,
  runId: string,
): Promise<boolean> {
  const rows = await db
    .insert(notificationDeliveries)
    .values({ userId, collectionRunId: runId, channel: "email", kind: "immediate" })
    .onConflictDoNothing({
      target: [
        notificationDeliveries.userId,
        notificationDeliveries.collectionRunId,
        notificationDeliveries.channel,
      ],
      where: sql`${notificationDeliveries.kind} = 'immediate'`,
    })
    .returning({ id: notificationDeliveries.id });
  return rows.length > 0;
}

/**
 * Idempotent enqueue: second call for the same close instant inserts
 * nothing. Uniqueness is on (user, close instant), not the calendar
 * date — on a 23-hour DST day two closes can share one UTC date.
 */
export async function enqueueDailyDelivery(
  db: Db,
  userId: string,
  digestOn: string,
  digestCloseAt: Date,
): Promise<boolean> {
  const rows = await db
    .insert(notificationDeliveries)
    .values({ userId, digestOn, digestCloseAt, channel: "email", kind: "daily" })
    .onConflictDoNothing({
      target: [
        notificationDeliveries.userId,
        notificationDeliveries.digestCloseAt,
        notificationDeliveries.channel,
      ],
      where: sql`${notificationDeliveries.kind} = 'daily'`,
    })
    .returning({ id: notificationDeliveries.id });
  return rows.length > 0;
}

/**
 * Stale recovery (process crash only — the drain mutex means a live
 * process never leaves `sending` rows for 10 minutes). Decrement attempts
 * because the claimed attempt never ran; a crash loop still caps at 3.
 */
export async function resetStaleSending(db: Db, staleMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleMs);
  const rows = await db
    .update(notificationDeliveries)
    .set({
      status: "pending",
      attempts: sql`GREATEST(${notificationDeliveries.attempts} - 1, 0)`,
      nextAttemptAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(notificationDeliveries.status, "sending"),
        lt(notificationDeliveries.updatedAt, cutoff),
      ),
    )
    .returning({ id: notificationDeliveries.id });
  return rows.length;
}

/**
 * Atomically claim up to `limit` pending rows. Single statement:
 * concurrent workers never double-claim (FOR UPDATE SKIP LOCKED).
 */
export async function claimDeliveries(db: Db, limit: number): Promise<DeliveryRow[]> {
  const result = await db.execute<DeliveryRow>(sql`
    WITH claimed AS (
      SELECT id FROM notification_deliveries
      WHERE status = 'pending'
        AND attempts < 3
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    UPDATE notification_deliveries d
    SET status = 'sending',
        attempts = d.attempts + 1,
        next_attempt_at = NULL,
        updated_at = now()
    FROM claimed
    WHERE d.id = claimed.id
    RETURNING d.*`);
  return (result.rows as Record<string, unknown>[]).map(mapDeliveryRow);
}

function mapDeliveryRow(r: Record<string, unknown>): DeliveryRow {
  return {
    id: r["id"] as string,
    userId: r["user_id"] as string,
    channel: r["channel"] as string,
    kind: r["kind"] as string,
    collectionRunId: r["collection_run_id"] as string | null,
    digestOn: r["digest_on"] as string | null,
    digestCloseAt: r["digest_close_at"] as Date | null,
    status: r["status"] as string,
    attempts: r["attempts"] as number,
    nextAttemptAt: r["next_attempt_at"] as Date | null,
    lastError: r["last_error"] as string | null,
    sentAt: r["sent_at"] as Date | null,
    createdAt: r["created_at"] as Date,
    updatedAt: r["updated_at"] as Date,
  };
}

export async function markDeliverySent(db: Db, id: string): Promise<void> {
  await db
    .update(notificationDeliveries)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(eq(notificationDeliveries.id, id));
}

/** No mail by design (unverified/unsubscribed/empty re-filter). Not a failure. */
export async function markDeliverySkipped(db: Db, id: string): Promise<void> {
  await db
    .update(notificationDeliveries)
    .set({ status: "skipped", updatedAt: new Date() })
    .where(eq(notificationDeliveries.id, id));
}

export async function markDeliveryFailed(
  db: Db,
  id: string,
  lastError: string,
): Promise<void> {
  await db
    .update(notificationDeliveries)
    .set({ status: "failed", lastError, updatedAt: new Date() })
    .where(eq(notificationDeliveries.id, id));
}

export async function retryDeliveryLater(
  db: Db,
  id: string,
  attempts: number,
  lastError: string,
): Promise<void> {
  const delayMs = attempts * attempts * 60_000;
  await db
    .update(notificationDeliveries)
    .set({
      status: "pending",
      nextAttemptAt: new Date(Date.now() + delayMs),
      lastError,
      updatedAt: new Date(),
    })
    .where(eq(notificationDeliveries.id, id));
}
