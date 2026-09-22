import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  initLocalEnv,
  isAuthEmailEnabled,
  loadConfig,
  requireHackerOneCredentials,
  requireMagicLinkSecrets,
  requireUnsubscribeSecret,
} from "../src/index.js";

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
      MAIL_SEND_TIMEOUT_MS: "45000",
    });
    expect(config.PORT).toBe(4000);
    expect(config.COLLECTION_ENABLED).toBe(false);
    expect(config.H1_MIN_DELAY_MS).toBe(500);
    expect(config.MAIL_SEND_TIMEOUT_MS).toBe(45000);
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

  it("applies notification defaults", () => {
    const config = loadConfig({ ...baseEnv });
    expect(config.NOTIFICATIONS_ENABLED).toBe(false);
    expect(config.AUTH_EMAIL_ENABLED).toBeUndefined();
    expect(config.MAIL_PROVIDER).toBe("smtp");
    expect(config.MAIL_SEND_TIMEOUT_MS).toBe(30_000);
    expect(config.BREVO_API_KEY).toBeUndefined();
    expect(config.DIGEST_TICK_CRON).toBe("* * * * *");
    expect(config.IMMEDIATE_EMAIL_CAP).toBe(20);
    expect(config.ASSET_EMAIL_CAP).toBe(10);
    expect(config.FRONTEND_URL).toBe("http://localhost:3001");
    expect(config.MAGIC_LINK_EXPIRY).toBe(900000);
    expect(config.SESSION_EXPIRY).toBe(2592000000);
  });

  it("treats blank SMTP and secret values as unset", () => {
    const config = loadConfig({
      ...baseEnv,
      MAIL_PROVIDER: "",
      SMTP_HOST: "",
      SMTP_USER: "",
      SMTP_PASS: "",
      BREVO_API_KEY: "",
      MAGIC_LINK_SECRET: "",
      SESSION_SECRET: "",
      UNSUBSCRIBE_SECRET: "",
      AUTH_EMAIL_ENABLED: "",
      MAIL_SEND_TIMEOUT_MS: "",
    });
    expect(config.MAIL_PROVIDER).toBe("smtp");
    expect(config.MAIL_SEND_TIMEOUT_MS).toBe(30_000);
    expect(config.SMTP_HOST).toBeUndefined();
    expect(config.BREVO_API_KEY).toBeUndefined();
    expect(config.MAGIC_LINK_SECRET).toBeUndefined();
    expect(config.AUTH_EMAIL_ENABLED).toBeUndefined();
  });

  it("derives AUTH_EMAIL_ENABLED from SMTP vars when unset", () => {
    expect(isAuthEmailEnabled(loadConfig({ ...baseEnv }))).toBe(false);
    expect(
      isAuthEmailEnabled(
        loadConfig({
          ...baseEnv,
          SMTP_HOST: "smtp.example.com",
          SMTP_USER: "u",
          SMTP_PASS: "p",
        }),
      ),
    ).toBe(true);
  });

  it("derives AUTH_EMAIL_ENABLED from BREVO_API_KEY when MAIL_PROVIDER=brevo", () => {
    expect(
      isAuthEmailEnabled(loadConfig({ ...baseEnv, MAIL_PROVIDER: "brevo" })),
    ).toBe(false);
    expect(
      isAuthEmailEnabled(
        loadConfig({
          ...baseEnv,
          MAIL_PROVIDER: "brevo",
          BREVO_API_KEY: "xkeysib-test",
        }),
      ),
    ).toBe(true);
    // SMTP vars alone do not enable auth email when provider is brevo
    expect(
      isAuthEmailEnabled(
        loadConfig({
          ...baseEnv,
          MAIL_PROVIDER: "brevo",
          SMTP_HOST: "smtp.example.com",
          SMTP_USER: "u",
          SMTP_PASS: "p",
        }),
      ),
    ).toBe(false);
  });

  it("explicit AUTH_EMAIL_ENABLED wins over derivation", () => {
    expect(
      isAuthEmailEnabled(
        loadConfig({
          ...baseEnv,
          AUTH_EMAIL_ENABLED: "false",
          SMTP_HOST: "smtp.example.com",
          SMTP_USER: "u",
          SMTP_PASS: "p",
        }),
      ),
    ).toBe(false);
    expect(
      isAuthEmailEnabled(loadConfig({ ...baseEnv, AUTH_EMAIL_ENABLED: "true" })),
    ).toBe(true);
  });

  it("requireMagicLinkSecrets fails closed when secrets are missing", () => {
    const config = loadConfig({ ...baseEnv });
    expect(() => requireMagicLinkSecrets(config)).toThrow(/MAGIC_LINK_SECRET/);
    expect(() => requireUnsubscribeSecret(config)).toThrow(/UNSUBSCRIBE_SECRET/);
  });

  it("requireMagicLinkSecrets returns secrets when present", () => {
    const config = loadConfig({
      ...baseEnv,
      MAGIC_LINK_SECRET: "a".repeat(32),
      SESSION_SECRET: "b".repeat(32),
      UNSUBSCRIBE_SECRET: "c".repeat(32),
    });
    expect(requireMagicLinkSecrets(config)).toEqual({
      magicLinkSecret: "a".repeat(32),
      sessionSecret: "b".repeat(32),
    });
    expect(requireUnsubscribeSecret(config)).toBe("c".repeat(32));
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
