import "dotenv/config";
import { loadConfig } from "@anveshan/config";
import { closePool, createDb, getPool } from "@anveshan/database";
import { createApp } from "./app.js";
import { startScheduler } from "./collection/scheduler.js";
import { createLogger } from "./logger.js";
import { createDrizzleProgramStore } from "./services/store.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const pool = getPool(config.DATABASE_URL);
  const db = createDb(pool);

  startScheduler({ config, pool, logger });

  const app = createApp({ store: createDrizzleProgramStore(db), logger });
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
