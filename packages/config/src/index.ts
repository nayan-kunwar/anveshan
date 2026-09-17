import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import { z } from "zod";

const booleanFromString = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === "boolean" ? v : v.toLowerCase() === "true"))
  .pipe(z.boolean());

const logLevelSchema = z.enum([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  // HackerOne credentials are optional at boot so read-only commands
  // (`pnpm dev`, `pnpm test`) work without them. Collection asserts
  // them via requireHackerOneCredentials() before any HTTP call.
  HACKERONE_USERNAME: z.string().min(1).optional(),
  HACKERONE_API_TOKEN: z.string().min(1).optional(),
  H1_BASE_URL: z.string().url().default("https://api.hackerone.com/v1/hackers"),
  H1_MIN_DELAY_MS: z.coerce.number().int().min(0).default(1500),
  H1_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
  H1_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),
  COLLECTION_CRON: z.string().min(1).default("*/30 * * * *"),
  COLLECTION_TZ: z.string().min(1).default("UTC"),
  COLLECTION_ENABLED: booleanFromString.default(true),
  COLLECTION_STALE_RUNNING_MS: z.coerce.number().int().positive().default(7200000),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: logLevelSchema.default("info"),
  H1_LIVE_TEST: z.string().optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

/**
 * Load the repo-root `.env` regardless of the invoking working directory.
 *
 * `dotenv/config` resolves `./.env` against CWD, which breaks under
 * `pnpm --filter` (CWD becomes the package dir). This walks up from the
 * caller's file to the workspace root (marked by `pnpm-workspace.yaml`)
 * and loads `<root>/.env`. Single source of truth: no per-package `.env`.
 *
 * Shell-exported variables always win (dotenv never overrides them).
 * Missing file is silent, matching dotenv defaults.
 *
 * Pass `import.meta.url` of the entry point. Call before `loadConfig()`.
 */
export function initLocalEnv(entryUrl: string | URL): string | null {
  let dir: string;
  try {
    dir = dirname(fileURLToPath(entryUrl));
  } catch {
    // No usable file URL (e.g. tsx -e / REPL): fall back to CWD behavior.
    dotenvConfig();
    return null;
  }
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      const envPath = join(dir, ".env");
      if (existsSync(envPath)) {
        dotenvConfig({ path: envPath });
        return envPath;
      }
      return null;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // Treat blank template values as unset so read-only commands boot
  // without credentials; collection still fails closed via
  // requireHackerOneCredentials().
  const cleaned: Record<string, string | undefined> = { ...env };
  for (const key of ["HACKERONE_USERNAME", "HACKERONE_API_TOKEN"] as const) {
    if (cleaned[key] === "") cleaned[key] = undefined;
  }
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return parsed.data;
}

export interface HackerOneCredentials {
  username: string;
  apiToken: string;
}

/** Fail-closed: collection and live tests must call this before any HTTP. */
export function requireHackerOneCredentials(config: AppConfig): HackerOneCredentials {
  if (!config.HACKERONE_USERNAME || !config.HACKERONE_API_TOKEN) {
    throw new Error(
      "Missing HackerOne credentials: set HACKERONE_USERNAME and HACKERONE_API_TOKEN",
    );
  }
  return {
    username: config.HACKERONE_USERNAME,
    apiToken: config.HACKERONE_API_TOKEN,
  };
}
