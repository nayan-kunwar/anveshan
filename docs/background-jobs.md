# Background Jobs

Three background jobs run inside the API process (`apps/api/src/index.ts`).
This page explains what each does, how they chain, and how to configure,
stop, or change them. Design details live in `notification-design.md`
(full spec) and `daily-digest.md` (digest semantics); ops tables in
`deploy.md`.

## 1. The three jobs

### Collection scheduler — "fetch what's new"

- **Entry:** `startScheduler()` in `apps/api/src/collection/scheduler.ts`
- **Cadence:** `COLLECTION_CRON`, default `*/30 * * * *`, timezone
  `COLLECTION_TZ` (default `UTC`)
- **Does:** calls the same `runCollection()` as `pnpm collect` — fetches
  programs + scopes from the real HackerOne API, diffs against Postgres,
  persists programs/assets/changes, then enqueues **immediate** outbox
  rows for users watching the changed programs.
- **On/off:** `COLLECTION_ENABLED` (default `true`; `false` in tests)
  — env is the **kill switch**; runtime state comes from
  `scheduler_settings` (see §4)
- **Safety:** session `pg_try_advisory_lock` for the whole run — a second
  tick fires while a run is active, it skips with a warn. Stale `running`
  rows (>2h) are marked `failed` before a new run starts.
- Invalid `COLLECTION_CRON` throws at boot (fail fast, no silent drift).
- **Runtime control:** start/stop/reschedule without a restart via the
  admin API (`/api/v1/admin/scheduler`, see §4).

### Digest cron — "someone's digest time arrived"

- **Entry:** `startDigestCron()` in `apps/api/src/notifications/worker.ts`
- **Cadence:** `DIGEST_TICK_CRON`, default `* * * * *` (per-minute tick,
  timezone fixed `UTC`)
- **Does:** for every user with **daily** frequency, checks whether their
  personal close (`subscriptions.digest_timezone` + `digest_time_local`,
  default `UTC 08:00`) just passed. If yes, it enqueues a `daily` outbox
  row for the `[close − 24h, close)` window. **It never sends mail** —
  see `daily-digest.md` for the precise algorithm.
- **On/off:** `NOTIFICATIONS_ENABLED` (default `false`; set `true` in
  prod). When off it logs `digest cron disabled` and returns no handle.
- The tick cadence only affects _when the check runs_: with a coarser
  cron (e.g. `*/5`) a digest can enqueue up to 5 minutes later. The
  send **time** itself is the per-user close, not this cron.
- Invalid `DIGEST_TICK_CRON` throws at boot.

### Delivery worker — "send whatever is queued"

- **Entry:** `startDeliveryInterval()` in `apps/api/src/notifications/worker.ts`
- **Cadence:** every **30s**, hardcoded (`intervalMs` is injectable for
  tests only — there is no env var for it)
