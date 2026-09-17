# AGENTS.md

# Anveshan

Anveshan is a bug-bounty program and scope monitoring system for cybersecurity researchers and bug bounty hunters.

The system collects program and scope information from authorized bug-bounty platform APIs and detects changes over time.

---

# 1. Current Milestone

The current milestone is the first working MVP.

The MVP supports ONLY:

- PROGRAM_ADDED
- ASSET_ADDED
- ASSET_REMOVED

The current collector type is ONLY:

- HackerOne API Collector (`platform = "hackerone"`, HackerOne Hacker API v1)

See `docs/decisions/005-hackerone.md`.

The goal is to prove that Anveshan can collect real bug-bounty program and scope data from HackerOne and reliably detect changes between collection runs.

---

# 2. Explicitly Out of Scope

Do NOT implement any of the following in the current milestone:

- Web scraping
- RSS collectors
- Feed collectors
- Webhook collectors
- Email notifications
- Discord notifications
- Telegram notifications
- User accounts
- Authentication
- Frontend/dashboard
- Kafka
- Redis
- RabbitMQ
- Kubernetes
- Microservices
- Elasticsearch
- AI/LLM functionality
- Vulnerability scanning
- Subdomain enumeration
- Exploitation
- Brute forcing
- Credential attacks
- Authentication bypass
- Asset modification detection
- Program removal detection
- Bounty changes
- Policy changes
- Program status changes

Do not implement future functionality prematurely.

---

# 3. Technology Stack

Use the following technologies:

- pnpm workspaces
- TypeScript
- Node.js
- Express.js
- PostgreSQL
- Drizzle ORM
- Drizzle Kit
- Zod
- Pino
- Vitest
- Supertest
- node-cron
- Docker
- Docker Compose
- OpenAPI
- ESLint
- Prettier
- dotenv

Do not replace Express with Fastify.

Do not introduce additional infrastructure unless there is a concrete requirement.

---

# 4. Repository Structure

Use a pnpm monorepo.

Preferred structure:

    anveshan/
    │
    ├── AGENTS.md
    ├── README.md
    ├── package.json
    ├── pnpm-workspace.yaml
    ├── pnpm-lock.yaml
    ├── tsconfig.json
    ├── docker-compose.yml
    ├── .env.example
    ├── .gitignore
    │
    ├── apps/
    │   └── api/
    │       └── src/
    │
    ├── packages/
    │   ├── collector/
    │   ├── database/
    │   ├── domain/
    │   └── config/
    │
    └── docs/
        ├── architecture.md
        ├── collector.md
        ├── database.md
        ├── development.md
        ├── snapshot-algorithm.md
        ├── openapi.yaml
        └── decisions/

The structure may be adjusted when there is a strong technical reason.

---

# 5. Architecture

The initial architecture is:

    External Bug Bounty API
             │
             ▼
        API Client
             │
             ▼
    API Collector + Normalizer
             │
             ▼
      Collection Service
             │
             ├── load previous live rows
             ├── Domain Diff Engine (pure)
             └── persist (programs, assets,
                 snapshot pointers, changes)
                      │
                      ▼
                 PostgreSQL
             ┌────────┼────────┐
             ▼        ▼        ▼
          PROGRAM   ASSET    ASSET
           ADDED    ADDED   REMOVED

Fetch happens before any persist. Diff uses previous live rows loaded
before upsert. See `docs/snapshot-algorithm.md` §6.

Keep these boundaries clean.

---

# 6. Collector Rules

Only implement the HackerOne API collector (`packages/collector`).

The collector must communicate with the real HackerOne Hacker API v1:

    Base: https://api.hackerone.com/v1/hackers
    Auth: Basic Auth HACKERONE_USERNAME + HACKERONE_API_TOKEN
    Programs: GET /hackers/programs?page[size]=100&page[number]=N
    Scopes:   GET /hackers/programs/{handle}/structured_scopes?page[size]=100&page[number]=N

See `docs/collector.md` and `docs/decisions/005-hackerone.md`.

Do NOT mock the collector.

Do NOT hardcode fake programs.

Do NOT create fake API responses and treat them as real data.

Unit tests MUST use fixtures mirroring real HackerOne shapes
(see `packages/collector/test/fixtures/` contract in `docs/collector.md`).

The collector should:

