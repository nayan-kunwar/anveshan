# Notification System Design

Email notifications for Anveshan: users subscribe to programs, get notified when scope changes are detected.

---

## Architecture

```
runCollection() completes (changes persisted, lock released)
        │
        ▼
enqueueImmediate(runId)          // own try/catch; never fails the collection
  loads changes ONCE, filters per user, inserts pending delivery rows
        │
        ▼
deliveryWorker (setInterval, every 30s; no-op if NOTIFICATIONS_ENABLED=false)
  if (draining) return                    // one drain at a time; no overlapping ticks
  catch-up: retry enqueue for recent completed runs + missed digest days
  stale sending → pending AND attempts = GREATEST(attempts-1, 0)
    (process crash only; mutex means in-flight SMTP is never reset)
  claim 50 rows (FOR UPDATE SKIP LOCKED)
  re-check user; reload changes (run id or digest window); re-filter
  render email → nodemailer (30s timeout) → sent / skipped / failed / retry
        │
        ▼
dailyTickCron (every minute, DIGEST_TICK_CRON)
  for each daily user whose personal close just passed:
    window = [close-24h, close), filter, insert pending delivery
    (digest_close_at pins the exact close instant)
  deliveryWorker sends
```

Key principle: **SMTP never runs inside the collection lock.** Enqueue is INSERT only and is safe to retry (`ON CONFLICT DO NOTHING`). Worker drains independently.

`pnpm collect` and the scheduler **only enqueue**. The delivery worker, digest cron, and catch-up run in the API process (`apps/api/src/index.ts`). CLI-only collection without the API leaves rows `pending` until the API starts. Production always runs the API.

Change-mail paths (`enqueueImmediate`, `enqueueDueDigests`, catch-up, delivery worker, digest tick) **no-op when `NOTIFICATIONS_ENABLED=false`**. Magic-link send uses `isAuthEmailEnabled()` only and is independent of that flag.

---

## Data model

### users

```sql
users
  id                UUID PK DEFAULT gen_random_uuid()
  email             TEXT NOT NULL UNIQUE
  email_verified_at TIMESTAMPTZ NULL       -- set on first successful magic-link verify
  created_at        TIMESTAMPTZ DEFAULT now()
  unsubscribed_at   TIMESTAMPTZ NULL       -- global opt-out; cleared on re-subscribe
```

### magic_link_tokens

```sql
magic_link_tokens
  id          UUID PK DEFAULT gen_random_uuid()
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  token_hash  TEXT NOT NULL UNIQUE         -- HMAC-SHA256(MAGIC_LINK_SECRET, raw)
  expires_at  TIMESTAMPTZ NOT NULL
  consumed_at TIMESTAMPTZ NULL             -- single-use; set on verify
  created_at  TIMESTAMPTZ DEFAULT now()

  INDEX (user_id, created_at)              -- for invalidation on re-issue
```

### sessions

```sql
sessions
  id          UUID PK DEFAULT gen_random_uuid()
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  token_hash  TEXT NOT NULL UNIQUE         -- HMAC-SHA256(SESSION_SECRET, raw)
  expires_at  TIMESTAMPTZ NOT NULL
  created_at  TIMESTAMPTZ DEFAULT now()

  INDEX (user_id)
```

### subscriptions

```sql
subscriptions
  user_id            UUID PK REFERENCES users(id) ON DELETE CASCADE
  frequency          TEXT NOT NULL CHECK (frequency IN ('immediate', 'daily'))
  watch_new_programs BOOLEAN NOT NULL DEFAULT false
  watch_all_programs BOOLEAN NOT NULL DEFAULT false
  digest_timezone    TEXT NOT NULL DEFAULT 'UTC'   -- IANA, validated on write
  digest_time_local  TIME NOT NULL DEFAULT '08:00' -- wall-clock HH:MM close
  updated_at         TIMESTAMPTZ DEFAULT now()
```

`digest_timezone` + `digest_time_local` are the user's daily close:
the digest covers [close-24h, close), where close is the latest instant
at or before now with that wall time in that zone (Intl math, no date
library). Defaults preserve the old global 08:00 UTC digest. DST-gap
days (wall time never occurs) yield the previous day's close — no digest
that day, no error.

### watches

```sql
watches
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE
  created_at TIMESTAMPTZ DEFAULT now()

  PRIMARY KEY (user_id, program_id)
```

### notification_deliveries

