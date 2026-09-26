import type { AppConfig } from "@anveshan/config";
import cron from "node-cron";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { ProgramCollector } from "@anveshan/collector";
import { createDb } from "@anveshan/database";
import { enqueueAfterCollection } from "../notifications/enqueue.js";
import { createActiveRuns, type StopHandle } from "../stoppable.js";
import { runCollection } from "./service.js";

export interface SchedulerDeps {
  config: AppConfig;
  pool: Pool;
  logger: Logger;
  collector?: ProgramCollector;
}

/**
 * Cron scheduler. Calls the same runCollection() as `pnpm collect`.
 * Overlap is prevented by the session advisory lock (runs skip with a warn).
 * Returns a stop handle that stops the cron and awaits the in-flight run
 * (bounded), or null when disabled (tests set COLLECTION_ENABLED=false).
 */
export function startScheduler(deps: SchedulerDeps): StopHandle | null {
  const { config, pool, logger } = deps;
  if (!config.COLLECTION_ENABLED) {
    logger.info("collection scheduler disabled (COLLECTION_ENABLED=false)");
    return null;
  }
  if (!cron.validate(config.COLLECTION_CRON)) {
    throw new Error(`Invalid COLLECTION_CRON expression: ${config.COLLECTION_CRON}`);
  }
  const active = createActiveRuns();
  const task = cron.schedule(
    config.COLLECTION_CRON,
    () => {
      active.track(
        runCollection(deps)
          .then((summary) =>
            // Own catch: enqueue failure must never log "scheduled
            // collection crashed" — collection already committed.
            // Catch-up retries.
            enqueueAfterCollection({ db: createDb(pool), config, logger }, summary).catch(
              (error: unknown) => {
                logger.error({ err: error }, "post-collection enqueue failed");
              },
            ),
          )
          .catch((error: unknown) => {
            logger.error({ err: error }, "scheduled collection crashed");
          }),
      );
    },
    { timezone: config.COLLECTION_TZ },
  );
  logger.info(
    { cron: config.COLLECTION_CRON, tz: config.COLLECTION_TZ },
    "collection scheduler started",
  );
  return {
    stop: async (): Promise<void> => {
      task.stop();
      await active.waitAll();
    },
  };
}