- **Does:** drains the `notification_deliveries` outbox: catch-up
  (backfills each daily user's last two closes + missed immediate runs)
  → resets rows stuck in `sending` >10min → claims ≤50 rows → re-checks
  unsubscribe/watch state at send time → renders + sends via SMTP/Brevo
  → marks `sent` / `skipped` / `retry` (3 attempts) / `failed`.
  The first drain runs immediately at boot.
- **On/off:** `NOTIFICATIONS_ENABLED` (default `false`). When off it
  logs `delivery worker disabled` and returns no handle.
- One drain at a time; overlaps are skipped, never double-sent.

## 2. How they chain

```
Collection scheduler (COLLECTION_CRON)      Digest cron (DIGEST_TICK_CRON)
  fetch HackerOne → diff → persist           per-user close passed?
  → enqueue immediate rows                          │
                    │                               │
                    ▼                               ▼
        notification_deliveries  (Postgres outbox)
                    │
                    ▼
        Delivery worker (every 30s)
          catch-up → claim → SMTP → sent/skipped/failed
```

All three communicate only through the outbox table — the scheduler and
digest cron never touch SMTP themselves.

## 3. Configuration reference

| What                     | Variable / setting                                                                  | Default               | Notes                                                      |
| ------------------------ | ----------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------- |
| Scheduler master switch  | `COLLECTION_ENABLED`                                                                | `true`                | Kill switch: boot off + admin PUT/DELETE rejected (409)    |
| Scheduler cadence/time   | `COLLECTION_CRON`, `COLLECTION_TZ`                                                  | `*/30 * * * *`, `UTC` | Env default; overridden by `scheduler_settings` when set   |
| Scheduler runtime state  | `scheduler_settings` row (admin API)                                                | none                  | Row absent = env-driven; see §4                            |
| Digest + delivery on/off | `NOTIFICATIONS_ENABLED`                                                             | `false`               | Gates **both** jobs; must be `true` in prod                |
| Digest tick cadence      | `DIGEST_TICK_CRON`                                                                  | `* * * * *`           | Check frequency, not send time                             |
| Delivery cadence         | (none)                                                                              | 30s                   | Hardcoded; no env var                                      |
| Per-user digest time     | Settings UI or `PUT /api/v1/subscription` with `digestTimezone` + `digestTimeLocal` | `UTC` `08:00`         | Stored in `subscriptions`; validated (IANA zone + `HH:MM`) |

Env values are read **once at boot** (`loadConfig()` in
`packages/config/src/index.ts`). Changing any of them requires an API
restart to take effect — except the collection scheduler, which the
admin API can reconfigure live (§4).

## 4. Controlling the collection scheduler (admin API)

The scheduler is the one job with runtime control. Same gate as the
other admin endpoints: header `X-Admin-Key` must match `ADMIN_API_KEY`
(fail-closed 401 when unset).

| Endpoint                         | Effect                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/scheduler`    | Status: `{ enabled, source, cron, timezone, running, lastRun }`                                         |
| `PUT /api/v1/admin/scheduler`    | Start/stop/reschedule. Body (≥1 field): `{ enabled?, cron?, timezone? }`. Persists **and applies now**. |
| `DELETE /api/v1/admin/scheduler` | Reset: delete the row, immediately back to `COLLECTION_*` env config.                                   |

Rules:

- **Precedence:** a `scheduler_settings` row overrides the `COLLECTION_*`
  env values until DELETEd; no row = environment-driven (the default —
  nothing changes for a fresh deploy).
- **No restart needed:** PUT stops the live cron task and starts the new
  one in-process. A 60s reconcile tick also picks up external row edits
  (second instance, hand SQL), so state converges on its own.
- **Kill switch:** while `COLLECTION_ENABLED=false`, boot starts nothing
  and PUT/DELETE return `409 SCHEDULER_DISABLED` (GET still works and
  reports `enabled: false`).
- **Validation:** cron must be a valid **5-field** (minute-first)
  expression — node-cron-style 6-field seconds expressions are rejected
  with `400 BAD_REQUEST`; timezone must be a real IANA zone.
- **Persisted:** changes survive restarts (unlike in-memory-only
  control). Each API instance applies the row via boot + reconcile, so
  multiple instances converge.
- `running`/`lastRun` read `collection_runs`, so they reflect manual
  triggers and other instances too.

```bash
# Stop the scheduler
curl -X DELETE -H "X-Admin-Key: $ADMIN_API_KEY" \
  https://<api-host>/api/v1/admin/scheduler

# Every 5 minutes in IST
curl -X PUT -H "X-Admin-Key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "cron": "*/5 * * * *", "timezone": "Asia/Kolkata"}' \
  https://<api-host>/api/v1/admin/scheduler

# Back to environment config
curl -X DELETE -H "X-Admin-Key: $ADMIN_API_KEY" \
  https://<api-host>/api/v1/admin/scheduler
```

## 5. Turning the other jobs on/off

The digest cron and delivery worker are still **env + restart only**:

- Stop both mail jobs: `NOTIFICATIONS_ENABLED=false`, restart (queued
  rows stay `pending` and drain on their own once it is re-enabled).
- Change the digest tick: edit `DIGEST_TICK_CRON`, restart.
- Stop everything background while keeping the API up:
  `COLLECTION_ENABLED=false NOTIFICATIONS_ENABLED=false pnpm dev`
  (useful before running DB tests).
- The scheduler can also still be controlled by env
  (`COLLECTION_ENABLED=false`, edit `COLLECTION_CRON`, restart) — but
  prefer the admin API in §4 when the API is running.

On Render: edit the env dashboard → redeploy/restart. Locally: edit
`.env` → restart `pnpm dev`.

## 6. Shutdown order

On `SIGINT`/`SIGTERM`, `apps/api/src/index.ts` shuts down in a fixed
order so workers never use a closed pool (the old race logged
`delivery drain crashed` with `Cannot use a pool after calling end on
the pool`):

1. Re-entrancy guard — a second signal is ignored.
2. **Stop all three jobs in parallel** — each `StopHandle.stop()` (from
   `apps/api/src/stoppable.ts`) stops scheduling, then awaits in-flight
   work bounded by `STOP_TIMEOUT_MS` (5s), so shutdown can never hang.
3. `server.close()` — stop accepting HTTP, let in-flight requests finish.
4. `closePool()` — only now is the pool closed.
5. `process.exit(0)`.

An unref'd 10s timer force-exits with code 1 if any step hangs.

Notes:

- A collection run still in flight after the 5s bound is abandoned — its
  session advisory lock dies with the connection, and the next boot
  fails any `running` row older than 2h. That is by design: collections
  routinely exceed 5s, and Postgres makes them crash-safe, not
  hung-safe.
- A drain interrupted mid-query can still log `delivery drain crashed`
  once per deploy/hibernation (query aborted, pool already closing);
  `pending` rows drain on their own after restart — see
  `daily-digest.md` §5.

## 7. Where the jobs run

- All three run **only in the API process** (`pnpm dev`, `pnpm start`,
  Render). The web frontend runs none of them.
- `pnpm collect` runs one collection via the same `runCollection()` but
  **no delivery worker** — without the API running, enqueued rows stay
  `pending` until the API starts (its boot drain catches up).
- Tests set `COLLECTION_ENABLED=false` and `NOTIFICATIONS_ENABLED=false`
  so no cron fires and no SMTP is attempted.

## 8. Troubleshooting pointers

| Symptom                                             | Where to look                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| `delivery drain crashed` / `digest enqueue crashed` | `daily-digest.md` §5 — usually `ECONNREFUSED` (Postgres down), not a code bug |
| No change mail on Render                            | `deploy.md` troubleshooting — `NOTIFICATIONS_ENABLED` unset/false             |
| Overlapping / skipped collections                   | `snapshot-algorithm.md` §6 — advisory lock skips concurrent runs by design    |
| Digest arrived late                                 | `daily-digest.md` §3 — catch-up after outage; content still covers the window |
| Jobs running during tests                           | `development.md` — test env forces both enable flags `false`                  |
| Scheduler won't start/stop via admin API            | §4 — missing/invalid `X-Admin-Key` (401) or `COLLECTION_ENABLED=false` (409)  |