1. Authenticate with HackerOne (Basic Auth, 401 = `AUTH_FAILED`).
2. Fetch programs (paginate all pages, `page[size]=100`).
3. Fetch structured scopes per program handle (paginate all pages).
4. Handle pagination via `links.next` / `data.length == page[size]`,
   and `filter[id__gt]` after HackerOne's 10,000-scope page cap.
5. Respect rate limits (throttle ~40 req/min scopes, backoff on 429 with `Retry-After`).
6. Normalize HackerOne responses (asset_type map, canonicalize identifiers, `eligible_for_bounty` -> scope).
7. Return internal domain objects.

Fail-closed: any program-level scope fetch failure fails the whole
collection run (`failed`, no partial snapshot). Prevents false ASSET_REMOVED storms.

External API details must remain inside the collector package.

---

# 7. Collector Abstraction

Use an abstraction similar to:

    interface ProgramCollector {
      // HackerOne handle is the program key, e.g. "acme".
      // platform is always "hackerone" in MVP.
      // getPrograms() does not include assets.
      getPrograms(): Promise<CollectedProgram[]>;
      getProgramAssets(programHandle: string): Promise<CollectedAsset[]>;
    }

The exact interface may be improved when implementing the real API.

The rest of the application must not depend on the external API response format.

---

# 8. Domain Models

Create normalized internal models.

Example:

    type AssetType =
      | "DOMAIN"
      | "WILDCARD"
      | "IP"
      | "CIDR"
      | "URL"
      | "ANDROID"
      | "IOS"
      | "API"
      | "OTHER";

Program:

    interface CollectedProgram {
      externalId: string;
      name: string;
      platform: string;
      url?: string;
    }

Asset:

    interface CollectedAsset {
      externalId?: string; // HackerOne structured-scope id
      identifier: string;  // canonicalized (see docs/snapshot-algorithm.md §3)
      type: AssetType;
      scope: "IN" | "OUT"; // IN = eligible_for_bounty == true
    }

Scope rule: persist ALL HackerOne scopes (IN + OUT) for audit, but
ONLY `scope == "IN"` participates in ASSET_ADDED / ASSET_REMOVED.
OUT -> IN = ASSET_ADDED. IN -> OUT = ASSET_REMOVED.
Missing from a later fetch of the same program → live `scope=OUT`
(+ ASSET_REMOVED if it was IN). VDP (all bounty-ineligible) → no ASSET_* events.

Asset diff key (per program): `type + "|" + normalized_identifier`.
A `type` change on the same string is REMOVED(old) + ADDED(new).
Metadata-only changes never emit. See `docs/snapshot-algorithm.md`.

Program updates (`name`, `url`): update row, emit nothing.
Only program addition emits in MVP.

---

# 9. Supported Change Types

The only supported change types are:

    PROGRAM_ADDED
    ASSET_ADDED
    ASSET_REMOVED

Do not create:

    PROGRAM_REMOVED
    ASSET_MODIFIED

or any other change type.

---

# 10. Program Change Detection

Example first collection:

    Program A
    Program B
    Program C

This establishes the baseline.

Result:

    0 changes

Second collection:

    Program A
    Program B
    Program C
    Program D

Result:

    PROGRAM_ADDED
    Program D

If a program disappears from the API, ignore it.

Do not generate PROGRAM_REMOVED.

---

# 11. Asset Change Detection

Compare the current scope against the previous scope for each program.

Example previous scope:

    example.com
    api.example.com
    old.example.com

Current scope:

    example.com
    api.example.com
    new.example.com

Result:

    ASSET_ADDED
    new.example.com

    ASSET_REMOVED
    old.example.com

---

# 12. Asset Modification

Do not detect asset modifications.

If an asset's metadata changes:

    old description
          ↓
    new description

do not generate a change.

A `type` change on the same identifier string is NOT a modification:
it is `ASSET_REMOVED(old type|identifier)` + `ASSET_ADDED(new type|identifier)`,
because the diff key is `type|identifier` (see snapshot-algorithm.md §2).

Ignore:

- description changes
- bounty changes
- severity changes
- metadata changes
- policy changes

---

# 13. First Collection

The first successful collection establishes the baseline.

Do not generate PROGRAM_ADDED or ASSET_ADDED events for data discovered during the first collection.

Example:

    First collection
          ↓
    100 programs
    4000 assets
          ↓
    Store baseline
          ↓
    0 changes

Only subsequent collections should produce changes.

Treat as first/baseline when there is no `completed` collection run
**or** the `programs` table is empty (see `docs/snapshot-algorithm.md` §6).

---

# 14. Idempotency

