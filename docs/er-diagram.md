# Anveshan — Database Visualization

Source of truth for columns/constraints: `packages/database/src/schema.ts`
and `docs/database.md`. This diagram is a rendering aid — if it drifts,
the schema file wins. FK list below was verified against live Postgres
(`information_schema`, 16 foreign keys, 12 tables).

## 1. Browse live data

### Option A — Drizzle Studio (recommended, already wired)

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm db:studio
# → https://local.drizzle.studio
```

`packages/database/drizzle.config.ts` loads the repo-root `.env` via
`initLocalEnv()` and passes `dbCredentials.url = DATABASE_URL`
(fallback `postgres://anveshan:anveshan@localhost:5433/anveshan`).
Before the fix, `db:studio` failed with
`Please specify a 'dbCredentials' param in config`.

### Option B — External GUI (DBeaver / TablePlus / pgAdmin / VS Code)

```
Host: localhost   Port: 5433
User: anveshan    Password: anveshan
Database: anveshan
```

In DBeaver: right-click `public` → `View Diagram` for an auto-layout ER
from live FKs. Use data grids to browse `programs` / `assets` / `changes`.

### Option C — CLI (no GUI, `psql` lives inside the container)

```bash
docker exec anveshan-postgres psql -U anveshan -d anveshan -c "\dt"
docker exec anveshan-postgres psql -U anveshan -d anveshan -c "\d programs"
docker exec anveshan-postgres psql -U anveshan -d anveshan -c "SELECT count(*) FROM programs;"
```

## 2. ER diagram (Mermaid — renders on GitHub / VS Code preview)

```mermaid
erDiagram
    programs {
        uuid id PK
        text platform
        text external_id
        text external_id_lower
        text external_numeric_id "nullable"
        text name
        text url "nullable"
        timestamptz last_seen_at "nullable"
        timestamptz created_at
        timestamptz updated_at
    }
    assets {
        uuid id PK
        uuid program_id FK
        text external_id "nullable"
        text identifier
        text normalized_identifier
        text asset_type
        text scope "IN|OUT"
        text asset_key
        timestamptz created_at
        timestamptz updated_at
    }
    collection_runs {
        uuid id PK
        timestamptz started_at
        timestamptz completed_at "nullable"
        text status "running|completed|failed"
        int programs_seen
        int assets_seen
        int programs_added
        int assets_added
        int assets_removed
        text error_code "nullable"
        text error_message "nullable"
    }
    program_snapshots {
        uuid collection_run_id PK_FK
        uuid program_id PK_FK
    }
    asset_snapshots {
        uuid collection_run_id PK_FK
        uuid program_id PK_FK
        uuid asset_id PK_FK
        text asset_key
    }
    changes {
        uuid id PK
        text change_type "PROGRAM_ADDED|ASSET_ADDED|ASSET_REMOVED"
        uuid program_id FK
        uuid asset_id FK "nullable, SET NULL"
        text asset_key "nullable"
        text asset_identifier "nullable"
        uuid collection_run_id FK
        timestamptz detected_at
    }
    users {
        uuid id PK
        text email UK
        timestamptz email_verified_at "nullable"
        timestamptz created_at
        timestamptz unsubscribed_at "nullable"
    }
    magic_link_tokens {
        uuid id PK
        uuid user_id FK
        text token_hash UK
        timestamptz expires_at
        timestamptz consumed_at "nullable"
        timestamptz created_at
    }
    sessions {
        uuid id PK
        uuid user_id FK
        text token_hash UK
        timestamptz expires_at
        timestamptz created_at
    }
    subscriptions {
        uuid user_id PK_FK
        text frequency "immediate|daily"
        boolean watch_new_programs
        boolean watch_all_programs
        text digest_timezone "IANA, default UTC"
        time digest_time_local "HH:MM close, default 08:00"
        timestamptz updated_at
    }
    watches {
        uuid user_id PK_FK
        uuid program_id PK_FK
        timestamptz created_at
    }
    notification_deliveries {
        uuid id PK
        uuid user_id FK
        text channel "email"
        text kind "immediate|daily"
        uuid collection_run_id FK "nullable, immediate only"
        date digest_on "nullable, daily only; UTC date of close"
        timestamptz digest_close_at "nullable, daily close instant"
        text status
        int attempts
        timestamptz next_attempt_at "nullable"
        text last_error "nullable"
        timestamptz sent_at "nullable"
        timestamptz created_at
        timestamptz updated_at
    }

    programs ||--o{ assets : "program_id"
    programs ||--o{ program_snapshots : "program_id"
    collection_runs ||--o{ program_snapshots : "collection_run_id"
    programs ||--o{ asset_snapshots : "program_id"
    collection_runs ||--o{ asset_snapshots : "collection_run_id"
    assets ||--o{ asset_snapshots : "asset_id"
    programs ||--o{ changes : "program_id"
    assets ||--o{ changes : "asset_id nullable"
    collection_runs ||--o{ changes : "collection_run_id"
    users ||--o{ magic_link_tokens : "user_id"
    users ||--o{ sessions : "user_id"
    users ||--|| subscriptions : "user_id 1-1"
    users ||--o{ watches : "user_id"
    programs ||--o{ watches : "program_id"
    users ||--o{ notification_deliveries : "user_id"
    collection_runs ||--o{ notification_deliveries : "collection_run_id nullable"
```

Notes:

- `assets.asset_key = type || '|' || normalized_identifier`, unique per
  `(program_id, asset_key)`. Same domain in two programs = two rows.
- Only `scope = 'IN'` emits `ASSET_ADDED` / `ASSET_REMOVED`. Missing asset
  on re-fetch flips live row to `OUT`, never deletes.
- `program_snapshots` / `asset_snapshots` are pointer tables, not copies.
- `changes` uses partial unique indexes (NULL-safe) — see `docs/database.md`.
- `subscriptions.user_id` is both PK and FK (one row per user, created only
  when the user saves the dashboard). `digest_timezone` + `digest_time_local`
  set the personal daily close ([close-24h, close)); defaults UTC/08:00.
- `notification_deliveries` enforces immediate-vs-daily column rules via
  `CHECK (kind ... collection_run_id ... digest_on)`. Daily uniqueness is
  on the exact close instant (`digest_close_at`), not the calendar date,
  so a 23-hour DST day with two same-date closes still delivers both.
- `notification_deliveries` enforces immediate-vs-daily column rules via
  `CHECK (kind ... collection_run_id ... digest_on)`.
