# Snapshot + Diff Algorithm (MVP, HackerOne)

This document closes identity, canonicalization, scope filtering, type-change
rule, fetch-vs-persist order, live-row reconciliation, locking, and
idempotency.

## 1. Model choice: live tables ARE current state

Do NOT maintain two parallel worlds (live tables + full snapshot copies).
That doubles writes and drifts.

MVP rule:

- `programs` and `assets` hold the **current** state (`assets.program_id`
  owns the relationship; there is no `program_assets` table).
- `collection_runs` + `changes` hold history.
- `program_snapshots` / `asset_snapshots` are **lightweight pointers**,
  not full copies:

  `program_snapshots(collection_run_id, program_id)`
  `asset_snapshots(collection_run_id, program_id, asset_id, asset_key)`

  They record "what was seen in this run" so a rerun or audit can
  reconstruct the comparison without re-fetching HackerOne.

- Diff compares **incoming normalized HackerOne state** vs **previous
  live rows loaded before any upsert**. Domain `diff()` is pure: it
  receives two sets, not a database connection.

## 2. Asset diff key (canonical)

One definition everywhere (DB generated column, unique constraint,
domain sets):

    asset_key = normalized_type + "|" + normalized_identifier

Uniqueness is `(program_id, asset_key)`. Do **not** embed `program_id`
inside `asset_key`. Domain diffs are per-program sets of `asset_key`.

Where:

- `program_id` = internal FK to `programs.id` (HackerOne `handle`,
  `platform='hackerone'`).
- `normalized_type` = internal `AssetType` after mapping (see `collector.md`).
- `normalized_identifier` = `canonicalize(identifier, type)`.

A type change (`DOMAIN` -> `WILDCARD` on the same string) is
`ASSET_REMOVED(old key)` + `ASSET_ADDED(new key)`.
Rationale: type affects exploitability/scope semantics; conflating them
hides changes. Metadata-only changes (bounty text, severity, description,
instruction, timestamps) do NOT affect the key and are ignored.

## 3. Canonicalization

Apply in collector normalizer BEFORE diff. Pure function, unit-tested.

    function canonicalize(raw: string, type: AssetType): string

Rules:

1. Trim whitespace. If empty after trim → drop asset, log `warn`.
2. `DOMAIN`, `WILDCARD`, `URL`:
   - lowercase
   - strip trailing `.` (FQDN root)
   - `WILDCARD`: keep `*.example.com` after lowercasing.
     `example.com` and `*.example.com` are DIFFERENT keys.
   - `URL`: lowercase scheme+host, remove default ports
     (`:443` for https, `:80` for http), remove trailing `/`
     (except root `/`), do NOT strip path/query.
     `https://Example.COM:443/a/` → `https://example.com/a`.
     Scheme-less scopes (`network.helium.com`) — and dotted
     pseudo-schemes (`Example.COM:8443/…`, which no real scheme uses) —
     retry with an assumed `https://` prefix, like browsers. Genuine
     non-http schemes (`ftp://x`, `mailto:y`) still drop instead of
     stacking into garbage like `https://ftp//x`.
3. `IP` / `CIDR`:
   - trim, lowercase (IPv6), validate with Zod; invalid → drop + `warn`.
   - Do not expand CIDR ranges. `/24` and a single IP are different keys.
4. `ANDROID` / `IOS` / `API` / `OTHER`:
   - trim, collapse internal whitespace to a single space.
   - Do not apply URL canonicalization to `OTHER` in MVP.

Max identifier length: 1024 chars. Longer → drop + `warn`.

## 4. Scope filtering

- Normalizer sets `scope = eligible_for_bounty ? "IN" : "OUT"`.
- Persister upserts ALL scopes (IN + OUT) into `assets` for audit.
- Differ ONLY considers `IN` sets:

  prev_in = { asset_key | previous live assets for this program, scope='IN' }
  curr_in = { asset_key | incoming for this program, scope=='IN' }

  added = curr_in - prev_in → `ASSET_ADDED`
  removed = prev_in - curr_in → `ASSET_REMOVED`

- OUT → IN = `ASSET_ADDED`. IN → OUT = `ASSET_REMOVED`.
- VDP / no-bounty programs (`eligible_for_bounty=false` on all scopes)
  persist as OUT and emit no `ASSET_*` events. `PROGRAM_ADDED` still
  applies. See `docs/collector.md`.

## 5. Program rules

- Program key: `(platform, externalId)` where
  `platform='hackerone'`, `externalId=handle.lowercase()`.
- New key seen in a non-first run → `PROGRAM_ADDED`.
- Program disappearing from API → ignore (no `PROGRAM_REMOVED`).
  Keep the program row and its assets; update `last_seen_at` only for
  programs present in this fetch. Do NOT delete. Do NOT reconcile
  that program's assets (would fake a teardown).
