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
