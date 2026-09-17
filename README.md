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

    packages/
      collector/
      database/
      domain/
      config/

    docs/
      architecture.md
      collector.md
      database.md
      development.md
      snapshot-algorithm.md
      openapi.yaml
      decisions/

## Requirements

You need:

- Node.js
- pnpm
- Docker
- Docker Compose
- HackerOne API credentials (`HACKERONE_USERNAME` + `HACKERONE_API_TOKEN`)

## Installation

Clone the repository and install dependencies:

    pnpm install

## Environment

Copy:

    .env.example

to:

    .env

Configure the required API credentials and database connection.

## Start PostgreSQL

    docker compose up -d postgres

## Run migrations

    pnpm db:migrate

## Start API

    pnpm dev

## Run collector

    pnpm collect

## Run tests

    pnpm test

## Production

In production, one process runs everything: Express API + cron scheduler + HackerOne collector. No separate worker needed.

### How it works

    ┌──────────────────────────────────────────────────┐
    │              node apps/api/dist/index.js           │
    │                                                    │
    │  Express API (port 3000)                           │
    │    ├── GET /health                                 │
    │    ├── GET /api/v1/programs                        │
    │    ├── GET /api/v1/programs/:id                    │
    │    ├── GET /api/v1/programs/:id/assets             │
    │    └── GET /api/v1/programs/:id/changes            │
    │                                                    │
    │  node-cron scheduler                               │
    │    └── every 30 min → runCollection()              │
    │         ├── fetch from HackerOne API               │
    │         ├── diff against previous state            │
    │         └── persist programs, assets, changes      │
    └──────────────────────────────────────────────────┘

### Deploy with Docker

    # 1. Create .env with real credentials
    cp .env.example .env

    # 2. Build and start
    docker compose --profile api up -d --build

This starts two containers:

- `anveshan-postgres` — Postgres 16 (persistent volume `pgdata`)
- `anveshan-api` — your app (built from `apps/api/Dockerfile`)

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

| Variable              | Required | Default        | Description                           |
| --------------------- | -------- | -------------- | ------------------------------------- |
| `DATABASE_URL`        | Yes      | —              | Postgres connection string            |
| `HACKERONE_USERNAME`  | Yes      | —              | HackerOne API username                |
| `HACKERONE_API_TOKEN` | Yes      | —              | HackerOne API token                   |
| `COLLECTION_CRON`     | No       | `*/30 * * * *` | Collection schedule (cron expression) |
| `COLLECTION_TZ`       | No       | `UTC`          | Timezone for cron schedule            |
| `COLLECTION_ENABLED`  | No       | `true`         | Enable/disable scheduler              |
| `PORT`                | No       | `3000`         | API listen port                       |
| `LOG_LEVEL`           | No       | `info`         | Pino log level                        |

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

### Graceful shutdown

The process handles `SIGINT` and `SIGTERM`:

1. Stops accepting new HTTP requests
2. Waits for in-flight requests to complete
3. Closes the database pool
4. Exits

## API

All endpoints are read-only. Full reference with curl examples in [`docs/api.md`](docs/api.md).

| Endpoint                           | Description                           |
| ---------------------------------- | ------------------------------------- |
| `GET /health`                      | Health check                          |
| `GET /api/v1/programs`             | List programs                         |
| `GET /api/v1/programs/:id`         | Get program by UUID                   |
| `GET /api/v1/programs/:id/assets`  | List program assets (filter by scope) |
| `GET /api/v1/programs/:id/changes` | List detected changes                 |

## Change Types

Currently supported:

    PROGRAM_ADDED
    ASSET_ADDED
    ASSET_REMOVED

## What Anveshan does not currently do

The current MVP does not:

- scan targets
- find vulnerabilities
- exploit vulnerabilities
- enumerate subdomains
- perform brute force
- send notifications
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
- `docs/architecture.md`
- `docs/collector.md`
- `docs/database.md`
- `docs/development.md`
- `docs/snapshot-algorithm.md`
- `docs/openapi.yaml`
- `docs/decisions/`

## Project Status

Anveshan is currently in the API Collector MVP stage.

The immediate goal is to validate reliable program and scope-change collection before introducing notification infrastructure and additional collector types.