- Program `name` / `url` changes → update row, NO change event.

## 5b. Live asset reconciliation (seen programs only)

For each program **present in this fetch**, the live `assets` table must
match HackerOne after commit (so `GET /programs/:id/assets` is truthful).

- Upsert every incoming scope (IN and OUT).
- Incoming keys not previously in DB: insert.
- DB keys for that program **not** in the incoming payload:
  - if previous `scope='IN'` → include in `removed` (non-first run)
  - set live row `scope='OUT'` (do not delete; keeps `asset_id` for
    `changes` and avoids reaping display history)
- Do **not** mark-missing assets on programs absent from this fetch.

## 6. Collection run (pseudocode)

HTTP stays **outside** the persist transaction. Collection Service lives
in `apps/api` and is the only orchestrator (`node-cron` and `pnpm collect`).

    lock = pg_try_advisory_lock(hashtext('anveshan_collect'))  -- session lock
    if !lock:
      log warn "collection already running"; return skipped

    // Recover crashed runs so cron is not wedged forever.
    UPDATE collection_runs
      SET status='failed', error_code='COLLECTION_FAILED',
          error_message='stale running row', completed_at=now()
      WHERE status='running'
        AND started_at < now() - interval '2 hours'

    run = insert collection_runs { status='running' }
    try:
      // --- fetch (minutes; rate-limited) ---
      h1_programs = collector.getPrograms()           // no nested assets
      incoming = []
      for each h1_program:
        assets = collector.getProgramAssets(handle)   // paginated + id cursor
        incoming.push({ program: h1_program, assets })

      is_first =
        (select count(*) from collection_runs where status='completed') == 0
        OR (select count(*) from programs) == 0
      // Fail-closed failed runs leave no rows, so completed==0 is enough
      // on the happy path. OR programs==0 re-baselines if collection_runs
      // still has completed rows but programs was wiped.

      // --- persist (seconds) ---
      BEGIN
        prev_programs = select platform, external_id_lower, id from programs
        prev_assets   = select program_id, asset_key, scope, id, identifier
                          from assets

        for each { program, assets } in incoming:
          upsert programs on (platform, external_id_lower)
            set name, url, last_seen_at=now()
          insert program_snapshots(run.id, program.id)

          upsert assets on (program_id, asset_key)
          for keys in prev_assets[program] not in incoming keys:
            update assets set scope='OUT'

          insert asset_snapshots for each incoming asset

        if !is_first:
          domain.diff(prev, incoming) → insert changes
            PROGRAM_ADDED for new program keys
            ASSET_ADDED / ASSET_REMOVED per IN-set key
            (unique partial indexes, §7)

        // programs missing from API: no deletes, no asset reconcile
        update run { status='completed', stats }
      COMMIT
    catch:
      ROLLBACK persist work
      update run { status='failed', error_code, error_message }
      throw
    finally:
      pg_advisory_unlock(hashtext('anveshan_collect'))

- Overlap: session advisory lock for the **whole** fetch+persist. If the
  lock is held, skip + `warn`. Do **not** use `pg_advisory_xact_lock` for
  this (the lock would only last one transaction, and fetch is not in that
  transaction).
- Stale `running` rows older than 2 hours (`COLLECTION_STALE_RUNNING_MS`,
  default `7200000`) are marked `failed` before a new run starts.
- Partial fetch failure (one program's scopes 500): fail the whole run,
  persist **no** live upserts/changes for that run (only the `failed`
  `collection_runs` row). Prevents false `ASSET_REMOVED` storms.

## 7. Idempotency / duplicate prevention

DB constraints (see `database.md`):

- `programs(platform, external_id_lower)` unique.
- `assets(program_id, asset_key)` unique where
  `asset_key = type + '|' + normalized_identifier`.
- Partial unique indexes on `changes` (NULL-safe; see `database.md`).
- Re-running identical HackerOne state:
  `added = ∅, removed = ∅` → zero inserts → zero changes.
- Crash after commit → next run diffs against already-updated live
  state → ∅. Crash before commit → rollback → no duplicate rows.

## 8. Worked example

Prev DB IN-set for `acme`:

    DOMAIN|example.com
    URL|https://api.example.com
    DOMAIN|old.example.com

HackerOne now returns (after canonicalize):

    DOMAIN|example.com
    URL|https://api.example.com
    DOMAIN|new.example.com   (added)
    // old.example.com missing → removed + live row set scope=OUT
    // description of example.com changed → ignored (same key)

Changes:

    ASSET_ADDED new.example.com
    ASSET_REMOVED old.example.com

`GET /programs/:id/assets?scope=IN` no longer returns `old.example.com`.
`?scope=ALL` may still show it as `OUT`.

`changes` rows store `asset_identifier` (display) + `asset_key`
(stable) + `asset_id` FK.
