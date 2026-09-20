# GitHub / Commit Workflow (MVP)

Solo project, direct to `main`. No PRs required in MVP.
Format is enforced by **commitlint + Husky** (see below).

## 1. Message format (required)

Conventional Commits:

    <type>(<scope>): <imperative subject>

    [optional body: why, not what]
    [optional footer: Refs: #n]

Rules (enforced by `commitlint.config.js`):

- `type`: `feat` | `fix` | `docs` | `chore` | `refactor` | `test` | `build` | `ci` (hard error)
- `scope`: free-form, lowercase (warning only, never blocks).
  Suggested: `collector` | `domain` | `database` | `api` | `config` |
  `docs` | `repo` | `ci` | `spec` | `deps` | `infra`.
  Use empty scope only for repo-wide changes (`chore: …` allowed).
- Subject: imperative, lowercase start, no trailing period, ≤72 chars.
- Header max 100 chars. Body wrapped ~72 chars.

Examples:

    docs(spec): lock HackerOne MVP contract
    chore(repo): add commitlint and husky
    feat(database): add migration 001 programs and assets
    feat(collector): paginate HackerOne structured scopes
    fix(domain): treat OUT→IN as ASSET_ADDED
    test(collector): add H1 429 fixture and backoff test
    build(api): exclude mail-test from prod dist
    ci(repo): lint commit headers on push

Bad (rejected by hook):

    fixed stuff
    feat: Added Stuff.
    WIP

## 2. Workflow (direct to main)

- Work on `main`. Push when green. No feature branches in MVP.
- One verified step per commit (see `AGENTS.md` §27):
  implement → typecheck/build → test → verify → commit.
- Never mix unrelated packages in one commit.
- Before each commit run at minimum:
  `pnpm typecheck` (when TS exists), `pnpm lint` (when configured),
  `pnpm test` (fixtures only, never live).
  `pnpm test:live` never gates a commit.

## 3. What to commit / never commit

Commit: source, migrations, `pnpm-lock.yaml`, `.env.example`,
`docs/`, `openapi.yaml`, commit tooling.

Never commit: `.env`, secrets/tokens, `node_modules/`, `dist/`,
`coverage/`, local `pgdata/`. `.env.example` stays in sync with
`packages/config` Zod schema; `.env` is gitignored.

## 4. Tooling

- `husky` installs git hooks via `pnpm prepare` (Husky v9 `husky` command).
- `.husky/commit-msg` runs
  `pnpm exec commitlint --edit $1` on every commit.
- Bypass only to fix the hook itself: `git commit --no-verify -m "…"`,
  then fix the hook in the next commit. Never use `--no-verify`
  for normal work.
- CI (when added): run `commitlint --from origin/main~1` or
  `commitlint --from HEAD~1` on push to reject bad headers server-side.

## 5. Initial history plan

    docs(spec): lock HackerOne MVP contract
    chore(repo): add commitlint and husky
    … then per package: feat(database), feat(domain), feat(collector), feat(api)

## 6. Changing this rule

Edit this file + `commitlint.config.js` in the same commit
(`docs(repo): …` or `chore(repo): …`). Keep `AGENTS.md §27`
pointer short; full rule lives here.
