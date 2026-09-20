# Database Design

## Visualization

- Live data: `pnpm db:studio` (Drizzle Studio at `https://local.drizzle.studio`).
- Static ER diagram + DBeaver/psql instructions: see `er-diagram.md`.

## Database

Anveshan uses:

- PostgreSQL
- Drizzle ORM
- Drizzle Kit

## Purpose

The database stores:

- programs
- assets (each row belongs to one program via `program_id`)
- collection runs
- snapshots
- detected changes

There is no `program_assets` join table in the MVP. HackerOne structured
scopes are per-program; `assets.program_id` is sufficient.

## Tables

### programs

Represents a bug-bounty program.

Conceptual fields:

    id                uuid PK default gen_random_uuid()
    platform          text NOT NULL DEFAULT 'hackerone'
    external_id       text NOT NULL  -- HackerOne handle, e.g. 'acme'
    external_id_lower text NOT NULL GENERATED ALWAYS AS (lower(external_id)) STORED
    external_numeric_id text NULL    -- HackerOne numeric id, debug only
    name              text NOT NULL
    url               text NULL      -- https://hackerone.com/{handle}
    last_seen_at      timestamptz NULL
    created_at        timestamptz NOT NULL DEFAULT now()
    updated_at        timestamptz NOT NULL DEFAULT now()

Constraints:

    UNIQUE (platform, external_id_lower)
    CHECK (platform = 'hackerone')  -- MVP single platform

The internal ID should be separate from the external platform ID.

Program `name` / `url` updates do NOT emit changes (see snapshot-algorithm.md).

### assets

Represents an asset _within a program scope_. Scoped to program
because the same identifier in two programs has different bounty semantics.

Conceptual fields:

    id                    uuid PK
    program_id            uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE
    external_id           text NULL  -- HackerOne structured-scope id
    identifier            text NOT NULL  -- display form
    normalized_identifier text NOT NULL  -- canonical key part
    type                  text NOT NULL  -- AssetType enum
    scope                 text NOT NULL  -- 'IN' | 'OUT'
    asset_key             text NOT NULL GENERATED ALWAYS AS (type || '|' || normalized_identifier) STORED
    created_at            timestamptz NOT NULL DEFAULT now()
    updated_at            timestamptz NOT NULL DEFAULT now()

Constraints:

    UNIQUE (program_id, asset_key)
    CHECK (scope IN ('IN','OUT'))
    CHECK (char_length(normalized_identifier) BETWEEN 1 AND 1024)

Do NOT use a global UNIQUE(identifier). The same domain appears in many programs.

`asset_key` is only `type || '|' || normalized_identifier`. Uniqueness is
`(program_id, asset_key)`. Never embed `program_id` in `asset_key`.

When a previously seen asset is missing from a later fetch of the **same**
program, set `scope='OUT'` (do not delete). See `docs/snapshot-algorithm.md` §5b.

### collection_runs

Represents one execution of the collector.

Conceptual fields:

    id              uuid PK
    started_at      timestamptz NOT NULL DEFAULT now()
    completed_at    timestamptz NULL
    status          text NOT NULL  -- 'running' | 'completed' | 'failed'
    programs_seen   int NOT NULL DEFAULT 0
    assets_seen     int NOT NULL DEFAULT 0
    programs_added  int NOT NULL DEFAULT 0
    assets_added    int NOT NULL DEFAULT 0
    assets_removed  int NOT NULL DEFAULT 0
    error_code      text NULL  -- e.g. AUTH_FAILED, RATE_LIMITED, NETWORK, DB
    error_message   text NULL  -- no secrets

Useful for tracking collection history.

Overlap guard: session-level `pg_try_advisory_lock` for the whole
fetch+persist (see snapshot-algorithm.md). Stale `running` rows older
than 2 hours are marked `failed` before a new run starts.

### program_snapshots

Pointer table, not a full copy (see snapshot-algorithm.md):

    collection_run_id uuid REFERENCES collection_runs(id) ON DELETE CASCADE
    program_id        uuid REFERENCES programs(id) ON DELETE CASCADE
    PRIMARY KEY (collection_run_id, program_id)

### asset_snapshots

Pointer table:

    collection_run_id uuid REFERENCES collection_runs(id) ON DELETE CASCADE
    program_id        uuid REFERENCES programs(id) ON DELETE CASCADE
    asset_id          uuid REFERENCES assets(id) ON DELETE CASCADE
    asset_key         text NOT NULL
    PRIMARY KEY (collection_run_id, program_id, asset_id)

Snapshots are used for comparison/audit. Live `programs`/`assets`
tables are the current state.

### changes

Represents detected changes.

Supported change types:

    PROGRAM_ADDED
    ASSET_ADDED
    ASSET_REMOVED

Conceptual fields:

    id                uuid PK
    type              text NOT NULL CHECK (type IN ('PROGRAM_ADDED','ASSET_ADDED','ASSET_REMOVED'))
    program_id        uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE
    asset_id          uuid NULL REFERENCES assets(id) ON DELETE SET NULL
    asset_key         text NULL
    asset_identifier  text NULL  -- display copy, survives asset delete
    collection_run_id uuid NOT NULL REFERENCES collection_runs(id) ON DELETE CASCADE
    detected_at       timestamptz NOT NULL DEFAULT now()

Postgres UNIQUE treats NULLs as distinct, so a unique on `asset_id` /
`asset_key` would **not** prevent duplicate `PROGRAM_ADDED` rows.
Use partial unique indexes (migration 001):

    CREATE UNIQUE INDEX changes_program_added_uq
      ON changes (collection_run_id, program_id)
      WHERE type = 'PROGRAM_ADDED';

    CREATE UNIQUE INDEX changes_asset_event_uq
      ON changes (collection_run_id, type, program_id, asset_key)
      WHERE type IN ('ASSET_ADDED', 'ASSET_REMOVED');

`PROGRAM_ADDED` rows have `asset_id = NULL` and `asset_key = NULL`.
`ASSET_*` rows MUST set all three: `asset_id`, `asset_key`, `asset_identifier`.

## First Snapshot

The first successful collection creates the baseline.

No change events are generated.

## Subsequent Snapshots

Each subsequent collection is compared against the previous state.

Example:

    Snapshot 1

    example.com
    api.example.com

    Snapshot 2

    example.com
    api.example.com
    admin.example.com

Result:

    ASSET_ADDED
    admin.example.com

## Idempotency

The same collection state must not produce duplicate changes.

Use unique constraints and deterministic comparison.

## Indexes

Add indexes for common lookup paths such as:

- program external ID
- asset identifier
- assets by program + scope
- collection run
- detected changes by program

Do not add indexes without a query/use-case reason.

MVP index list (create in migration 001):

    CREATE UNIQUE INDEX programs_platform_handle_uq ON programs(platform, external_id_lower);
    CREATE UNIQUE INDEX assets_program_key_uq ON assets(program_id, asset_key);
    CREATE INDEX assets_program_scope_idx ON assets(program_id, scope);
    CREATE INDEX changes_program_detected_idx ON changes(program_id, detected_at DESC);
    CREATE INDEX changes_run_idx ON changes(collection_run_id);
    CREATE INDEX snapshots_run_idx ON asset_snapshots(collection_run_id);
    CREATE UNIQUE INDEX changes_program_added_uq
      ON changes (collection_run_id, program_id)
      WHERE type = 'PROGRAM_ADDED';
    CREATE UNIQUE INDEX changes_asset_event_uq
      ON changes (collection_run_id, type, program_id, asset_key)
      WHERE type IN ('ASSET_ADDED', 'ASSET_REMOVED');
