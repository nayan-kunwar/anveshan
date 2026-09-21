# When does Anveshan send mail?

One rule: **mail is sent only for verified, subscribed users whose
watch settings match a change.** No match → no mail, no error.

## The three events that can trigger mail

| Event           | Meaning                                          | Needs (besides the basics below)            |
| --------------- | ------------------------------------------------ | ------------------------------------------- |
| `PROGRAM_ADDED` | A brand-new program appeared on HackerOne        | "Notify me of new programs" checked         |
| `ASSET_ADDED`   | New bounty-eligible (IN) asset, or OUT → IN move | Watching that program (list or "Watch all") |
| `ASSET_REMOVED` | An IN asset left scope (IN → OUT) or vanished    | Watching that program (list or "Watch all") |

## The basics (all must be true, or nothing is sent)

1. Email verified (magic link clicked).
2. Not unsubscribed (saving the dashboard re-subscribes you).
3. Subscription saved with cadence `immediate` or `daily`.

## Watch matrix (dashboard settings → what you get)

| Watch all | Watched list  | New-program flag | You receive                           |
| --------- | ------------- | ---------------- | ------------------------------------- |
| off       | empty         | off              | nothing                               |
| off       | empty         | on               | `PROGRAM_ADDED` only                  |
| off       | some programs | off              | `ASSET_*` on those programs           |
| off       | some programs | on               | those `ASSET_*` + all `PROGRAM_ADDED` |
| on        | ignored       | off              | all `ASSET_*`, no `PROGRAM_ADDED`     |
| on        | ignored       | on               | everything                            |

## What NEVER sends mail

- OUT-scope asset activity (stored for audit, silent by design).
- Asset metadata edits (description, bounty, severity) — same
  `type|identifier`, so no event.
- A program disappearing from HackerOne (ignored; no
  `PROGRAM_REMOVED` event exists).
- Zero-change collections (baseline runs, unchanged re-runs).
- Wrong cadence path: `daily` users get one 08:00 UTC digest for the
  prior 24h window; `immediate` users get one mail per collection run
  that has changes.

## When mail doesn't arrive (debugging)

1. Dashboard subscription saved? (`GET /api/v1/subscriptions`)
2. Did the run have changes? (no changes → correctly silent)
3. Outbox `notification_deliveries` status: `sent` (check spam),
   `pending` (worker/API down or `NOTIFICATIONS_ENABLED=false`),
   `skipped` (unverified / unsubscribed / filter emptied before send),
   `failed` (SMTP error in `last_error` after 3 attempts).
4. Dev shortcut: `pnpm mail:test -- --email you@yopmail.com --yes`
   (see `docs/development.md`).