```sql
notification_deliveries
  id                UUID PK DEFAULT gen_random_uuid()
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  channel           TEXT NOT NULL DEFAULT 'email'
  kind              TEXT NOT NULL
  collection_run_id UUID REFERENCES collection_runs(id) ON DELETE CASCADE
  digest_on         DATE NULL
  digest_close_at   TIMESTAMPTZ NULL  -- exact close instant (new daily rows)
  status            TEXT NOT NULL DEFAULT 'pending'
  attempts          INTEGER NOT NULL DEFAULT 0
  next_attempt_at   TIMESTAMPTZ NULL
  last_error        TEXT NULL
  sent_at           TIMESTAMPTZ NULL
  created_at        TIMESTAMPTZ DEFAULT now()
  updated_at        TIMESTAMPTZ DEFAULT now()

  CHECK (channel IN ('email'))
  CHECK (kind IN ('immediate', 'daily'))
  CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped'))
  CHECK (
    (kind = 'immediate' AND collection_run_id IS NOT NULL AND digest_on IS NULL)
    OR
    (kind = 'daily' AND digest_on IS NOT NULL AND collection_run_id IS NULL)
  )

  -- Partial uniques (index inference, not ON CONSTRAINT)
  -- Daily uniqueness is on the exact close instant, not the calendar
  -- date: on a 23-hour DST day two closes can share one UTC date.
  -- NULL close_at rows (pre-per-user digests) never conflict.
  UNIQUE (user_id, collection_run_id, channel) WHERE kind = 'immediate'
  UNIQUE (user_id, digest_close_at, channel)  WHERE kind = 'daily'

  -- Worker query performance
  INDEX (status, next_attempt_at, created_at) WHERE status IN ('pending', 'sending')
  INDEX (user_id)
```

---

## Subscription semantics

### What each state means

| State                                                               | Mail                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| No `subscriptions` row                                              | Nothing (except magic-link email)                      |
| `subscriptions` exists, `watches` empty, `watch_all_programs=false` | Nothing until user adds programs or checks "watch all" |
| `watches` non-empty                                                 | Only those programs                                    |
| `watch_all_programs=true`                                           | All programs (ignores `watches` table)                 |
| `watch_new_programs=true`                                           | PROGRAM_ADDED events, independent of watches           |
| `unsubscribed_at` set                                               | Nothing (global opt-out)                               |

### Filter matrix

| `watch_all` | `watches` | `watch_new_programs` | Mail                              |
| ----------- | --------- | -------------------- | --------------------------------- |
| false       | empty     | false                | nothing                           |
| false       | empty     | true                 | PROGRAM_ADDED only                |
| false       | some ids  | false                | ASSET_* on those ids              |
| false       | some ids  | true                 | those ASSET_* + all PROGRAM_ADDED |
| true        | ignored   | false                | all ASSET_*, no PROGRAM_ADDED     |
| true        | ignored   | true                 | everything                        |

No subscriptions row or `unsubscribed_at` set → nothing.

The filter matrix is the source of truth. Combined flags (e.g. non-empty
watches + `watch_new_programs`) are defined there, not in the summary table.

Dashboard copy: **"Watch all programs" means all `ASSET_*` events.**
`PROGRAM_ADDED` requires the separate "Notify me of new programs" flag.
`watch_all_programs=true` does not imply `watch_new_programs`.

Frequency switch and catch-up (v1, best-effort — no `updated_at` vs window
filtering):

- Catch-up uses **who is eligible now**, not who was eligible when the
  window closed. A user who switches immediate → daily may still get a
  digest covering the previous 24h on the next tick/catch-up, and may
  already have received immediate mail for some of those runs.
- daily → immediate: an in-flight digest row for today may still send;
  later collections enqueue as immediate.
- New immediate subscribers may get a 24h catch-up backfill of recent
  runs (same as catch-up for missed enqueue). Acceptable for v1.

Do not promise "no digest that day" after a frequency switch.

---

## Auth flow

### Magic link

