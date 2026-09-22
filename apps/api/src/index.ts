import { initLocalEnv, isAuthEmailEnabled, loadConfig } from "@anveshan/config";
import { closePool, createDb, getPool } from "@anveshan/database";
import type { SendMailFn } from "@anveshan/notifications";
import { createMailer } from "@anveshan/notifications";
import { createAdminService } from "./admin/routes.js";
import { createApp } from "./app.js";
import { startScheduler } from "./collection/scheduler.js";
import { createLogger } from "./logger.js";
import { startDeliveryInterval, startDigestCron } from "./notifications/worker.js";
import { createDrizzleProgramStore } from "./services/store.js";

async function main(): Promise<void> {
  initLocalEnv(import.meta.url);
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = getPool(config.DATABASE_URL);
  const db = createDb(pool);

  // Auth emails gate themselves on isAuthEmailEnabled(); without a
  // configured provider this transport is never called.
  const mailReady =
    isAuthEmailEnabled(config) &&
    (config.MAIL_PROVIDER === "brevo"
      ? Boolean(config.BREVO_API_KEY)
      : Boolean(config.SMTP_HOST));
  let sendMail: SendMailFn = async () => {
    logger.info("mail transport not configured; email skipped");
  };
  if (mailReady && config.SMTP_FROM) {
    sendMail = createMailer({
      provider: config.MAIL_PROVIDER,
      from: config.SMTP_FROM,
      timeoutMs: config.MAIL_SEND_TIMEOUT_MS,
      smtp: config.SMTP_HOST
        ? {
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            user: config.SMTP_USER,
            pass: config.SMTP_PASS,
          }
        : undefined,
      brevo: config.BREVO_API_KEY
        ? { apiKey: config.BREVO_API_KEY, apiUrl: config.BREVO_API_URL }
        : undefined,
    });
  }

  startScheduler({ config, pool, logger });

  // Milestone 2: delivery worker (outbox drain) + daily digest cron.
  // Both no-op when NOTIFICATIONS_ENABLED=false.
  startDeliveryInterval({ db, config, logger, sendMail });
  startDigestCron({ db, config, logger });

  const app = createApp({
    store: createDrizzleProgramStore(db),
    logger,
    db,
    config,
    sendMail,
    adminService: createAdminService({ config, pool, logger, db }),
  });
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, "anveshan api listening");
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      void (async () => {
        await closePool();
        process.exit(0);
      })();
    });
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`fatal: ${message}\n`);
  process.exitCode = 1;
});
