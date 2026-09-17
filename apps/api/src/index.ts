import { initLocalEnv, loadConfig } from "@anveshan/config";
import { closePool, createDb, getPool } from "@anveshan/database";
import type { SendMailFn } from "@anveshan/notifications";
import { createMailTransport, createSendMail } from "@anveshan/notifications";
import { createApp } from "./app.js";
import { startScheduler } from "./collection/scheduler.js";
import { createLogger } from "./logger.js";
import { createDrizzleProgramStore } from "./services/store.js";

async function main(): Promise<void> {
  initLocalEnv(import.meta.url);
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = getPool(config.DATABASE_URL);
  const db = createDb(pool);

  // Auth emails gate themselves on isAuthEmailEnabled(); without SMTP
  // settings this transport is never called.
  const sendMail: SendMailFn =
    config.SMTP_HOST && config.SMTP_FROM
      ? createSendMail(
          createMailTransport({
            host: config.SMTP_HOST,
            port: config.SMTP_PORT,
            user: config.SMTP_USER,
            pass: config.SMTP_PASS,
            from: config.SMTP_FROM,
          }),
          config.SMTP_FROM,
        )
      : async () => {
          logger.info("SMTP not configured; email skipped");
        };

  startScheduler({ config, pool, logger });

  const app = createApp({
    store: createDrizzleProgramStore(db),
    logger,
    db,
    config,
    sendMail,
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