```
POST /api/v1/auth/request-magic-link  { email }
  1. Rate limit: per IP (5/15min) + per email (3/15min)
     → EMAIL_RATE_LIMITED (429) if over threshold
  2. requireMagicLinkSecrets()   -- MAGIC_LINK_SECRET + SESSION_SECRET
  3. Upsert user by lowercased email
  4. Invalidate unconsumed tokens for this user
  5. Hash raw token with HMAC-SHA256(MAGIC_LINK_SECRET)
  6. Insert magic_link_tokens (expires 15min)
   7. If isAuthEmailEnabled(): send magic-link email (mail timeout MAIL_SEND_TIMEOUT_MS)
      On timeout/error: log, do not throw to the client
      Else: skip SMTP (tests / AUTH_EMAIL_ENABLED=false)
  8. Always return 200 (no email oracle), even when mail is not sent

POST /api/v1/auth/verify  { token }
  1. requireMagicLinkSecrets()   -- MAGIC_LINK_SECRET + SESSION_SECRET
  2. Hash token, find unconsumed token where not expired
     → INVALID_TOKEN if missing/expired/consumed
  3. Set consumed_at = now()
  4. If email_verified_at IS NULL: set email_verified_at = now()
  5. INSERT a new sessions row:
       token_hash = HMAC-SHA256(SESSION_SECRET, raw)
       expires_at = now() + SESSION_EXPIRY
     Multiple sessions per user are allowed (one row per device/login).
     Do not upsert/replace other sessions.
  6. Set-Cookie: session={rawToken}; HttpOnly; SameSite=Lax; Path=/
     Secure when FRONTEND_URL is https (not merely NODE_ENV=production);
     Max-Age from SESSION_EXPIRY
  7. Return user

GET /api/v1/auth/me  (session cookie)
  requireSession → return user

POST /api/v1/auth/logout  (session cookie)
  Delete the session row that matches this cookie; leave other sessions.
  Clear cookie.
```

### requireSession

1. Missing `SESSION_SECRET` → `UNAUTHORIZED` (401).
2. Missing/invalid cookie → `UNAUTHORIZED`.
3. No matching `sessions` row → `UNAUTHORIZED`.
4. `expires_at <= now()` → delete that session row, clear cookie, `UNAUTHORIZED`.
   No expiry sweeper; expired rows are removed on read (or logout).

### Token storage

- Raw tokens never stored. Only HMAC-SHA256 hashes in the database.
- `MAGIC_LINK_SECRET` for magic link tokens.
- `SESSION_SECRET` for session tokens.
- `UNSUBSCRIBE_SECRET` for unsubscribe link tokens.
- All three optional at boot, fail-closed per endpoint:
  - `requireMagicLinkSecrets()` (MAGIC_LINK_SECRET + SESSION_SECRET):
    request-magic-link, verify
  - `requireSession`: SESSION_SECRET
  - `requireUnsubscribeSecret()` (UNSUBSCRIBE_SECRET only): unsubscribe
    A missing `SESSION_SECRET` must not break an unsubscribe link from an
    old email.

### Magic link invalidation

When issuing a new magic link, consume all unconsumed tokens for that user:

```sql
UPDATE magic_link_tokens
SET    consumed_at = now()
WHERE  user_id = $1 AND consumed_at IS NULL;
```

---

## Unsubscribe flow

### Signing

```ts
signUnsubscribe(userId: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`unsubscribe:${userId}`)
    .digest("hex");
}

verifyUnsubscribe(userId: string, token: string, secret: string): boolean {
  const expected = signUnsubscribe(userId, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  // timingSafeEqual throws if lengths differ — treat as invalid, never 500
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

No extra table. No expiry for v1 (rotating the secret invalidates outstanding links).

### Flow

```
Email contains: {FRONTEND_URL}/unsubscribe?user={userId}&token={hmac}
  ↓
GET /unsubscribe?user={userId}&token={hmac}    (Next.js only, confirm page)
  Shows "Unsubscribe from all notifications?" with POST button
  Mail scanners prefetch GET links; confirm page has no side effect
  ↓
POST /api/v1/unsubscribe  { userId, token }
  requireUnsubscribeSecret()   -- UNSUBSCRIBE_SECRET only
  verifyUnsubscribe → INVALID_TOKEN if false
  set users.unsubscribed_at = now()
```

### Re-subscribe

```
PUT /api/v1/subscriptions  { frequency, watch_new_programs, watch_all_programs }
  1. Upsert subscriptions row
  2. Clear users.unsubscribed_at = null
  User gets mail again after saving subscription in dashboard
```

---

## Notification flow

`NOTIFICATIONS_ENABLED=false` → scheduler, CLI, digest cron, catch-up, and
delivery worker skip enqueue/drain (no SMTP). Tests set this false.

### Enqueue (immediate)

```
runCollection() returns summary
  ↓ lock released
if (NOTIFICATIONS_ENABLED
    && summary.status === 'completed'
    && (programsAdded + assetsAdded + assetsRemoved) > 0)
{
  try enqueueImmediate(pool, summary.runId)
  catch: log error; do not change collection summary or exit code
         (catch-up will retry)
}

enqueueImmediate(pool, runId):
  1. Load changes ONCE:
     SELECT changes.*, programs.name
     FROM changes JOIN programs ON changes.program_id = programs.id
     WHERE changes.collection_run_id = runId
  2. Load eligible users:
     WHERE email_verified_at IS NOT NULL
     AND   unsubscribed_at IS NULL
     AND   frequency = 'immediate'
  3. For each user:
     - Apply filter matrix (watch_all, watches, watch_new_programs)
     - If no changes pass filters → skip
     - INSERT INTO notification_deliveries (pending)
       ON CONFLICT (user_id, collection_run_id, channel) WHERE kind = 'immediate'
       DO NOTHING
  4. Return fast
