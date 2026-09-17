# Notification System Design

Email notifications for Anveshan: users subscribe to programs, get notified when scope changes are detected.

---

## Architecture

```
runCollection() completes (changes persisted, lock released)
        │
        ▼
enqueueImmediate(runId)
  loads changes ONCE, filters per user, inserts pending delivery rows
        │
        ▼
deliveryWorker (setInterval, every 30s; no-op if NOTIFICATIONS_ENABLED=false)
  claim 50 rows (FOR UPDATE SKIP LOCKED)
  re-check user; reload changes (run id or digest window); re-filter
  render email → nodemailer → sent/failed/retry
        │
        ▼
dailyDigestCron (08:00 UTC)
  for each daily user: query 24h window, filter, insert pending delivery
  deliveryWorker sends
```

Key principle: **SMTP never runs inside the collection lock.** Enqueue is fast (INSERT only). Worker drains independently.

Change-mail paths (`enqueueImmediate`, `enqueueDailyDigest`, delivery worker, digest cron) **no-op when `NOTIFICATIONS_ENABLED=false`**. Magic-link send uses `isAuthEmailEnabled()` only and is independent of that flag.

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
  updated_at         TIMESTAMPTZ DEFAULT now()
```

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
  status            TEXT NOT NULL DEFAULT 'pending'
  attempts          INTEGER NOT NULL DEFAULT 0
  next_attempt_at   TIMESTAMPTZ NULL
  last_error        TEXT NULL
  sent_at           TIMESTAMPTZ NULL
  created_at        TIMESTAMPTZ DEFAULT now()
  updated_at        TIMESTAMPTZ DEFAULT now()

  CHECK (channel IN ('email'))
  CHECK (kind IN ('immediate', 'daily'))
  CHECK (status IN ('pending', 'sending', 'sent', 'failed'))
  CHECK (
    (kind = 'immediate' AND collection_run_id IS NOT NULL AND digest_on IS NULL)
    OR
    (kind = 'daily' AND digest_on IS NOT NULL AND collection_run_id IS NULL)
  )

  -- Partial uniques (index inference, not ON CONSTRAINT)
  UNIQUE (user_id, collection_run_id, channel) WHERE kind = 'immediate'
  UNIQUE (user_id, digest_on, channel)         WHERE kind = 'daily'

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

---

## Auth flow

### Magic link

```
POST /api/v1/auth/request-magic-link  { email }
  1. Rate limit: per IP (5/15min) + per email (3/15min)
     → EMAIL_RATE_LIMITED (429) if over threshold
  2. requireAuthSecrets()
  3. Upsert user by lowercased email
  4. Invalidate unconsumed tokens for this user
  5. Hash raw token with HMAC-SHA256(MAGIC_LINK_SECRET)
  6. Insert magic_link_tokens (expires 15min)
  7. If isAuthEmailEnabled(): send magic-link email
     Else: skip SMTP (tests / AUTH_EMAIL_ENABLED=false)
  8. Always return 200 (no email oracle), even when mail is not sent

POST /api/v1/auth/verify  { token }
  1. requireAuthSecrets()
  2. Hash token, find unconsumed token where not expired
     → INVALID_TOKEN if missing/expired/consumed
  3. Set consumed_at = now()
  4. If email_verified_at IS NULL: set email_verified_at = now()
  5. INSERT a new sessions row (HMAC-SHA256(SESSION_SECRET, raw))
     Multiple sessions per user are allowed (one row per device/login).
     Do not upsert/replace other sessions.
  6. Set-Cookie: session={rawToken}; HttpOnly; SameSite=Lax; Path=/
     Secure only in production; Max-Age from SESSION_EXPIRY
  7. Return user

GET /api/v1/auth/me  (session cookie)
  requireSession (requires SESSION_SECRET) → return user

POST /api/v1/auth/logout  (session cookie)
  Delete the session row that matches this cookie; leave other sessions.
  Clear cookie.
