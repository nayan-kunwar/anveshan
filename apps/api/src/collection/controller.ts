import type { AppConfig } from "@anveshan/config";
import type { CollectionRunRow, Database } from "@anveshan/database";
import {
  deleteSchedulerSetting,
  findSchedulerSetting,
  listRecentRuns,
  upsertSchedulerSetting,
} from "@anveshan/database";
import { isValidTimezone } from "@anveshan/notifications";
import type { Logger } from "pino";
import type { Pool } from "pg";
import cron from "node-cron";
import { AppError } from "../errors.js";
import type { StopHandle } from "../stoppable.js";
import { startScheduler } from "./scheduler.js";

const JOB_KEY = "collection";

export type SchedulerSource = "database" | "environment";

export interface SchedulerStatusDto {
  enabled: boolean;
  source: SchedulerSource;
  cron: string;
  timezone: string;
  /** Newest collection run is in flight (any trigger source, any instance). */
  running: boolean;
  lastRun: {
    id: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  } | null;
}

export interface SchedulerApplyInput {
  enabled?: boolean | undefined;
  cron?: string | undefined;
  timezone?: string | undefined;
}

interface ResolvedConfig {
  enabled: boolean;
  cron: string;
  timezone: string;
  source: SchedulerSource;
}

export interface SchedulerController {
  boot(): Promise<SchedulerStatusDto>;
  status(): Promise<SchedulerStatusDto>;
  apply(input: SchedulerApplyInput): Promise<SchedulerStatusDto>;
  reset(): Promise<SchedulerStatusDto>;
  stop(): Promise<void>;
}

export interface SchedulerControllerDeps {
  config: AppConfig;
  pool: Pool;
  db: Database;
  logger: Logger;
  /** Test seam: defaults to startScheduler with an overridden config. */
  startTask?: ((cfg: AppConfig) => StopHandle | null) | undefined;
  /** Reconcile period in ms; 0 disables the timer (tests). */
  reconcileMs?: number | undefined;
}

const DEFAULT_RECONCILE_MS = 60_000;

/** Strict: node-cron accepts 6-field (seconds) expressions; we do not. */
function assertValidCron(expression: string): void {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw AppError.badRequest("Cron must be a 5-field (minute-first) expression");
  }
  if (!cron.validate(expression.trim())) {
    throw AppError.badRequest("Invalid cron expression");
  }
}

function assertValidTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw AppError.badRequest("Unknown timezone");
  }
}

function sameConfig(a: ResolvedConfig, b: ResolvedConfig): boolean {
  return (
    a.enabled === b.enabled &&
    a.cron === b.cron &&
    a.timezone === b.timezone &&
    a.source === b.source
  );
}

