import type { AppConfig } from "@anveshan/config";
import type { ChangeWithProgram, Database } from "@anveshan/database";
import { lastClose, utcDateString } from "@anveshan/notifications";
import {
  enqueueDailyDelivery,
  enqueueImmediateDelivery,
  findChangesByRun,
  findChangesInWindow,
  findEligibleUsers,
  findRunsWithChangesSince,
  findWatchProgramIds,
} from "@anveshan/database";
import type { Logger } from "pino";
import type { CollectionSummary } from "../collection/service.js";

export interface EnqueueDeps {
  db: Database;
  config: AppConfig;
  logger: Logger;
}

export interface WatchFilter {
  watchAllPrograms: boolean;
  watchProgramIds: Set<string>;
  watchNewPrograms: boolean;
}

/**
 * Filter matrix (docs/notification-design.md). Source of truth:
 * - PROGRAM_ADDED needs watchNewPrograms, independent of watches.
 * - ASSET_* needs watchAllPrograms or a watch row on that program.
 */
export function filterChanges(
  changes: ChangeWithProgram[],
  filter: WatchFilter,
): ChangeWithProgram[] {
  return changes.filter((change) => {
    if (change.type === "PROGRAM_ADDED") return filter.watchNewPrograms;
    if (filter.watchAllPrograms) return true;
    return filter.watchProgramIds.has(change.programId);
  });
}

async function watchFilterFor(
  db: Database,
  userId: string,
  watchAllPrograms: boolean,
  watchNewPrograms: boolean,
): Promise<WatchFilter> {
  const watchProgramIds = watchAllPrograms
    ? new Set<string>()
    : new Set(await findWatchProgramIds(db, userId));
  return { watchAllPrograms, watchProgramIds, watchNewPrograms };
}

/**
 * Post-collection hook. Loads the run's changes once, fans out per user
 * in memory. Idempotent (partial-unique + DO NOTHING). Never throws —
 * callers treat enqueue failure as retryable via catch-up.
 */
export async function enqueueImmediate(
  deps: EnqueueDeps,
  runId: string,
): Promise<number> {
  if (!deps.config.NOTIFICATIONS_ENABLED) return 0;
  const changes = await findChangesByRun(deps.db, runId);
  if (changes.length === 0) return 0;
  const users = await findEligibleUsers(deps.db, "immediate");
  let inserted = 0;
  for (const user of users) {
    const filter = await watchFilterFor(
      deps.db,
      user.userId,
      user.watchAllPrograms,
      user.watchNewPrograms,
    );
    if (filterChanges(changes, filter).length === 0) continue;
    if (await enqueueImmediateDelivery(deps.db, user.userId, runId)) inserted += 1;
  }
  if (inserted > 0) {
    deps.logger.info({ runId, deliveries: inserted }, "enqueued immediate notifications");
  }
  return inserted;
}

export interface DigestRecipient {
  userId: string;
  close: Date;
  filter: WatchFilter;
}

/**
 * Shared digest core: group recipients by close instant, load each
 * window's changes once ([close-24h, close)), filter per user, insert
 * idempotently. Uniqueness is on (user, close instant).
 */
async function enqueueCloseGroups(
  deps: EnqueueDeps,
  recipients: DigestRecipient[],
): Promise<number> {
  if (!deps.config.NOTIFICATIONS_ENABLED) return 0;
  const byClose = new Map<number, { close: Date; recipients: DigestRecipient[] }>();
  for (const recipient of recipients) {
    const key = recipient.close.getTime();
    const group = byClose.get(key);
    if (group) group.recipients.push(recipient);
    else byClose.set(key, { close: recipient.close, recipients: [recipient] });
  }
  let inserted = 0;
  for (const { close, recipients: group } of byClose.values()) {
    const windowStart = new Date(close.getTime() - 24 * 3_600_000);
    const changes = await findChangesInWindow(deps.db, windowStart, close);
    if (changes.length === 0) continue;
    const digestOn = utcDateString(close);
    for (const recipient of group) {
      if (filterChanges(changes, recipient.filter).length === 0) continue;
      if (await enqueueDailyDelivery(deps.db, recipient.userId, digestOn, close)) {
        inserted += 1;
      }
    }
  }
  if (inserted > 0) {
    deps.logger.info({ deliveries: inserted }, "enqueued daily digests");
  }
  return inserted;
}

