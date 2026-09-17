import { initLocalEnv, loadConfig } from "@anveshan/config";
import { closePool, getPool } from "@anveshan/database";
import { runCollection } from "./collection/service.js";
import { createLogger } from "./logger.js";

/**
 * pnpm collect — manual collection. Calls the same runCollection()
 * as the node-cron scheduler, then prints a summary.
 */
async function main(): Promise<void> {
  initLocalEnv(import.meta.url);
  const config = loadConfig();
  const logger = createLogger({ LOG_LEVEL: config.LOG_LEVEL });
  const pool = getPool(config.DATABASE_URL);
  try {
    const summary = await runCollection({ config, pool, logger });
    process.stdout.write(
      [
        `status: ${summary.status}`,
        `run: ${summary.runId ?? "-"}`,
        `programs: ${summary.programsSeen} (added ${summary.programsAdded})`,
        `assets: ${summary.assetsSeen} (added ${summary.assetsAdded}, removed ${summary.assetsRemoved})`,
        ...(summary.errorCode
          ? [`error: ${summary.errorCode} ${summary.errorMessage ?? ""}`]
          : []),
      ].join("\n") + "\n",
    );
    process.exitCode = summary.status === "completed" ? 0 : 1;
  } finally {
    await closePool();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`collect failed: ${message}\n`);
  process.exitCode = 1;
});
