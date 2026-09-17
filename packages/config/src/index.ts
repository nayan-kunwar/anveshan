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
