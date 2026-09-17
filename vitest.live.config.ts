import { defineConfig } from "vitest/config";
import { workspaceAliases } from "./vitest.alias.js";

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    include: ["packages/*/test/**/*.live.test.ts", "apps/*/test/**/*.live.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    testTimeout: 300000,
    env: {
      COLLECTION_ENABLED: "false",
    },
  },
});
