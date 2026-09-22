# How the Daily Digest Works

One idea explains everything: **your digest time is not an alarm clock —
it is the moment a 24-hour window closes.** Each digest covers
`[close − 24h, close)`. The mail may arrive a minute after the close, or
hours late after an outage — but its content is always that window.

Related: `notification-design.md` (full spec), `notifications.md`
(who gets mail), `er-diagram.md` (tables).

## 1. Your close, in plain terms

Settings holds a time plus a timezone, e.g. **02:12 + Asia/Kolkata**.
The close is the latest instant at or before now with that wall time in
that zone — here, **20:42 UTC**. The digest then covers the 24 hours
before it. Defaults are `08:00` + `UTC`, preserving the original
global digest for anyone who never configures it.

- Timezone aliases are identical: `Asia/Calcutta` and `Asia/Kolkata`
  are the same instants, same emails. Pick whichever you find.
- DST-gap days (a wall time that never occurs, e.g. 02:30 on the US
  spring-forward Sunday) simply have no close — no digest that day, no
  error. DST-overlap days may produce one digest per occurrence.
- The Settings preview ("Next digest: …") shows the coming close
  rendered in your local time.

## 2. The machinery (precise)

```
per-minute tick (DIGEST_TICK_CRON, default `* * * * *`)
  for each daily user whose close just passed (within 65s):
    window = [close − 24h, close)
    load that window's changes ONCE per distinct close instant
      (recipients sharing a close are grouped: one query per group)
    per user: apply the watch filter matrix; skip on zero matches
    INSERT INTO notification_deliveries
      (pending, digest_on = UTC date of close,
       digest_close_at = exact close instant)
      ON CONFLICT (user_id, digest_close_at) DO NOTHING
        │
        ▼
delivery worker (every 30s)
  catch-up → stale recovery → claim (≤50) → send via SMTP (30s timeout)
  → sent / skipped / failed (3 attempts, quadratic backoff)
```

Notes that matter:

- **Uniqueness is on the exact close instant**, not the calendar date:
  on a 23-hour DST day two closes can share one UTC date and both
  still deliver.
- **Send re-derives the window from the stored close**, so enqueue
  and send agree by construction — including DST transitions.
- **Never an empty mail**: zero matching changes means zero rows, and
  the day passes silently. Silence usually means "nothing happened."
- **Caps**: 20 programs and 10 asset lines per program per email,
  then "and N more" overflow notes.
- Everything before sending re-checks: unverified or unsubscribed
  users, removed watches, and emptied filters become `skipped`, never
  `sent`. `skipped` means "no mail by design."

## 3. Catch-up: late mail, not lost mail

The worker also runs catch-up on boot and every drain: each daily
user's **last two closes** are enqueued if missing (idempotent —
repeats hit `ON CONFLICT DO NOTHING`). Consequences:

- **Outage during your close** (API or Postgres down): the digest is
  enqueued on recovery and arrives late. Its content still covers the
  original window — check the mail's "last 24 hours (… → …)" line.
- **Missed tick** (slow event loop, restart): same path, same result.
- Nothing is ever re-sent: sent rows are never reclaimed.

## 4. Why mail can surprise you

| Surprise                           | Cause (all by design)                                                                                |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Mail arrived hours "late"          | Outage at close time; catch-up delivered it on recovery                                              |
| Same changes in two digests        | You moved the close; trailing-24h windows overlap                                                    |
| Burst after quiet weeks            | Restored visibility (e.g. newly kept URL scopes), not an attack                                      |
| No mail for days                   | Empty windows — collections with zero matching changes                                               |
| Mail right after switching cadence | 24h immediate backfill on switching to immediate; in-flight digest rows still send on switching away |

## 5. Debugging a missing digest

1. Settings saved with `daily`? (`GET /api/v1/subscriptions`)
2. Did any run produce matching changes inside your window?
   ```sql
   SELECT type, count(*) FROM changes
   WHERE detected_at >= <close - 24h> AND detected_at < <close>
   GROUP BY 1;
   ```
3. Outbox state for your user (`notification_deliveries`):
   `sent` (check inbox/spam), `pending` (worker/API/DB down or
   `NOTIFICATIONS_ENABLED=false`), `skipped` (unverified /
   unsubscribed / filter emptied), `failed` (SMTP error in
   `last_error` after 3 attempts).
4. API terminal: look for `digest enqueue crashed` /
   `delivery drain crashed` — most often `ECONNREFUSED`, i.e. Postgres
   unreachable, not a code bug. `pending` rows drain on their own once
   the database is back; no restart or re-enqueue needed.
5. Dev shortcut (synthetic change + real send):
   `pnpm mail:test -- --email you@yopmail.com --yes`
   (daily path aligns your close to now; your real prefs are restored
   afterwards).