Running the collector multiple times against unchanged data must not create duplicate changes.

Example:

    Run 1 → baseline
    Run 2 → 0 changes
    Run 3 → 0 changes

Enforce via:

- `UNIQUE(programs.platform, external_id_lower)`
- `UNIQUE(assets.program_id, asset_key)` where `asset_key = type|normalized_identifier`
- Partial unique indexes on `changes` (NULL-safe; see `docs/database.md`)
- Set-diff on canonical keys (order-independent).
- Diff **before** upsert; fetch **outside** the persist transaction.

See `docs/snapshot-algorithm.md` §§6-7.

---

# 15. Database

Use:

- PostgreSQL
- Drizzle ORM
- Drizzle Kit

Use migrations.

Minimum conceptual tables:

    programs
    assets                  -- assets.program_id; no program_assets table
    collection_runs
    program_snapshots (pointer, not full copy)
    asset_snapshots (pointer, not full copy)
    changes

Use:

- internal IDs
- external IDs
- foreign keys
- unique constraints
- indexes where appropriate
- timestamps

---

# 16. Express Application

Use Express.js with TypeScript.

The Express application is responsible for:

- HTTP server
- routing
- controllers
- request validation
- error handling
- health checks
- Collection Service (cron and `pnpm collect` call this same module)

Do not put database queries directly inside route handlers.

Preferred flow:

    HTTP Request
         ↓
       Route
         ↓
     Controller
         ↓
       Service
         ↓
     Repository
         ↓
      Database

Controllers should remain thin.

---

# 17. API Endpoints

Implement:

    GET /health
      → 200 { "status": "ok" }

    GET /api/v1/programs?page=1&pageSize=25
      → 200 { data: Program[], pagination: { page, pageSize, total } }
      → default pageSize 25, max 100

    GET /api/v1/programs/:id
      → 200 { data: Program } | 404 PROGRAM_NOT_FOUND
      → :id is internal UUID (not HackerOne handle)

    GET /api/v1/programs/:id/assets?scope=IN&page=1&pageSize=100
      → scope filter: ALL (default) | IN | OUT

    GET /api/v1/programs/:id/changes?since=2026-01-01T00:00:00Z
      → ordered detected_at DESC, paginated

Full contract: `docs/openapi.yaml` (source of truth for shapes).

These endpoints are read-only.

No user authentication is required for the MVP.

---

# 18. Error Handling

Use centralized Express error handling.

Errors should return consistent JSON.

Example:

    {
      "error": {
        "code": "PROGRAM_NOT_FOUND",
        "message": "Program not found"
      }
    }

MVP error `code` enum (keep closed):

    PROGRAM_NOT_FOUND,
    BAD_REQUEST (Zod validation), INTERNAL,
    COLLECTION_FAILED, AUTH_FAILED, RATE_LIMITED, NETWORK, TIMEOUT

Handle:

- invalid API credentials
- API timeout
- network errors
- rate limits
- malformed API responses
- database errors

Never silently swallow errors.

---

# 19. Validation

Use Zod for:

- environment variables
- API input
- external API response validation where useful
- configuration

Never blindly trust external API data.

---

# 20. Logging

Use Pino.

Every collection run should have a unique collection run ID.

Example:

    [collection:01J...] Starting
    [collection:01J...] Fetching programs
    [collection:01J...] Programs discovered: 120
    [collection:01J...] New programs: 2
    [collection:01J...] Assets discovered: 4821
    [collection:01J...] Assets added: 7
    [collection:01J...] Assets removed: 3
    [collection:01J...] Completed

Never log:

- API keys
- authorization headers
- database passwords
- secrets

---

# 21. Scheduling

Use node-cron.

The schedule must be configurable.

Example:

    COLLECTION_CRON=*/30 * * * *

Defaults:

    COLLECTION_CRON=*/30 * * * * (every 30 min)
    COLLECTION_TZ=UTC
    COLLECTION_ENABLED=true (false in test)

Overlap: never run two collections concurrently.
Use session `pg_try_advisory_lock` for the whole fetch+persist (not
xact lock). If a run is active, skip + warn log. Mark `running` rows
older than 2 hours as `failed` before starting.

The scheduler and manual collection command must call the same collection service.

Do not duplicate collection logic.

---

# 22. CLI Collection

Provide:

    pnpm collect

The command should:

