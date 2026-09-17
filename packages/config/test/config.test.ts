import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { initLocalEnv, loadConfig, requireHackerOneCredentials } from "../src/index.js";

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

describe("initLocalEnv", () => {
  const probeKey = "ANVESHAN_TEST_PROBE_VAR";
  let scratch = "";

  afterEach(() => {
    Reflect.deleteProperty(process.env, probeKey);
    if (scratch !== "") {
      rmSync(scratch, { recursive: true, force: true });
      scratch = "";
    }
  });

  function makeWorkspace(envBody: string): string {
    scratch = mkdtempSync(join(tmpdir(), "anveshan-env-"));
    writeFileSync(join(scratch, "pnpm-workspace.yaml"), "packages:\n");
    writeFileSync(join(scratch, ".env"), envBody);
    const nested = join(scratch, "apps", "api", "src");
    mkdirSync(nested, { recursive: true });
    return pathToFileURL(join(nested, "entry.ts")).href;
  }

  it("loads the workspace-root .env from a nested entry point", () => {
    const entryUrl = makeWorkspace(`${probeKey}=from-file\n`);
    const loaded = initLocalEnv(entryUrl);
    expect(loaded?.endsWith(".env")).toBe(true);
    expect(process.env[probeKey]).toBe("from-file");
  });

  it("never overrides shell-exported variables", () => {
    const entryUrl = makeWorkspace(`${probeKey}=from-file\n`);
    process.env[probeKey] = "from-shell";
    initLocalEnv(entryUrl);
    expect(process.env[probeKey]).toBe("from-shell");
  });

  it("returns null outside a workspace", () => {
    const outside = mkdtempSync(join(tmpdir(), "anveshan-nowhere-"));
    scratch = outside;
    const loaded = initLocalEnv(pathToFileURL(join(outside, "entry.ts")).href);
    expect(loaded).toBeNull();
    expect(process.env[probeKey]).toBeUndefined();
  });
});
