# Anveshan

> Bug-bounty program and scope change monitoring for security researchers.

Anveshan monitors bug-bounty programs and their in-scope assets and detects changes over time.

The first version focuses on API-based collection.

## Current capabilities

Anveshan currently detects:

- 🆕 Program added
- ➕ Asset added
- ➖ Asset removed

Example:

    Program: Example Corp

    Previous scope:
    example.com
    api.example.com

    Current scope:
    example.com
    api.example.com
    admin.example.com

    Detected:
    ➕ Asset added
    admin.example.com

## Current collector

The current version supports:

    HackerOne API Collector (HackerOne Hacker API v1, platform="hackerone")

    Programs: GET /hackers/programs
    Scopes:   GET /hackers/programs/{handle}/structured_scopes

Auth: Basic Auth `HACKERONE_USERNAME` + `HACKERONE_API_TOKEN`.
See `docs/decisions/005-hackerone.md` and `docs/collector.md`.

Web scraping, RSS, webhooks, and other collectors are planned for later milestones.

## Architecture

    Bug Bounty Platform API
              ↓
         API Collector
              ↓
      Collection Service
              ↓
         Domain Diff
              ↓
          PostgreSQL
       (current + changes)

## Technology Stack

- Node.js
- TypeScript
- Express.js
- PostgreSQL
- Drizzle ORM
- Zod
- Pino
- Vitest
- Supertest
- node-cron
- Docker
- Docker Compose
- pnpm

## Repository Structure

    apps/
      api/
      web/          # Milestone 2 subscriber frontend (Next.js)

    packages/
      collector/
      database/
      domain/
      config/
      notifications/  # Milestone 2 SMTP transport + email templates

    docs/
      api.md
      architecture.md
      background-jobs.md
      collector.md
      database.md
      development.md
      notification-design.md  # Milestone 2
      snapshot-algorithm.md
      openapi.yaml
      decisions/

## Running locally

Full step-by-step guide: [`docs/running.md`](docs/running.md)
(prerequisites, setup, API, frontend, sign-in, collector, tests, gotchas).

Quick start:

    pnpm install
    cp .env.example .env
    docker compose up -d postgres
    pnpm db:migrate
    pnpm dev        # API on :3000 (second terminal: pnpm dev:web for :3001)

To exercise the API by hand, import `postman/anveshan-collection.json`
into Postman (36 requests: health, public reads, auth, admin) with an
environment providing `baseUrl` + `adminKey`.

## Production

In production, one process runs everything: Express API + cron scheduler + HackerOne collector. No separate worker needed.

