import type { AppConfig } from "@anveshan/config";
import type { ChangeWithProgram, Database } from "@anveshan/database";
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

export function digestWindow(digestOn: Date): { windowStart: Date; windowEnd: Date } {
  const midnight = Date.UTC(
    digestOn.getUTCFullYear(),
    digestOn.getUTCMonth(),
    digestOn.getUTCDate(),
  );
  const windowEnd = new Date(midnight + 8 * 3_600_000);
  return { windowStart: new Date(windowEnd.getTime() - 24 * 3_600_000), windowEnd };
}

export function digestDateString(digestOn: Date): string {
  const full = digestOn.toISOString();
  const date = full.slice(0, 10);
  if (!date) throw new Error("invalid digest date");
  return date;
}

/**
 * Enqueue one closed 24h digest day. digestOn is the UTC calendar date
 * whose 08:00 closes the window (yesterday 08:00 → today 08:00).
 */
export async function enqueueDailyDigest(
  deps: EnqueueDeps,
  digestOn: Date,
): Promise<number> {
  if (!deps.config.NOTIFICATIONS_ENABLED) return 0;
  const { windowStart, windowEnd } = digestWindow(digestOn);
  const changes = await findChangesInWindow(deps.db, windowStart, windowEnd);
  if (changes.length === 0) return 0;
  const users = await findEligibleUsers(deps.db, "daily");
  const digestOnStr = digestDateString(digestOn);
  let inserted = 0;
  for (const user of users) {
    const filter = await watchFilterFor(
      deps.db,
      user.userId,
      user.watchAllPrograms,
      user.watchNewPrograms,
    );
    if (filterChanges(changes, filter).length === 0) continue;
    if (await enqueueDailyDelivery(deps.db, user.userId, digestOnStr)) inserted += 1;
  }
  if (inserted > 0) {
    deps.logger.info(
      { digestOn: digestOnStr, deliveries: inserted },
      "enqueued daily digest",
    );
  }
  return inserted;
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

/** Closed windows only: enqueue the last two closed digest days. */
export function closedDigestDates(now: Date): Date[] {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const todayClose = midnight + 8 * 3_600_000;
  const lastClose = now.getTime() >= todayClose ? midnight : midnight - 24 * 3_600_000;
  return [new Date(lastClose), new Date(lastClose - 24 * 3_600_000)];
}

export async function catchUpDailyDigest(
  deps: EnqueueDeps,
  now = new Date(),
): Promise<number> {
  if (!deps.config.NOTIFICATIONS_ENABLED) return 0;
  let inserted = 0;
  for (const digestOn of closedDigestDates(now)) {
    inserted += await enqueueDailyDigest(deps, digestOn);
  }
  return inserted;
}
