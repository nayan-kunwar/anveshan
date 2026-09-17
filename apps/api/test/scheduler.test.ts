import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { startScheduler } from "../src/collection/scheduler.js";
import { createLogger } from "../src/logger.js";
import { loadConfig } from "@anveshan/config";

const logger = createLogger({ LOG_LEVEL: "silent" });
const pool = null as unknown as Pool;

function configWith(overrides: Record<string, string>): ReturnType<typeof loadConfig> {
  return loadConfig({
    DATABASE_URL: "postgres://anveshan:anveshan@localhost:5433/anveshan",
    ...overrides,
  });
}

describe("startScheduler", () => {
  it("returns null when collection is disabled", () => {
    const config = configWith({ COLLECTION_ENABLED: "false" });
    expect(startScheduler({ config, pool, logger })).toBeNull();
  });

  it("throws on invalid cron expressions", () => {
    const config = configWith({ COLLECTION_CRON: "not-a-cron" });
    expect(() => startScheduler({ config, pool, logger })).toThrow(
      /Invalid COLLECTION_CRON/,
    );
  });

  it("starts and stops a scheduled task", () => {
    const config = configWith({ COLLECTION_CRON: "*/30 * * * *" });
    const task = startScheduler({ config, pool, logger });
    expect(task).not.toBeNull();
    task?.stop();
  });
});