1. Load configuration.
2. Connect to PostgreSQL.
3. Take the collection lock; fail stale `running` rows.
4. Fetch all programs (collector).
5. Fetch all assets per program (collector; no HTTP in the DB txn).
6. Load previous live rows.
7. Diff (domain): new programs, added IN assets, removed IN assets.
8. Persist upserts, set missing seen-program assets to OUT, snapshot pointers, changes.
9. Print a summary.

---

# 23. Testing

Use Vitest.

Use Supertest for Express HTTP tests.

At minimum test:

    First collection
    → 0 changes

    New program
    → PROGRAM_ADDED

    Existing program
    → no change

    New asset
    → ASSET_ADDED

    Removed asset
    → ASSET_REMOVED + live row scope=OUT

    Same asset
    → no change

    Asset metadata changed
    → no change

    Repeated collection
    → no duplicate changes

Do not make normal tests depend on the live external API.

Use fixtures for external API responses.

Split:

- `pnpm test` → unit + API tests with fixtures in
  `packages/collector/test/fixtures/hackerone/*.json`
  (programs page 1+2, scopes IN+OUT, empty page, 401, 429).
  Never hits network. `COLLECTION_ENABLED=false`.
- `pnpm test:live` → gated by `H1_LIVE_TEST=1` + real
  `HACKERONE_USERNAME`/`HACKERONE_API_TOKEN`. Runs:
  auth → 1 programs page → 1 program scopes → normalize →
  persist → re-run unchanged → assert 0 new changes.
  Skipped in CI when env missing. Never assert exact counts
  (HackerOne data changes); assert shapes + idempotency.

---

# 24. Live API Verification

The collector must be tested against the real external API.

Do not mark the collector complete based only on unit tests.

Verify:

1. Authentication works.
2. Programs can be fetched.
3. Assets can be fetched.
4. Pagination works.
5. Data is normalized.
6. Data is persisted.
7. A second unchanged collection produces zero false changes.

---

# 25. Security

This is a defensive monitoring application.

Only collect information available through authorized/public API access.

Do not implement:

- exploitation
- brute force
- credential attacks
- unauthorized scanning
- authentication bypass
- evasion

Respect API terms, authentication requirements, and rate limits.

Never commit secrets.

---

# 26. Coding Rules

Use TypeScript strict mode.

Prefer small focused functions.

Avoid giant files.

Avoid unnecessary abstractions.

Avoid premature optimization.

Avoid unnecessary dependencies.

Avoid `any` unless there is a documented reason.

Keep domain logic independent of infrastructure.

The diff engine should be pure business logic.

The diff engine must not depend on:

- Express
- PostgreSQL
- Drizzle
- HTTP
- external API clients

---

# 27. Implementation Process

Work incrementally.

For every major change:

1. Implement.
2. Run TypeScript/build checks.
3. Run tests.
4. Fix errors.
5. Verify behavior.
6. Continue.

Do not claim something works unless the relevant command has actually been executed.

GitHub/commit rule: follow `docs/github.md` (Conventional Commits,
direct to `main`, one verified step per commit). The
`commit-msg` Husky hook enforces the format — do not use
`--no-verify` for normal work.

---

# 28. Definition of Done

The MVP is complete only when:

- pnpm monorepo works
- TypeScript builds
- Express works
- PostgreSQL works
- Docker Compose works
- Drizzle migrations work
- Environment validation works
- Real API credentials work
- Real API collector works
- Programs are collected
- Assets are collected
- Programs are persisted
- Assets are persisted
- First collection creates baseline
- New programs are detected
- New assets are detected
- Removed assets are detected
- Program removal is ignored
- Asset modification is ignored
- Unchanged collection produces zero changes
- Duplicate changes are prevented
- Collection runs are tracked
- Scheduler works
- Express API works
- Health endpoint works
- OpenAPI documentation exists
- Tests pass
- Live API integration works
- README is complete
- No secrets are committed
- No mocked collector is used

---

# 29. Important Principle

Do not build the entire Anveshan product yet.

Build this vertical slice:

    REAL BUG BOUNTY API
            ↓
        API CLIENT
            ↓
    API COLLECTOR + NORMALIZER
            ↓
      Collection Service
            ↓
    load previous live rows
            ↓
       DOMAIN DIFF
            ↓
         PERSIST
            ↓
    ┌───────┼────────┐
    ↓       ↓        ↓

PROGRAM ASSET ASSET
ADDED ADDED REMOVED

The goal of this milestone is to prove that Anveshan can reliably detect new programs and changes to in-scope assets.
