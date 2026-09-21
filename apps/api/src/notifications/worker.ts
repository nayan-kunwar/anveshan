import type { AppConfig } from "@anveshan/config";
import { requireUnsubscribeSecret } from "@anveshan/config";
import type { Database, DeliveryRow } from "@anveshan/database";
import {
  claimDeliveries,
  findChangesByRun,
  findChangesInWindow,
  findSubscription,
  findUserById,
  findWatchProgramIds,
  markDeliveryFailed,
  markDeliverySent,
  markDeliverySkipped,
  resetStaleSending,
  retryDeliveryLater,
} from "@anveshan/database";
import type { SendMailFn, TemplateChange } from "@anveshan/notifications";
import { renderDaily, renderImmediate } from "@anveshan/notifications";
import { signUnsubscribe } from "../auth/tokens.js";
import type { Logger } from "pino";
import cron from "node-cron";
import {
  catchUpDailyDigest,
  catchUpImmediate,
  enqueueDueDigests,
  filterChanges,
} from "./enqueue.js";

export interface WorkerDeps {
  db: Database;
  config: AppConfig;
  logger: Logger;
  sendMail: SendMailFn;
}

/** Stuck `sending` rows are presumed crashed after 10 minutes. */
export const STALE_SENDING_MS = 10 * 60_000;

export const DRAIN_LIMIT = 50;

function toTemplateChanges(
  changes: {
    type: string;
    programId: string;
    programName: string;
    assetKey: string | null;
    assetIdentifier: string | null;
  }[],
): TemplateChange[] {
  return changes.map((c) => ({
    type: c.type as TemplateChange["type"],
    programId: c.programId,
    programName: c.programName,
    assetKey: c.assetKey,
    assetIdentifier: c.assetIdentifier,
  }));
}

/**
 * Legacy window for rows enqueued before per-user digests existed
 * (digest_close_at NULL): digest_on's 08:00 UTC close. New rows always
 * pin the exact close instant, so enqueue and send agree by construction.
 */
function legacyDigestWindow(digestOn: string): {
  windowStart: Date;
  windowEnd: Date;
} {
  const [y, m, d] = digestOn.split("-").map(Number);
  const windowEnd = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + 8 * 3_600_000);
  return { windowStart: new Date(windowEnd.getTime() - 24 * 3_600_000), windowEnd };
}

function digestWindowForDelivery(delivery: DeliveryRow): {
  windowStart: Date;
  windowEnd: Date;
} {
  if (delivery.digestCloseAt) {
    const windowEnd = new Date(delivery.digestCloseAt);
    return { windowStart: new Date(windowEnd.getTime() - 24 * 3_600_000), windowEnd };
  }
  return legacyDigestWindow(delivery.digestOn ?? "1970-01-01");
}

/**
 * Send one claimed delivery. Re-checks user state and re-applies the
 * filter matrix at send time (unsubscribe / watch edits between enqueue
 * and SMTP must not send). Never throws — unexpected errors go to retry.
 */
async function sendOneDelivery(deps: WorkerDeps, delivery: DeliveryRow): Promise<string> {
  try {
    const user = await findUserById(deps.db, delivery.userId);
    if (!user || !user.emailVerifiedAt || user.unsubscribedAt) {
      await markDeliverySkipped(deps.db, delivery.id);
      return "skipped";
    }
    let changes;
    let windowStart: Date | undefined;
    let windowEnd: Date | undefined;
    if (delivery.kind === "immediate") {
      changes = await findChangesByRun(deps.db, delivery.collectionRunId ?? "");
    } else {
      ({ windowStart, windowEnd } = digestWindowForDelivery(delivery));
      changes = await findChangesInWindow(deps.db, windowStart, windowEnd);
    }
    const sub = await findSubscription(deps.db, user.id);
    if (!sub) {
      await markDeliverySkipped(deps.db, delivery.id);
      return "skipped";
    }
    const watchIds = sub.watchAllPrograms
      ? new Set<string>()
      : new Set(await findWatchProgramIds(deps.db, user.id));
    const matching = filterChanges(changes, {
      watchAllPrograms: sub.watchAllPrograms,
      watchProgramIds: watchIds,
      watchNewPrograms: sub.watchNewPrograms,
    });
    if (matching.length === 0) {
      await markDeliverySkipped(deps.db, delivery.id);
      return "skipped";
    }
    const secret = requireUnsubscribeSecret(deps.config);
    const unsubscribeUrl =
      `${deps.config.FRONTEND_URL}/unsubscribe?user=${user.id}` +
      `&token=${signUnsubscribe(user.id, secret)}`;
    const template = toTemplateChanges(matching);
    const base = {
      frontendUrl: deps.config.FRONTEND_URL,
      unsubscribeUrl,
      programCap: deps.config.IMMEDIATE_EMAIL_CAP,
      assetCap: deps.config.ASSET_EMAIL_CAP,
    };
    const mail =
      delivery.kind === "immediate" || !windowStart || !windowEnd
        ? renderImmediate(template, base)
        : renderDaily(template, { ...base, windowStart, windowEnd });
    await deps.sendMail({ to: user.email, subject: mail.subject, text: mail.text });
    await markDeliverySent(deps.db, delivery.id);
    return "sent";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.error({ err: error, deliveryId: delivery.id }, "delivery failed");
    if (delivery.attempts >= 3) {
      await markDeliveryFailed(deps.db, delivery.id, message);
      return "failed";
    }
    await retryDeliveryLater(deps.db, delivery.id, delivery.attempts, message);
    return "retry";
  }
}

