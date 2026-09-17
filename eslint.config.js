import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";

export default defineConfig(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/drizzle/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  prettier,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.js", "commitlint.config.js"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "error",
      // Stylistic noise for this codebase: numbers in template literals,
      // async test stubs, and void-returning log shorthands are idiomatic here.
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
    },
  },
  {
    files: ["**/*.test.ts", "packages/*/test/**/*.ts", "apps/*/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      // Supertest bodies are `any` by design; tests assert shapes at runtime.
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
);