```

### Token storage

- Raw tokens never stored. Only HMAC-SHA256 hashes in the database.
- `MAGIC_LINK_SECRET` for magic link tokens.
- `SESSION_SECRET` for session tokens.
- `UNSUBSCRIBE_SECRET` for unsubscribe link tokens.
- All three optional at boot, fail-closed via `requireAuthSecrets()`
  (magic-link, verify, unsubscribe) and `SESSION_SECRET` in `requireSession`.

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
  requireAuthSecrets() (UNSUBSCRIBE_SECRET)
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

`NOTIFICATIONS_ENABLED=false` → scheduler, CLI, digest cron, and delivery
worker skip enqueue/drain (no SMTP). Tests set this false.

### Enqueue (immediate)

```
runCollection() returns summary
  ↓ lock released
if (NOTIFICATIONS_ENABLED
    && summary.status === 'completed'
    && (programsAdded + assetsAdded + assetsRemoved) > 0)
{
  enqueueImmediate(pool, summary.runId)
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

### Enqueue (daily digest)

```
dailyDigestCron (08:00 UTC, node-cron timezone: 'UTC'):
  if (!NOTIFICATIONS_ENABLED) return
  digest_on = today's UTC date
  window_end   = digest_on 08:00:00 UTC
  window_start = window_end - 24 hours

  1. Load changes ONCE:
     SELECT changes.*, programs.name
     FROM changes JOIN programs ON changes.program_id = programs.id
     WHERE changes.detected_at >= window_start
     AND   changes.detected_at <  window_end
  2. Load eligible users:
     WHERE email_verified_at IS NOT NULL
     AND   unsubscribed_at IS NULL
     AND   frequency = 'daily'
  3. For each user:
     - Apply filter matrix
     - If no changes pass filters → skip
     - INSERT INTO notification_deliveries (pending)
       ON CONFLICT (user_id, digest_on, channel) WHERE kind = 'daily'
       DO NOTHING
  4. deliveryWorker sends
```

### Worker (claim + send)

```
Every 30 seconds:
  if (!NOTIFICATIONS_ENABLED) return

1. Stale recovery:
   UPDATE notification_deliveries
   SET    status = 'pending', next_attempt_at = now(), updated_at = now()
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
      → if unverified or unsubscribed: mark sent (no mail), skip
   b. Reload the change set for this delivery, then re-apply the filter matrix:
      - kind = immediate: WHERE collection_run_id = delivery.collection_run_id
      - kind = daily:     WHERE detected_at >= digest_on 08:00 UTC − 24h
                          AND   detected_at <  digest_on 08:00 UTC
        (same window as enqueueDailyDigest; join programs for names)
      → if no changes pass: mark sent (no mail), skip
   c. Render email → send via nodemailer
      → success: SET status = 'sent', sent_at = now(), updated_at = now()
      → failure: SET status = 'pending',
                       next_attempt_at = now() + (attempts^2 * 60s),
                       last_error = '...', updated_at = now()
      → attempts >= 3: SET status = 'failed', updated_at = now()
```

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
DAILY_DIGEST_CRON = "0 8 * * *"   (UTC)

For digest_on = 2026-09-18:
  window_end   = 2026-09-18 08:00:00 UTC
  window_start = 2026-09-17 08:00:00 UTC   (window_end - 24h)

  changes.detected_at >= window_start
  AND changes.detected_at <  window_end
```

Double-send prevention: `UNIQUE (user_id, digest_on, channel) WHERE kind = 'daily'`

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

| Method | Path                                       | Auth         | Description                                     |
| ------ | ------------------------------------------ | ------------ | ----------------------------------------------- |
| POST   | `/api/v1/auth/request-magic-link`          | none         | Send magic link (rate-limited per IP + email)   |
| POST   | `/api/v1/auth/verify`                      | none         | Verify token → session cookie                   |
| GET    | `/api/v1/auth/me`                          | session      | Current user                                    |
| POST   | `/api/v1/auth/logout`                      | session      | Delete session + clear cookie                   |
| GET    | `/api/v1/subscriptions`                    | session      | Get my subscription config                      |
| PUT    | `/api/v1/subscriptions`                    | session      | Set frequency + watch flags; clear unsubscribed_at |
| GET    | `/api/v1/subscriptions/watches`            | session      | List my watched programs                        |
| POST   | `/api/v1/subscriptions/watches`            | session      | Add program (404 if unknown)                    |
| DELETE | `/api/v1/subscriptions/watches/:programId` | session      | Remove from watch list                          |
| POST   | `/api/v1/unsubscribe`                      | signed token | Global unsubscribe                              |

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
| `UNAUTHORIZED`       | 401    | Missing/invalid session             |
| `INVALID_TOKEN`      | 401    | Bad magic link or unsubscribe token |
| `EMAIL_RATE_LIMITED` | 429    | Too many magic link requests        |

---

## Environment variables

```bash
# SMTP (Gmail is local-only; use Resend/Postmark/SES in production)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@anveshan.dev

# Auth secrets (optional at boot; fail-closed on magic-link, verify,
# unsubscribe, and requireSession)
MAGIC_LINK_SECRET=<random-32-chars>
MAGIC_LINK_EXPIRY=900000           # 15 minutes
SESSION_SECRET=<random-32-chars>
SESSION_EXPIRY=2592000000           # 30 days
UNSUBSCRIBE_SECRET=<random-32-chars>

# Frontend
FRONTEND_URL=http://localhost:3001

# Notifications
NOTIFICATIONS_ENABLED=false         # false in tests, true in prod
AUTH_EMAIL_ENABLED=                 # auto-derived when unset (true if SMTP_* set)
DAILY_DIGEST_CRON=0 8 * * *        # 8am UTC
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
const isProd = process.env.NODE_ENV === "production";
const parts = [
  `session=${token}`,
  "HttpOnly",
  "SameSite=Lax",
  "Path=/",
  `Max-Age=${SESSION_EXPIRY / 1000}`,
];
if (isProd) parts.push("Secure");
res.setHeader("Set-Cookie", parts.join("; "));
```

No `Domain` attribute. `Secure` gated on production (HTTP localhost breaks with Secure).

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

All three optional at boot (like `HACKERONE_USERNAME`).

- `requireAuthSecrets()`: request-magic-link, verify, unsubscribe
- `requireSession`: requires `SESSION_SECRET` (invalid/missing → `UNAUTHORIZED`)

Raw tokens never stored. Only HMAC-SHA256 hashes in database.
`crypto.timingSafeEqual` after an equal-length check (mismatched length → `false`, not throw).

---

## Implementation order

1. Config (new env vars, `requireAuthSecrets()`, `isAuthEmailEnabled()`)
2. Error codes (UNAUTHORIZED, INVALID_TOKEN, EMAIL_RATE_LIMITED)
3. HMAC token helpers (`apps/api/src/auth/tokens.ts`)
4. Database schema (6 tables) → `pnpm db:generate` → `pnpm db:migrate`
5. Repository queries (user, session, token, subscription, watch, delivery)
6. Auth routes (request-magic-link, verify, me, logout) **including**
   the per-IP + per-email rate limiter on request-magic-link
7. Session middleware (requireSession; requires SESSION_SECRET)
8. Subscription + watch routes
9. Notifications package (SMTP transport + renderImmediate + renderDaily, pure)
10. Enqueue logic (immediate + daily, load changes once)
11. Delivery worker (claim CTE, stale recovery, reload changes + re-filter)
12. Digest cron (timezone: UTC; no-op if NOTIFICATIONS_ENABLED=false)
13. Hook into scheduler + CLI (post-collection enqueue if NOTIFICATIONS_ENABLED)
14. Next.js frontend (login, dashboard, unsubscribe confirm)
15. Docker compose (API_INTERNAL_URL env, web service)
16. Tests

---

## Tests

| Test                                                       | What it proves                       |
| ---------------------------------------------------------- | ------------------------------------ |
| Second `enqueueImmediate(runId)` inserts 0                 | Idempotency                          |
| Empty watches + watch_all=false + watch_new=false → 0 rows | Filter matrix row 1                  |
| watch_all=true + watch_new=true → everything               | Filter matrix row 6                  |
| Stale `sending` rows reset to `pending`                    | Crash recovery                       |
| `enqueueDailyDigest` twice for same digest_on → 1 row      | Unique constraint                    |
| `renderImmediate` caps at 20 programs, 10 assets           | Caps                                 |
| `renderDaily` same caps                                    | Caps                                 |
| `request-magic-link` → EMAIL_RATE_LIMITED after threshold  | Rate limiting                        |
| Unknown programId on POST watches → PROGRAM_NOT_FOUND      | 404                                  |
| No live SMTP in `pnpm test`                                | NOTIFICATIONS_ENABLED=false          |
| Collection tests unchanged                                 | No regression                        |
| Verify re-checks unsubscribed_at at send time              | Unsubscribe between enqueue and send |
| `requireAuthSecrets()` throws when secrets missing         | Fail closed                          |
| `verifyUnsubscribe` with wrong token → false               | Token validation                     |
| `verifyUnsubscribe` with shorter token → false (no throw)  | timingSafeEqual length guard         |
| Verify sets email_verified_at on first success             | Enqueue eligibility                  |
| Second verify (new device) inserts a second session        | Multi-session, no upsert             |
| NOTIFICATIONS_ENABLED=false skips enqueue/worker/digest    | Test isolation                       |
| `signUnsubscribe` + `verifyUnsubscribe` round-trip         | Signing works                        |
| Clear unsubscribed_at on PUT /subscriptions                | Re-subscribe                         |

---

## Files to create

| File                                      | Purpose                                         |
| ----------------------------------------- | ----------------------------------------------- |
| `packages/notifications/src/index.ts`     | Public API                                      |
| `packages/notifications/src/smtp.ts`      | nodemailer transport                            |
| `packages/notifications/src/templates.ts` | renderImmediate, renderDaily (pure)             |
| `apps/api/src/auth/routes.ts`             | request-magic-link, verify, me, logout          |
| `apps/api/src/auth/middleware.ts`         | requireSession                                  |
| `apps/api/src/auth/tokens.ts`             | HMAC helpers (magic link + unsubscribe)         |
| `apps/api/src/auth/rate-limit.ts`         | Per-IP + per-email rate limiter                 |
| `apps/api/src/subscriptions/routes.ts`    | Subscription + watch CRUD                       |
| `apps/api/src/notifications/enqueue.ts`   | enqueueImmediate, enqueueDailyDigest            |
| `apps/api/src/notifications/worker.ts`    | Claim + send + retry + stale recovery           |
| `apps/web/`                               | Next.js (login, dashboard, unsubscribe confirm) |

## Files to modify

| File                                    | Change                                                 |
| --------------------------------------- | ------------------------------------------------------ |
| `packages/database/src/schema.ts`       | 6 new tables                                           |
| `packages/database/src/repositories.ts` | User/session/token/subscription/watch/delivery queries |
| `packages/config/src/index.ts`          | New env vars                                           |
| `apps/api/src/errors.ts`                | Add UNAUTHORIZED, INVALID_TOKEN, EMAIL_RATE_LIMITED    |
| `apps/api/src/collection/scheduler.ts`  | After runCollection: enqueueImmediate if NOTIFICATIONS_ENABLED |
| `apps/api/src/collect.ts`               | After runCollection: enqueueImmediate if NOTIFICATIONS_ENABLED |
| `apps/api/src/index.ts`                 | Start delivery worker + digest cron (no-op if flag off)        |
| `apps/api/src/app.ts`                   | Register auth + subscription routes                    |
| `docs/openapi.yaml`                     | New paths (auth, subscriptions, watches, unsubscribe) and error codes |

## NOT touched

- `apps/api/src/collection/service.ts` — runCollection unchanged
- `packages/collector/` — no changes
- `packages/domain/` — no changes
- Collection tests — not blocked
