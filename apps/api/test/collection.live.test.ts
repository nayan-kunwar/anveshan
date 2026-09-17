import { describe, expect, it } from "vitest";
import { loadConfig } from "@anveshan/config";
import { getPool } from "@anveshan/database";
import { runCollection } from "../src/collection/service.js";
import { createLogger } from "../src/logger.js";

/**
 * Live HackerOne verification. Gated by H1_LIVE_TEST=1 + real credentials.
 * Skipped (not failed) when env is missing.
 *
 * Scopes to 1 program (maxPrograms) to stay cheap. Asserts shapes +
 * idempotency only — never exact counts, because HackerOne data changes.
 */
const liveEnabled = process.env["H1_LIVE_TEST"] === "1";

describe.skipIf(!liveEnabled)("hackerone live collection", () => {
  it("collects one program then re-runs with zero asset churn", async (ctx) => {
    if (!process.env["HACKERONE_USERNAME"] || !process.env["HACKERONE_API_TOKEN"]) {
      process.stderr.write("HackerOne credentials missing — skipping live test\n");
      ctx.skip();
      return;
    }
    const config = loadConfig();
    const logger = createLogger({ LOG_LEVEL: "info" });
    const pool = getPool(config.DATABASE_URL);
    try {
      const first = await runCollection({ config, pool, logger, maxPrograms: 1 });
      expect(first.status).toBe("completed");
      expect(first.programsSeen).toBeGreaterThan(0);

      const second = await runCollection({ config, pool, logger, maxPrograms: 1 });
      expect(second.status).toBe("completed");
      expect(second.assetsAdded).toBe(0);
      expect(second.assetsRemoved).toBe(0);
    } finally {
      const { closePool } = await import("@anveshan/database");
      await closePool();
    }
  }, 300000);
});
