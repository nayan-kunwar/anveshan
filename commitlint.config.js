/** @type {import('@commitlint/types').UserConfig} */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", ["feat", "fix", "docs", "chore", "refactor", "test"]],
    // Scopes are free-form (warn-only): the list below is a suggestion,
    // not a gate. Unknown scopes (spec, deps, infra, …) pass with a nudge.
    "scope-enum": [
      1,
      "always",
      ["collector", "domain", "database", "api", "config", "docs", "repo", "ci"],
    ],
    "scope-empty": [1, "never"],
    "subject-case": [
      2,
      "never",
      ["sentence-case", "start-case", "pascal-case", "upper-case"],
    ],
    "subject-full-stop": [2, "never", "."],
    "header-max-length": [2, "always", 100],
  },
};