export interface DrainResult {
  claimed: number;
  sent: number;
  skipped: number;
}

/**
 * One drain tick: catch-up → stale recovery → claim → send.
 * Total-safe: never throws (callers still guard with .catch).
 */
export function createDeliveryWorker(deps: WorkerDeps): {
  drain: () => Promise<DrainResult>;
} {
  let draining = false;
  return {
    drain: async (): Promise<DrainResult> => {
      const result: DrainResult = { claimed: 0, sent: 0, skipped: 0 };
      if (!deps.config.NOTIFICATIONS_ENABLED) return result;
      // One drain at a time: overlapping ticks + stale recovery would double-send.
      if (draining) {
        deps.logger.debug("delivery drain already running, skipping tick");
        return result;
      }
      draining = true;
      try {
        await catchUpImmediate({ db: deps.db, config: deps.config, logger: deps.logger });
        await catchUpDailyDigest({
          db: deps.db,
          config: deps.config,
          logger: deps.logger,
        });
        await resetStaleSending(deps.db, STALE_SENDING_MS);
        const claimed = await claimDeliveries(deps.db, DRAIN_LIMIT);
        result.claimed = claimed.length;
        for (const delivery of claimed) {
          const outcome = await sendOneDelivery(deps, delivery);
          if (outcome === "sent") result.sent += 1;
          if (outcome === "skipped") result.skipped += 1;
        }
        if (result.claimed > 0) {
          deps.logger.info(result, "delivery drain completed");
        }
        return result;
      } catch (error) {
        deps.logger.error({ err: error }, "delivery drain crashed");
        return result;
      } finally {
        draining = false;
      }
    },
  };
}

export interface DigestCronDeps {
  db: Database;
  config: AppConfig;
  logger: Logger;
}

/**
 * Per-minute digest tick. Enqueues digests for daily users whose personal
 * close just passed. No-op when disabled. Returns the task, or null when
 * disabled (same convention as the collection scheduler).
 */
export function startDigestCron(deps: DigestCronDeps): cron.ScheduledTask | null {
  const { config, logger } = deps;
  if (!config.NOTIFICATIONS_ENABLED) {
    logger.info("digest cron disabled (NOTIFICATIONS_ENABLED=false)");
    return null;
  }
  if (!cron.validate(config.DIGEST_TICK_CRON)) {
    throw new Error(`Invalid DIGEST_TICK_CRON expression: ${config.DIGEST_TICK_CRON}`);
  }
  const task = cron.schedule(
    config.DIGEST_TICK_CRON,
    () => {
      void (async () => {
        try {
          await enqueueDueDigests({
            db: deps.db,
            config: deps.config,
            logger: deps.logger,
          });
        } catch (error) {
          logger.error({ err: error }, "digest enqueue crashed");
        }
      })();
    },
    { timezone: "UTC" },
  );
  logger.info({ cron: config.DIGEST_TICK_CRON }, "digest cron started");
  return task;
}

export interface DeliveryIntervalDeps extends WorkerDeps {
  intervalMs?: number | undefined;
}

/** setInterval drain loop. Returns a stop handle. No-op when disabled. */
export function startDeliveryInterval(
  deps: DeliveryIntervalDeps,
): { stop: () => void } | null {
  if (!deps.config.NOTIFICATIONS_ENABLED) {
    deps.logger.info("delivery worker disabled (NOTIFICATIONS_ENABLED=false)");
    return null;
  }
  const worker = createDeliveryWorker(deps);
  // Boot catch-up on start (first drain runs catch-up before claiming).
  worker.drain().catch((error: unknown) => {
    deps.logger.error({ err: error }, "initial delivery drain crashed");
  });
  const timer = setInterval(() => {
    worker.drain().catch((error: unknown) => {
      deps.logger.error({ err: error }, "delivery drain crashed");
    });
  }, deps.intervalMs ?? 30_000);
  timer.unref();
  return {
    stop: () => clearInterval(timer),
  };
}