### How it works

    ┌──────────────────────────────────────────────────┐
    │              node apps/api/dist/index.js           │
    │                                                    │
    │  Express API (port 3000)                           │
    │    ├── GET /health                                 │
    │    ├── GET /api/v1/programs (+ assets, changes)    │
    │    ├── POST /api/v1/auth/* (magic link)            │
    │    └── subscriptions + watches + unsubscribe       │
    │                                                    │
    │  node-cron scheduler                               │
    │    └── every 30 min → runCollection()              │
    │         ├── fetch from HackerOne API               │
    │         ├── diff against previous state            │
    │         └── persist programs, assets, changes      │
    │                                                    │
    │  Milestone 2 notification paths                    │
    │    ├── post-collection enqueue (outbox rows)       │
    │    ├── delivery worker (30s drain → SMTP)          │
    │    └── daily digest cron (08:00 UTC)               │
    └──────────────────────────────────────────────────┘

### Deploy with Docker

    # 1. Create .env with real credentials
    cp .env.example .env

    # 2. Build and start
    docker compose --profile api up -d --build

This starts three containers:

- `anveshan-postgres` — Postgres 16 (persistent volume `pgdata`)
- `anveshan-api` — your app (built from `apps/api/Dockerfile`)
- `anveshan-web` — subscriber frontend (built from `apps/web/Dockerfile`,
  port 3001, proxies `/api/*` to the api service)

### Deploy without Docker (bare metal / VPS)

    # 1. Install dependencies
    pnpm install

    # 2. Set up database
    docker compose up -d postgres
    sleep 5
    pnpm db:migrate

    # 3. Build
    pnpm build

    # 4. Start
    node apps/api/dist/index.js

### Environment variables

| Variable              | Required | Default        | Description                                                                |
| --------------------- | -------- | -------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`        | Yes      | —              | Postgres connection string                                                 |
| `HACKERONE_USERNAME`  | Yes      | —              | HackerOne API username                                                     |
| `HACKERONE_API_TOKEN` | Yes      | —              | HackerOne API token                                                        |
| `COLLECTION_CRON`     | No       | `*/30 * * * *` | Collection schedule (cron expression)                                      |
| `COLLECTION_TZ`       | No       | `UTC`          | Timezone for cron schedule                                                 |
| `COLLECTION_ENABLED`  | No       | `true`         | Enable/disable scheduler                                                   |
| `PORT`                | No       | `3000`         | API listen port                                                            |
| `LOG_LEVEL`           | No       | `info`         | Pino log level                                                             |
| `ADMIN_API_KEY`       | No       | —              | Gate for `/api/v1/admin/*` (`X-Admin-Key` header; unset = 401 fail-closed) |

### Manual collection

To run a one-off collection (same logic as the scheduler):

    pnpm collect

### What happens on startup

1. Loads env from root `.env`
2. Connects to Postgres, runs migrations
3. Starts cron scheduler (if `COLLECTION_ENABLED=true`)
4. Starts Express API on configured port
5. Every 30 minutes: fetch programs → fetch scopes → diff → persist
6. On SIGTERM/SIGINT: stops API, closes DB pool, exits cleanly

### Collection schedule

The default cron `*/30 * * * *` runs every 30 minutes. Each full collection takes ~15-20 minutes (rate-limited by HackerOne API). Overlap is prevented by a Postgres session advisory lock — if a run is still going, the next scheduled run skips.

Runtime control (no restart): `GET/PUT/DELETE /api/v1/admin/scheduler`
(`X-Admin-Key` required) reads or changes the schedule live. A PUT persists a
`scheduler_settings` row that **overrides** `COLLECTION_CRON`/`COLLECTION_TZ`
until DELETEd, which hands control back to the env values. A 60s reconcile
tick picks up external row edits, and `COLLECTION_ENABLED=false` is the master
kill switch (PUT/DELETE then return `409 SCHEDULER_DISABLED`). Details in
[`docs/background-jobs.md`](docs/background-jobs.md) §4.

### Graceful shutdown

The process handles `SIGINT` and `SIGTERM` with an ordered stop (10s
force-exit safety net so a stuck socket or worker can never hang exit):

1. Stop background work first, awaiting in-flight work (bounded, parallel):
   collection scheduler (cron task + reconcile timer), delivery worker,
   digest cron
2. Close the HTTP server (in-flight requests drain)
3. Close the database pool
4. Exit

## API

Program/asset/change reads are public and read-only. Auth, subscription,
and watch endpoints need a session (magic link). Full reference with curl
examples in [`docs/api.md`](docs/api.md).

| Endpoint                           | Description                           |
| ---------------------------------- | ------------------------------------- |
| `GET /health`                      | Health check                          |
| `GET /api/v1/programs`             | List programs                         |
| `GET /api/v1/programs/:id`         | Get program by UUID                   |
| `GET /api/v1/programs/:id/assets`  | List program assets (filter by scope) |
| `GET /api/v1/programs/:id/changes` | List detected changes                 |

Milestone 2 adds: `POST /api/v1/auth/*` (magic link),
`GET/PUT /api/v1/subscriptions`, watch CRUD, `POST /api/v1/unsubscribe`.

Admin endpoints need `X-Admin-Key: <ADMIN_API_KEY>` (unset key = 401):

| Endpoint                            | Description                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| `POST /api/v1/admin/collections`    | Trigger one collection run now (`202 running`, `200 skipped`)                    |
| `GET /api/v1/admin/collections`     | Recent collection runs (newest first)                                            |
| `GET /api/v1/admin/collections/:id` | One run's summary                                                                |
| `GET /api/v1/admin/scheduler`       | Scheduler status (`enabled`, `source`, `cron`, `timezone`, `running`, `lastRun`) |
| `PUT /api/v1/admin/scheduler`       | Start/stop/reschedule now (`{ enabled?, cron?, timezone? }`, persists)           |
| `DELETE /api/v1/admin/scheduler`    | Reset to `COLLECTION_*` env config                                               |

## Change Types

Currently supported:

    PROGRAM_ADDED
    ASSET_ADDED
    ASSET_REMOVED

## What Anveshan does not currently do

Anveshan does not:

- scan targets
- find vulnerabilities
- exploit vulnerabilities
- enumerate subdomains
- perform brute force
- scrape websites
- consume RSS
- consume webhooks
- detect asset modifications
- detect program removals

## Documentation

Technical documentation is available in:

    docs/

See:

- [`docs/api.md`](docs/api.md)
- [`docs/running.md`](docs/running.md)
- [`docs/deploy.md`](docs/deploy.md)
- [`docs/notification-design.md`](docs/notification-design.md)
- [`docs/notifications.md`](docs/notifications.md)
- [`docs/daily-digest.md`](docs/daily-digest.md)
- [`docs/background-jobs.md`](docs/background-jobs.md)
- `docs/architecture.md`
- `docs/collector.md`
- `docs/database.md`
- `docs/development.md`
- `docs/snapshot-algorithm.md`
- `docs/openapi.yaml`
- `docs/decisions/`

## Project Status

Done: collector MVP (real HackerOne collection, diff, persist, read-only
API) and email notifications (magic-link auth, subscriptions with watches,
outbox-based SMTP delivery, Next.js subscriber app).

Current milestone: frontend experience — restyling the subscriber app
without changing API contracts or notification semantics.