function toLastRun(row: CollectionRunRow | undefined): SchedulerStatusDto["lastRun"] {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

/**
 * Owns the one live collection-scheduler task so admin endpoints can
 * stop/reschedule it without a restart. Precedence: a row in
 * scheduler_settings overrides the COLLECTION_* env values; no row =
 * environment-driven (the default). COLLECTION_ENABLED=false is a
 * master kill switch: boot stays off and apply/reset are rejected.
 * A 60s reconcile tick picks up external row edits (second instance,
 * hand SQL) so changes converge without restarts.
 */
export function createSchedulerController(
  deps: SchedulerControllerDeps,
): SchedulerController {
  const { config, pool, db, logger } = deps;
  const startTask =
    deps.startTask ??
    ((cfg: AppConfig): StopHandle | null =>
      startScheduler({ config: cfg, pool, logger }));
  const reconcileMs = deps.reconcileMs ?? DEFAULT_RECONCILE_MS;

  let task: StopHandle | null = null;
  let reconcileTimer: ReturnType<typeof setInterval> | null = null;
  let applied: ResolvedConfig = {
    enabled: config.COLLECTION_ENABLED,
    cron: config.COLLECTION_CRON,
    timezone: config.COLLECTION_TZ,
    source: "environment",
  };
  // Serializes apply/reset/reconcile so two concurrent paths can never
  // leak an armed task (each restart stops the previous one first).
  let ops: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = ops.then(fn, fn);
    ops = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  const applyInternal = async (
    target: ResolvedConfig,
    reason?: string,
  ): Promise<void> => {
    if (task) {
      await task.stop();
      task = null;
    }
    applied = target;
    if (target.enabled) {
      const taskCfg: AppConfig = {
        ...config,
        COLLECTION_CRON: target.cron,
        COLLECTION_TZ: target.timezone,
      };
      task = startTask(taskCfg);
    } else {
      logger.info("collection scheduler stopped (disabled)");
    }
    if (reason) {
      logger.info(
        { reason, enabled: target.enabled, cron: target.cron, timezone: target.timezone },
        "collection scheduler reconfigured",
      );
    }
  };

  const resolveFromEnv = (): ResolvedConfig => ({
    enabled: config.COLLECTION_ENABLED,
    cron: config.COLLECTION_CRON,
    timezone: config.COLLECTION_TZ,
    source: "environment",
  });

  const status = async (): Promise<SchedulerStatusDto> => {
    const runs = await listRecentRuns(db, 1);
    const last = runs[0];
    return {
      enabled: applied.enabled,
      source: applied.source,
      cron: applied.cron,
      timezone: applied.timezone,
      running: last?.status === "running",
      lastRun: toLastRun(last),
    };
  };

  const startReconcile = (): void => {
    if (reconcileMs <= 0) return;
    reconcileTimer = setInterval(() => {
      void enqueue(async () => {
        try {
          const row = await findSchedulerSetting(db, JOB_KEY);
          const desired: ResolvedConfig = row
            ? {
                enabled: row.enabled,
                cron: row.cron,
                timezone: row.timezone,
                source: "database",
              }
            : resolveFromEnv();
          if (!sameConfig(desired, applied)) {
            await applyInternal(desired, "reconcile");
          }
        } catch (error) {
          logger.error({ err: error }, "scheduler reconcile failed");
        }
      });
    }, reconcileMs);
    reconcileTimer.unref();
  };

  return {
    boot: async (): Promise<SchedulerStatusDto> => {
      if (!config.COLLECTION_ENABLED) {
        // Master kill switch: do not arm the task or the reconcile tick.
        logger.info("collection scheduler disabled (COLLECTION_ENABLED=false)");
        return status();
      }
      const row = await findSchedulerSetting(db, JOB_KEY);
      const target: ResolvedConfig = row
        ? {
            enabled: row.enabled,
            cron: row.cron,
            timezone: row.timezone,
            source: "database",
          }
        : {
            enabled: true,
            cron: config.COLLECTION_CRON,
            timezone: config.COLLECTION_TZ,
            source: "environment",
          };
      await enqueue(() => applyInternal(target));
      startReconcile();
      return status();
    },

    status: () => enqueue(status),

    apply: (input: SchedulerApplyInput): Promise<SchedulerStatusDto> =>
      enqueue(async () => {
        if (!config.COLLECTION_ENABLED) {
          throw new AppError(
            "SCHEDULER_DISABLED",
            "Scheduler is disabled by COLLECTION_ENABLED=false",
            409,
          );
        }
        if (input.cron !== undefined) assertValidCron(input.cron);
        if (input.timezone !== undefined) assertValidTimezone(input.timezone);
        const row = await findSchedulerSetting(db, JOB_KEY);
        const target: ResolvedConfig = {
          enabled: input.enabled ?? row?.enabled ?? true,
          cron: input.cron ?? row?.cron ?? config.COLLECTION_CRON,
          timezone: input.timezone ?? row?.timezone ?? config.COLLECTION_TZ,
          source: "database",
        };
        await upsertSchedulerSetting(db, JOB_KEY, {
          enabled: target.enabled,
          cron: target.cron,
          timezone: target.timezone,
        });
        await applyInternal(target, "admin apply");
        return status();
      }),

    reset: (): Promise<SchedulerStatusDto> =>
      enqueue(async () => {
        if (!config.COLLECTION_ENABLED) {
          throw new AppError(
            "SCHEDULER_DISABLED",
            "Scheduler is disabled by COLLECTION_ENABLED=false",
            409,
          );
        }
        await deleteSchedulerSetting(db, JOB_KEY);
        await applyInternal(resolveFromEnv(), "admin reset");
        return status();
      }),

    stop: (): Promise<void> =>
      enqueue(async () => {
        if (reconcileTimer) {
          clearInterval(reconcileTimer);
          reconcileTimer = null;
        }
        if (task) {
          await task.stop();
          task = null;
        }
      }),
  };
}
