import { describe, expect, it } from "vitest";
import { loadConfig, requireHackerOneCredentials } from "../src/index.js";

const baseEnv = {
  DATABASE_URL: "postgres://anveshan:anveshan@localhost:5432/anveshan",
};

describe("loadConfig", () => {
  it("applies defaults for optional settings", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.PORT).toBe(3000);
    expect(config.COLLECTION_CRON).toBe("*/30 * * * *");
    expect(config.COLLECTION_TZ).toBe("UTC");
    expect(config.COLLECTION_ENABLED).toBe(true);
    expect(config.H1_MIN_DELAY_MS).toBe(1500);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.HACKERONE_USERNAME).toBeUndefined();
  });

  it("treats blank credentials as unset", () => {
    const config = loadConfig({
      ...baseEnv,
      HACKERONE_USERNAME: "",
      HACKERONE_API_TOKEN: "",
    });
    expect(config.HACKERONE_USERNAME).toBeUndefined();
    expect(() => requireHackerOneCredentials(config)).toThrow(/Missing HackerOne/);
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("coerces numeric and boolean strings", () => {
    const config = loadConfig({
      ...baseEnv,
      PORT: "4000",
      COLLECTION_ENABLED: "false",
      H1_MIN_DELAY_MS: "500",
    });
    expect(config.PORT).toBe(4000);
    expect(config.COLLECTION_ENABLED).toBe(false);
    expect(config.H1_MIN_DELAY_MS).toBe(500);
  });

  it("returns credentials when present", () => {
    const config = loadConfig({
      ...baseEnv,
      HACKERONE_USERNAME: "user",
      HACKERONE_API_TOKEN: "token",
    });
    expect(requireHackerOneCredentials(config)).toEqual({
      username: "user",
      apiToken: "token",
    });
  });
});
