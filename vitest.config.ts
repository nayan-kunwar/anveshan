import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./vitest.alias.js";

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: [
      "packages/*/test/**/*.test.ts",
      "packages/*/src/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
    ],
    exclude: ["**/*.live.test.ts", "**/node_modules/**", "**/dist/**"],
    testTimeout: 15000,
    // DB-backed files share one Postgres: never run files in parallel,
    // or truncateAll() in one file wipes another file's fixtures mid-run.
    poolOptions: {
      threads: { singleThread: true },
    },
    env: {
      COLLECTION_ENABLED: "false",
    },
  },
});
