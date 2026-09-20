import { initLocalEnv } from "@anveshan/config";
import { defineConfig } from "drizzle-kit";

initLocalEnv(import.meta.url);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? "postgres://anveshan:anveshan@localhost:5433/anveshan",
  },
});
