# Anveshan Architecture

## Overview

Anveshan is designed as a monitoring pipeline.

The system collects data from a bug-bounty platform, normalizes it, stores
current state plus lightweight snapshot pointers, diffs incoming state
against previous live rows, and records changes.

## Current Architecture

    External API
         │
         ▼
    API Client
         │
         ▼
    API Collector + Normalizer
         │
         ▼
    Collection Service (apps/api)
         │
         ├── load previous live rows
         ├── Domain Diff Engine (pure)
         └── Repository persist
                  │
                  ▼
             PostgreSQL
              programs / assets
              snapshots (pointers)
              changes

## Components

### API Application

Located in:

    apps/api

Responsibilities:

- HTTP server
- API routes
- controllers
- services
- health endpoint
- OpenAPI
- Collection Service (orchestrator)
- node-cron scheduler (calls Collection Service)
- `pnpm collect` CLI entry (calls Collection Service)

The API should not contain HackerOne response parsing. That stays in
`packages/collector`.

### Collection Service

Located in:

    apps/api  (same module for cron and CLI)

Responsibilities:

- session advisory lock / stale-run recovery
- call collector (HTTP, outside DB transaction)
- load previous live state
- call domain diff
- persist programs, assets, snapshot pointers, changes in one transaction

See `docs/snapshot-algorithm.md`.

### Collector

Located in:

    packages/collector

Responsibilities:

- communicate with HackerOne Hacker API v1
- authenticate
- handle pagination (including `filter[id__gt]` for large scopes)
- handle rate limits
- retrieve programs
- retrieve assets
- normalize external responses

`getPrograms()` returns programs **without** nested assets.
`getProgramAssets(handle)` returns that program's scopes.

### Domain

Located in:

    packages/domain

Contains:

- program models
- asset models
- change models
- diff logic

The domain layer should remain independent of infrastructure.
The diff engine must not import Express, Drizzle, HTTP, or collector clients.
It receives previous and current normalized sets and returns change records.

### Database

Located in:

    packages/database

Responsibilities:

- Drizzle schema
- migrations
- repositories
- PostgreSQL connection

### Config

Located in:

    packages/config

Responsibilities:

- environment loading
- environment validation
- application configuration

## Data Flow

### Collection

    Scheduler / CLI
          ↓
    Collection Service
          ↓
    API Collector (fetch + normalize)
          ↓
    Previous live rows (DB read)
          ↓
    Domain Diff
          ↓
    Persist (upsert current + snapshot pointers + changes)

## Change Detection

The diff engine compares two normalized states.

    Previous State
          +
    Current State
          ↓
       Diff Engine
          ↓
    Changes

Supported changes:

    PROGRAM_ADDED
    ASSET_ADDED
    ASSET_REMOVED

## First Run

The first successful collection creates the baseline.

No changes are generated.

## Later Runs

Subsequent runs compare the incoming normalized state against the previous
live `programs` / `assets` rows (loaded before upsert).

## Design Principle

The collector knows about the external platform.

The domain does not.

This allows additional collectors to be introduced later without changing the core change-detection logic.