```

Scheduler hook uses its own `.catch`. An enqueue throw must never log
`"scheduled collection crashed"` — collection already committed.

`enqueueImmediate` is idempotent. Safe to call again for the same `runId`
(partial crash mid-insert, or catch-up).

### Enqueue (daily digest)

```
digestTickCron (every minute, node-cron timezone: 'UTC'):
  if (!NOTIFICATIONS_ENABLED) return
  enqueueDueDigests(pool, now)

enqueueDueDigests(pool, now):   -- shared with catch-up via enqueueCloseGroups
  for each eligible daily user:
    close = lastClose(now, digest_timezone, digest_time_local)
      (null on invalid prefs → warn + skip; prefs are validated on write)
    if close is within the last 65s:
      window = [close - 24h, close)
      load that window's changes ONCE per distinct close instant
        (recipients grouped by close; one changes query per group)
      per user: apply filter matrix; skip on zero matches
      INSERT INTO notification_deliveries (pending, digest_on = UTC date
        of close, digest_close_at = close)
        ON CONFLICT (user_id, digest_close_at, channel)
        WHERE kind = 'daily' DO NOTHING
  deliveryWorker sends
```

`digest_on` stays as the human-readable UTC date of the close; the
pinned `digest_close_at` is the identity. Send time re-derives the
window from the stored close (`digestWindowForDelivery`), so enqueue
and send agree by construction — including DST overlap days.
`NULL close_at` rows (enqueued before per-user digests) fall back to
the legacy `digest_on` 08:00 UTC window.

Digest window query uses `changes.detected_at`. Add
`INDEX changes_detected_at_idx ON changes (detected_at)` in the
notifications migration (existing indexes are `(program_id, detected_at)`
and `(collection_run_id)`).

### Catch-up

Closes the gap if the process dies after collection commit and before
enqueue, if a tick is missed, or if the API is down across a user's
close. Runs on API boot and at the start of every delivery-worker tick
(inside the drain mutex).
No-op when `NOTIFICATIONS_ENABLED=false`. Never takes the collection lock.

Eligibility is evaluated **now** (current `frequency`, watches, unsubscribe).
Catch-up is not a historical replay of who was subscribed at collection time.

```
catchUpImmediate(pool):
  -- Last 24h of successful runs that produced changes.
  -- Re-calling enqueueImmediate is idempotent (unique + DO NOTHING).
  -- Newly subscribed immediate users may receive a backfill of those
  -- recent runs; acceptable for v1.
  for each collection_runs row where
        status = 'completed'
    AND completed_at >= now() - interval '24 hours'
    AND (programs_added + assets_added + assets_removed) > 0:
      enqueueImmediate(pool, run.id)