interface DailyUser {
  userId: string;
  filter: WatchFilter;
  digestTimezone: string;
  digestTimeLocal: string;
}

async function dailyUsers(db: Database): Promise<DailyUser[]> {
  const users = await findEligibleUsers(db, "daily");
  const result: DailyUser[] = [];
  for (const user of users) {
    const filter = await watchFilterFor(
      db,
      user.userId,
      user.watchAllPrograms,
      user.watchNewPrograms,
    );
    result.push({
      userId: user.userId,
      filter,
      digestTimezone: user.digestTimezone,
      digestTimeLocal: user.digestTimeLocal,
    });
  }
  return result;
}

/** A user's latest close, or null when their prefs are unusable (logged). */
function closeFor(
  deps: EnqueueDeps,
  userId: string,
  timeZone: string,
  timeLocal: string,
  now: Date,
): Date | null {
  const close = lastClose(now, timeZone, timeLocal);
  if (!close) {
    deps.logger.warn(
      { userId, timeZone, timeLocal },
      "skipping digest: invalid timezone or time",
    );
  }
  return close;
}

/**
 * Per-minute tick: enqueue for daily users whose personal close just
 * passed (within the tick interval). Missed closes are covered by
 * catch-up's last-two-closes.
 */
export async function enqueueDueDigests(
  deps: EnqueueDeps,
  now = new Date(),
  dueWithinMs = 65_000,
): Promise<number> {
  if (!deps.config.NOTIFICATIONS_ENABLED) return 0;
  const due: DigestRecipient[] = [];
  for (const user of await dailyUsers(deps.db)) {
    const close = closeFor(
      deps,
      user.userId,
      user.digestTimezone,
      user.digestTimeLocal,
      now,
    );
    if (!close) continue;
    const ageMs = now.getTime() - close.getTime();
    if (ageMs >= 0 && ageMs <= dueWithinMs) {
      due.push({ userId: user.userId, close, filter: user.filter });
    }
  }
  return enqueueCloseGroups(deps, due);
}

/**
 * Scheduler + CLI call this after runCollection(). Own try/catch: enqueue
 * failure must never change the collection summary or exit code —
 * the worker's catch-up retries on the next tick.
 */
export async function enqueueAfterCollection(
  deps: EnqueueDeps,
  summary: CollectionSummary,
): Promise<void> {
  try {
    if (!deps.config.NOTIFICATIONS_ENABLED) return;
    if (summary.status !== "completed" || !summary.runId) return;
    if (summary.programsAdded + summary.assetsAdded + summary.assetsRemoved === 0) return;
    await enqueueImmediate(deps, summary.runId);
  } catch (error) {
    deps.logger.error(
      { err: error, runId: summary.runId },
      "post-collection enqueue failed",
    );
  }
}

/**
 * Catch-up: closes the gap when the process dies between collection commit
 * and enqueue, or the API is down. Eligibility is evaluated NOW, not at
 * collection time. Re-calling enqueue fns is idempotent.
 */
export async function catchUpImmediate(deps: EnqueueDeps): Promise<number> {
  if (!deps.config.NOTIFICATIONS_ENABLED) return 0;
  const runs = await findRunsWithChangesSince(
    deps.db,
    new Date(Date.now() - 24 * 3_600_000),
  );
  let inserted = 0;
  for (const run of runs) {
    inserted += await enqueueImmediate(deps, run.id);
  }
  return inserted;
}

/** Closed windows only: enqueue each daily user's last two closes. */
export async function catchUpDailyDigest(
  deps: EnqueueDeps,
  now = new Date(),
): Promise<number> {
  if (!deps.config.NOTIFICATIONS_ENABLED) return 0;
  const recipients: DigestRecipient[] = [];
  for (const user of await dailyUsers(deps.db)) {
    const latest = closeFor(
      deps,
      user.userId,
      user.digestTimezone,
      user.digestTimeLocal,
      now,
    );
    if (!latest) continue;
    const closes = [latest];
    const prev = lastClose(
      new Date(latest.getTime() - 1000),
      user.digestTimezone,
      user.digestTimeLocal,
    );
    if (prev) closes.push(prev);
    for (const close of closes) {
      recipients.push({ userId: user.userId, close, filter: user.filter });
    }
  }
  return enqueueCloseGroups(deps, recipients);
}
