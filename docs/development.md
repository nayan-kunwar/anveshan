# Development

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose
- HackerOne account + API token (https://hackerone.com/settings/api_token)
  Only needed for `pnpm collect` / `pnpm test:live`. Unit tests use fixtures.

## Setup

    cp .env.example .env
    # fill HACKERONE_USERNAME, HACKERONE_API_TOKEN, DATABASE_URL
    pnpm install
    docker compose up -d postgres
    pnpm db:migrate
    pnpm dev

## Workspace scripts (contract)

Root `package.json` MUST expose:

| Script                                          | Purpose                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                                      | run `apps/api` in watch mode                                       |
| `pnpm build`                                    | `tsc -b` all workspaces                                            |
| `pnpm typecheck`                                | `tsc --noEmit` all workspaces                                      |
| `pnpm lint` / `pnpm format`                     | eslint / prettier check                                            |
| `pnpm test`                                     | vitest run (unit + API, fixtures only, `COLLECTION_ENABLED=false`) |
| `pnpm test:live`                                | live HackerOne check, gated by `H1_LIVE_TEST=1`                    |
| `pnpm collect`                                  | manual collection (same service as scheduler)                      |
| `pnpm db:migrate` / `db:generate` / `db:studio` | drizzle-kit                                                        |

`apps/api` and each `packages/*` have their own `package.json`
with `name: "@anveshan/<pkg>"`, `type: module`, strict TS.

## Environment

See `.env.example` (source of truth). Key vars:

    DATABASE_URL=postgres://anveshan:anveshan@localhost:5433/anveshan
    HACKERONE_USERNAME=
    HACKERONE_API_TOKEN=
    COLLECTION_CRON=*/30 * * * *
    COLLECTION_TZ=UTC
    COLLECTION_ENABLED=true
    COLLECTION_STALE_RUNNING_MS=7200000
    H1_MIN_DELAY_MS=1500
    H1_MAX_CONCURRENCY=1
    LOG_LEVEL=info
    PORT=3000

Validation: `packages/config` with Zod. Fail fast on boot if invalid.
Never log secrets.

Single root `.env` is the only file-based config. Entry points
(`apps/api`, `pnpm collect`, `pnpm db:migrate`) resolve it from the
repo root via `initLocalEnv()` regardless of invoking directory —
never add per-package `.env` files. Shell-exported variables win
over the file; tests ignore the file entirely (hermetic).

## Docker

`docker-compose.yml` services:

- `postgres:16` (volume `pgdata`, healthcheck `pg_isready`)
- `api` (optional in MVP, builds `apps/api`; must `depends_on: postgres`)

Local dev usually runs only `postgres` in Docker, `api` via `pnpm dev`.

## Test split

- `pnpm test`: no network. Fixtures in
  `packages/collector/test/fixtures/hackerone/*.json`.
  Sets `COLLECTION_ENABLED=false` so cron never fires.
- `pnpm test:live`: requires `H1_LIVE_TEST=1` + real credentials.
  Flow: auth → fetch 1 programs page → fetch 1 program scopes →
  normalize → persist → re-run unchanged → assert 0 new changes.
  Skipped (not failed) in CI when env missing. Never assert exact
  program/asset counts.

## Definition of ready (before coding a package)

1. Zod schemas for env + HackerOne responses exist.
2. Fixtures for the happy path + 401 + 429 exist.
3. Migration 001 matches `docs/database.md` constraints.
4. Diff engine is pure (no Express/Drizzle imports) + unit-tested.