catchUpDailyDigest(pool, now):
  -- Per user: enqueue the last two closes (covers missed ticks and
  -- >24h outages for that user's own schedule). Idempotent.
  for each eligible daily user:
    latest = lastClose(now, digest_timezone, digest_time_local)
    prev   = lastClose(latest - 1s, digest_timezone, digest_time_local)
    enqueue both via the shared grouped core (DO NOTHING on repeats)
```

Do not insert a delivery row for a run/day that filters to zero users.
Catch-up of such a run is a no-op (0 inserts), which is correct.

### Worker (claim + send)

One drain at a time. `setInterval` can fire while a previous tick is still
awaiting SMTP; overlapping drains plus stale recovery would double-send.

```
let draining = false

Every 30 seconds:
  if (!NOTIFICATIONS_ENABLED) return
  if (draining) return
  draining = true
  try:
    catchUpImmediate(); catchUpDailyDigest()
    stale recovery
    claim + send
  finally:
    draining = false

SMTP timeout defaults to 30s for change mail (same transport as magic-link;
override with MAIL_SEND_TIMEOUT_MS). A hung send must not last 10 minutes.

1. Stale recovery — **process crash only**. With the mutex, an in-flight
   send is never `sending` for 10 minutes in a live process.
   Claim incremented attempts before SMTP; a crash means that attempt
   never happened — decrement so 3 crashes cannot exhaust retries:

   UPDATE notification_deliveries
   SET    status = 'pending',
          attempts = GREATEST(attempts - 1, 0),
          next_attempt_at = now(),
          updated_at = now()
   WHERE  status = 'sending'
   AND    updated_at < now() - INTERVAL '10 minutes'

2. Claim (CTE):
   WITH claimed AS (
     SELECT id FROM notification_deliveries
     WHERE  status = 'pending'
     AND    attempts < 3
     AND    (next_attempt_at IS NULL OR next_attempt_at <= now())
     ORDER  BY created_at
     FOR UPDATE SKIP LOCKED
     LIMIT  50
   )
   UPDATE notification_deliveries d
   SET    status = 'sending',
          attempts = d.attempts + 1,
          next_attempt_at = NULL,
          updated_at = now()
   FROM   claimed
   WHERE  d.id = claimed.id
   RETURNING d.*

3. For each claimed delivery:
   a. Re-check email_verified_at + unsubscribed_at
      → if unverified or unsubscribed: SET status = 'skipped', updated_at = now()
   b. Reload the change set for this delivery, then re-apply the filter matrix:
       - kind = immediate: WHERE collection_run_id = delivery.collection_run_id
       - kind = daily:     window from the pinned digest_close_at
                           ([close − 24h, close); legacy NULL rows fall back
                           to the digest_on 08:00 UTC derivation)
         (same window as enqueue; join programs for names)
      → if no changes pass: SET status = 'skipped', updated_at = now()
   c. Render email → send via nodemailer (30s timeout)
      → success: SET status = 'sent', sent_at = now(), updated_at = now()
      → failure: SET status = 'pending',
                       next_attempt_at = now() + (attempts^2 * 60s),
                       last_error = '...', updated_at = now()
      → attempts >= 3: SET status = 'failed', updated_at = now()
```

`skipped` means "no mail by design" (unsubscribed, unverified, or empty
re-filter). Do not use `sent` for that — ops would think SMTP succeeded.

### Backoff schedule

| Attempt | Delay           | Cumulative |
| ------- | --------------- | ---------- |
| 1       | immediate       | 0s         |
| 2       | 60s (1^2 * 60)  | 60s        |
| 3       | 240s (2^2 * 60) | 5min       |
| fail    | —               | —          |

---

## Daily window

```
Per-user close from subscriptions (digest_timezone + digest_time_local):

  close        = lastClose(now, tz, HH:MM)   -- latest instant <= now
  window_start = close - 24 hours
  window_end   = close

Example: digest_time_local 13:30, digest_timezone Asia/Kolkata.
For a tick at 2026-09-18T09:00:00Z:
  close        = 2026-09-18 08:00:00 UTC  (13:30 IST)
  window_start = 2026-09-17 08:00:00 UTC

  changes.detected_at >= window_start
  AND changes.detected_at <  window_end
```

Double-send prevention: `UNIQUE (user_id, digest_close_at, channel)
WHERE kind = 'daily'`.

Missed closes (API down, slow tick): `catchUpDailyDigest` enqueues each
user's last two closes. Already-inserted rows hit `ON CONFLICT DO NOTHING`.

On a DST-overlap day a user whose close falls in the repeated hour gets
one digest per occurrence (distinct close instants, overlapping windows).
On a DST-gap day there is no close — no digest that day; the previous
day's digest was already delivered.

---

## Email content

### Immediate notification

```
Subject: [Anveshan] 3 changes in Google VRP

Hi,

3 changes detected in your watched programs:

Google VRP (3 changes)
  + ASSET_ADDED  api.google.com (URL)
  + ASSET_ADDED  *.google.com (WILDCARD)
  - ASSET_REMOVED  old.google.com (URL)

(Showing 3 of 3 changes)

---
Manage subscriptions: {FRONTEND_URL}/dashboard
Unsubscribe: {FRONTEND_URL}/unsubscribe?user={userId}&token={hmac}
```

### Daily digest

```
Subject: [Anveshan] Daily digest — 12 programs changed (47 assets)

Hi,

In the last 24 hours (Sep 17 08:00 → Sep 18 08:00 UTC):

Google VRP
  + 3 assets added, 1 removed

Apple Bug Bounty
  + 5 assets added

GitHub Security
  - 2 assets removed

... and 9 more programs

Manage subscriptions: {FRONTEND_URL}/dashboard
Unsubscribe: {FRONTEND_URL}/unsubscribe?user={userId}&token={hmac}
```

### Caps

- Max 20 programs per email. If >20: show top 20 + "and N more programs"
- Max 10 asset lines per program. If >10: show top 10 + "and N more assets"
- Never send 0-change mail (filtered before enqueue)

---

## Endpoints

| Method | Path                                       | Auth         | Description                                                       |
| ------ | ------------------------------------------ | ------------ | ----------------------------------------------------------------- |
| POST   | `/api/v1/auth/request-magic-link`          | none         | Send magic link (rate-limited per IP + email)                     |
| POST   | `/api/v1/auth/verify`                      | none         | Verify token → session cookie                                     |
| GET    | `/api/v1/auth/me`                          | session      | Current user                                                      |
| POST   | `/api/v1/auth/logout`                      | session      | Delete session + clear cookie                                     |
| GET    | `/api/v1/subscriptions`                    | session      | Get my subscription config                                        |
| PUT    | `/api/v1/subscriptions`                    | session      | Set frequency + watch flags + digest prefs; clear unsubscribed_at |
| GET    | `/api/v1/subscriptions/watches`            | session      | List my watched programs                                          |
| POST   | `/api/v1/subscriptions/watches`            | session      | Add program (404 if unknown)                                      |
| DELETE | `/api/v1/subscriptions/watches/:programId` | session      | Remove from watch list                                            |
| POST   | `/api/v1/unsubscribe`                      | signed token | Global unsubscribe                                                |

Public (no auth): `/health`, `/api/v1/programs*`

Next.js only (no API call): `GET /unsubscribe?user={userId}&token={hmac}` (confirm page).

---

## Error codes

| Code                 | Status | Used for                            |
| -------------------- | ------ | ----------------------------------- |
| `PROGRAM_NOT_FOUND`  | 404    | Unknown program UUID                |
| `BAD_REQUEST`        | 400    | Zod validation                      |
| `INTERNAL`           | 500    | Unexpected error                    |
| `COLLECTION_FAILED`  | 502    | HackerOne collection error          |
| `AUTH_FAILED`        | 502    | HackerOne credentials invalid       |
| `RATE_LIMITED`       | 502    | HackerOne API rate limit            |
| `NETWORK`            | 502    | Network error                       |
| `TIMEOUT`            | 504    | HackerOne API timeout               |
| `UNAUTHORIZED`       | 401    | Missing/invalid/expired session     |
| `INVALID_TOKEN`      | 401    | Bad magic link or unsubscribe token |
| `EMAIL_RATE_LIMITED` | 429    | Too many magic link requests        |

---

## Environment variables

```bash
# Mail provider: smtp | brevo (createMailer factory in packages/notifications)
MAIL_PROVIDER=smtp

# SMTP (used when MAIL_PROVIDER=smtp; Gmail is local-only — prefer Brevo in prod)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# Shared From for every provider (Brevo sender must be verified)
SMTP_FROM=noreply@anveshan.dev

# Brevo HTTP API (MAIL_PROVIDER=brevo)
BREVO_API_KEY=
BREVO_API_URL=https://api.brevo.com/v3
# Per-send budget (ms); default 30000
MAIL_SEND_TIMEOUT_MS=30000

# Auth secrets (optional at boot; fail-closed per endpoint, not as one bundle)
MAGIC_LINK_SECRET=<random-32-chars>
MAGIC_LINK_EXPIRY=900000           # 15 minutes
SESSION_SECRET=<random-32-chars>
SESSION_EXPIRY=2592000000           # 30 days
UNSUBSCRIBE_SECRET=<random-32-chars>

# Frontend
FRONTEND_URL=http://localhost:3001

# Notifications
NOTIFICATIONS_ENABLED=false         # false in tests, true in prod
AUTH_EMAIL_ENABLED=                 # auto-derived from provider creds when unset
DIGEST_TICK_CRON=* * * * *          # per-minute tick over personal digest closes
IMMEDIATE_EMAIL_CAP=20              # max programs per email
ASSET_EMAIL_CAP=10                  # max asset lines per program
```

---

## Cookie / CORS / rewrite

### Next.js rewrite

```js
// next.config.js
const API_URL = process.env.API_INTERNAL_URL || 'http://localhost:3000';

async rewrites() {
  return [
    { source: '/api/:path*', destination: `${API_URL}/api/:path*` }
  ];
}
```

Docker Compose: `API_INTERNAL_URL=http://api:3000` (service name).
Local dev: `http://localhost:3000`.

### Session cookie

```ts
const secure = new URL(FRONTEND_URL).protocol === "https:";
const parts = [
  `session=${token}`,
  "HttpOnly",
  "SameSite=Lax",
  "Path=/",
  `Max-Age=${SESSION_EXPIRY / 1000}`,
];
if (secure) parts.push("Secure");
res.setHeader("Set-Cookie", parts.join("; "));
```

No `Domain` attribute. `Secure` follows `FRONTEND_URL` (https), not
`NODE_ENV=production` — Docker can run `NODE_ENV=production` on HTTP
localhost, which would drop the cookie if gated on `NODE_ENV`.

---

## Rate limiting

In-memory Map (sufficient for single-process MVP; Redis for multi-process later).

| Scope     | Limit      | Window     |
| --------- | ---------- | ---------- |
| Per IP    | 5 requests | 15 minutes |
| Per email | 3 requests | 15 minutes |

---

## Secrets handling

| Secret               | Used for                | Storage      |
| -------------------- | ----------------------- | ------------ |
| `MAGIC_LINK_SECRET`  | HMAC magic link tokens  | Env var only |
| `SESSION_SECRET`     | HMAC session tokens     | Env var only |
| `UNSUBSCRIBE_SECRET` | HMAC unsubscribe tokens | Env var only |

All three optional at boot (like `HACKERONE_USERNAME`). Fail-closed per
endpoint, not as one bundle:

- `requireMagicLinkSecrets()`: MAGIC_LINK_SECRET + SESSION_SECRET
  (request-magic-link, verify)
- `requireSession`: SESSION_SECRET (invalid/missing/expired → `UNAUTHORIZED`)
- `requireUnsubscribeSecret()`: UNSUBSCRIBE_SECRET only (unsubscribe)

Raw tokens never stored. Only HMAC-SHA256 hashes in database.
`crypto.timingSafeEqual` after an equal-length check (mismatched length → `false`, not throw).

---

## Implementation order

1. Config (new env vars, `requireMagicLinkSecrets()`,
   `requireUnsubscribeSecret()`, `isAuthEmailEnabled()`)
2. Error codes (UNAUTHORIZED, INVALID_TOKEN, EMAIL_RATE_LIMITED)
3. HMAC token helpers (`apps/api/src/auth/tokens.ts`)
4. Database schema (6 tables + `changes(detected_at)` index + `skipped` status)
   → `pnpm db:generate` → `pnpm db:migrate`
5. Repository queries (user, session, token, subscription, watch, delivery)
6. Auth routes (request-magic-link, verify, me, logout) **including**
   the per-IP + per-email rate limiter on request-magic-link
   and mail-send timeout on magic-link send (MAIL_SEND_TIMEOUT_MS)
7. Session middleware (requireSession; SESSION_SECRET; reject expired)
8. Subscription + watch routes
9. Notifications package (SMTP transport, configurable send timeout,
    renderImmediate + renderDaily, pure)
10. Enqueue logic (immediate + daily, load changes once, idempotent)
11. Catch-up (`catchUpImmediate`, `catchUpDailyDigest`; eligibility now)
12. Delivery worker (drain mutex, claim CTE, stale recovery decrements
    attempts, reload changes + re-filter, `skipped` vs `sent`)
13. Digest tick (every minute; per-user closes; no-op if NOTIFICATIONS_ENABLED=false)
14. Hook into scheduler + CLI (post-collection enqueue in its own try/catch)
15. Start worker + digest cron + catch-up on API boot (`index.ts`)
16. Next.js frontend (login, dashboard, unsubscribe confirm)
17. Docker compose (API_INTERNAL_URL env, web service)
18. Tests

---

## Tests

| Test                                                                        | What it proves                         |
| --------------------------------------------------------------------------- | -------------------------------------- |
| Second `enqueueImmediate(runId)` inserts 0                                  | Idempotency                            |
| Empty watches + watch_all=false + watch_new=false → 0 rows                  | Filter matrix row 1                    |
| watch_all=true + watch_new=false → ASSET_* only                             | Filter matrix row 5                    |
| watch_all=true + watch_new=true → everything                                | Filter matrix row 6                    |
| Stale `sending` rows reset to `pending`                                     | Crash recovery                         |
| Stale `sending` with attempts=3 → pending attempts=2, claimed again         | Crash does not exhaust retries         |
| `enqueueDueDigests` twice for the same close → 1 row                        | Unique constraint                      |
| `lastClose` skips DST-gap wall times, resolves overlaps to latest ≤ now     | Close math                             |
| `nextClose` jumps a DST-gap day                                             | Close math                             |
| Tick enqueues only users whose close just passed; repeat tick inserts 0     | Per-user tick                          |
| Same UTC date, different close (23h DST day) → 2 rows                       | Close-instant identity                 |
| Same close under any date string → 1 row                                    | Close-instant identity                 |
| Worker sends from pinned `digest_close_at`; NULL falls back to legacy       | Enqueue/send agreement                 |
| `renderImmediate` caps at 20 programs, 10 assets                            | Caps                                   |
| `renderDaily` same caps                                                     | Caps                                   |
| `request-magic-link` → EMAIL_RATE_LIMITED after threshold                   | Rate limiting                          |
| Unknown programId on POST watches → PROGRAM_NOT_FOUND                       | 404                                    |
| No live SMTP in `pnpm test`                                                 | NOTIFICATIONS_ENABLED=false            |
| Collection tests unchanged                                                  | No regression                          |
| Unsubscribed at send time → status=`skipped`, no SMTP                       | Unsubscribe between enqueue and send   |
| Empty re-filter at send time → status=`skipped`                             | Watch removed between enqueue and send |
| `requireMagicLinkSecrets()` throws when secrets missing                     | Fail closed                            |
| Unsubscribe works with only `UNSUBSCRIBE_SECRET` set                        | Secrets not bundled                    |
| `verifyUnsubscribe` with wrong token → false                                | Token validation                       |
| `verifyUnsubscribe` with shorter token → false (no throw)                   | timingSafeEqual length guard           |
| Verify sets email_verified_at on first success                              | Enqueue eligibility                    |
| Verify sets `sessions.expires_at = now() + SESSION_EXPIRY`                  | Session TTL persisted                  |
| Second verify (new device) inserts a second session                         | Multi-session, no upsert               |
| Expired session → delete row, clear cookie, UNAUTHORIZED                    | requireSession expiry                  |
| NOTIFICATIONS_ENABLED=false skips enqueue/worker/digest                     | Test isolation                         |
| `signUnsubscribe` + `verifyUnsubscribe` round-trip                          | Signing works                          |
| Clear unsubscribed_at on PUT /subscriptions                                 | Re-subscribe                           |
| Catch-up re-calls enqueueImmediate for a completed run with 0 delivery rows | Missed enqueue                         |
| Catch-up of an already-enqueued run inserts 0                               | Catch-up idempotency                   |
| Catch-up enqueues the user's last closes when missing                       | Missed digest day                      |
| Enqueue throw is caught; collection summary stays completed                 | Isolation                              |
| Magic-link SMTP timeout still returns 200                                   | No email oracle                        |
| Overlapping worker tick while draining → second tick no-ops                 | Drain mutex, no double-send            |
| Change-mail SMTP uses configurable timeout (default 30s)                     | Hung send cannot hit stale recovery    |
| User switched to daily; catch-up may insert a digest for the last closes    | Catch-up uses current eligibility      |

---

## Files to create

| File                                        | Purpose                                                          |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `packages/notifications/src/index.ts`       | Public API                                                       |
| `packages/notifications/src/smtp.ts`        | nodemailer transport (configurable send timeout)             |
| `packages/notifications/src/brevo.ts`       | Brevo HTTP transport (fetch + configurable timeout)          |
| `packages/notifications/src/templates.ts`   | renderImmediate, renderDaily (pure)                              |
| `packages/notifications/src/digest-time.ts` | per-user close math: lastClose, nextClose (pure, Intl only)      |
| `apps/api/src/auth/routes.ts`               | request-magic-link, verify, me, logout                           |
| `apps/api/src/auth/middleware.ts`           | requireSession                                                   |
| `apps/api/src/auth/tokens.ts`               | HMAC helpers (magic link + unsubscribe)                          |
| `apps/api/src/auth/rate-limit.ts`           | Per-IP + per-email rate limiter                                  |
| `apps/api/src/subscriptions/routes.ts`      | Subscription + watch CRUD                                        |
| `apps/api/src/notifications/enqueue.ts`     | enqueueImmediate, enqueueDueDigests + catch-up, grouped by close |
| `apps/api/src/notifications/worker.ts`      | Drain mutex + claim + send + retry + stale recovery + skipped    |
| `apps/web/`                                 | Next.js (login, dashboard, unsubscribe confirm)                  |

## Files to modify

| File                                    | Change                                                                |
| --------------------------------------- | --------------------------------------------------------------------- |
| `packages/database/src/schema.ts`       | 6 new tables + `skipped` + `changes(detected_at)` index               |
| `packages/database/src/repositories.ts` | User/session/token/subscription/watch/delivery queries                |
| `packages/config/src/index.ts`          | New env vars                                                          |
| `apps/api/src/errors.ts`                | Add UNAUTHORIZED, INVALID_TOKEN, EMAIL_RATE_LIMITED                   |
| `apps/api/src/collection/scheduler.ts`  | After runCollection: enqueue in its own try/catch                     |
| `apps/api/src/collect.ts`               | After runCollection: enqueue in its own try/catch                     |
| `apps/api/src/index.ts`                 | Start worker + digest cron + catch-up on boot                         |
| `apps/api/src/app.ts`                   | Register auth + subscription routes                                   |
| `docs/openapi.yaml`                     | New paths (auth, subscriptions, watches, unsubscribe) and error codes |

## NOT touched

- `apps/api/src/collection/service.ts` — runCollection unchanged
- `packages/collector/` — no changes
- `packages/domain/` — no changes
- Collection tests — not blocked
