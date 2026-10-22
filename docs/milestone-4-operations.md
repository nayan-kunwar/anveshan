# Milestone 4 — Production Operations

Status: **planned, not started.** The open decisions in §6 must be settled
before work begins.

Goal: make Anveshan run unattended in production and make failures visible.
Collector behavior, diff semantics, API contracts, and notification rules stay
frozen.

---

## 1. Baseline (verified 2026-10-22)

- `https://anveshan.nayankunwar.com` is live on Vercel and serves the latest
  build (route titles include the M3 metadata).
- `/api/*` rewrites to the Render API at `anveshan-wfgg.onrender.com`.
- The API serves the real catalog (599 programs at check time), and
  `/api/v1/admin/*` is fail-closed (`401` without `X-Admin-Key`).
- The API runs on Render's free tier and sleeps after ~15 minutes idle.
- Production collection is manual (`COLLECTION_ENABLED=false`); the admin
  trigger is the current entry point.
- No DNS or Vercel work is needed — the custom domain is already correct.

## 2. Why this milestone

Render's free tier stops the process after ~15 minutes without traffic, which
also stops:

- the `node-cron` collection schedule,
- the 30-second outbox delivery worker (immediate mail stalls),
- the per-minute digest tick.

Until the API is always-on, both collection and email only work when someone
pokes the service. This milestone makes the existing product dependable rather
than adding features.

## 3. Workstreams

### 3.1 Always-on API

- [ ] Move the API to an always-on instance (Render Starter ~$7/mo preferred;
      Fly.io or Railway acceptable).
- [ ] Confirm the production Postgres plan and whether it scales to zero;
      pick the backup strategy (see §3.5).
- [ ] Confirm production env: `NODE_ENV=production`, real secrets,
      `COLLECTION_ENABLED=true`, `NOTIFICATIONS_ENABLED=true`.
- [ ] Run `pnpm db:migrate` against production before enabling the scheduler.
- [ ] Verify `/health`, one manual collection, and one manual mail send after
      the move.

### 3.2 Scheduled collection

- [ ] Decide cadence (hourly recommended; a full run takes ~26.5 minutes).
- [ ] Apply it via env (`COLLECTION_CRON`) or
      `PUT /api/v1/admin/scheduler`.
- [ ] Confirm the overlap lock: a trigger during a run returns `skipped`.
- [ ] Confirm two consecutive runs on unchanged data produce zero changes.
- [ ] Verify run history in `GET /api/v1/admin/collections`.

### 3.3 Production mail

- [ ] Confirm the current production provider; target Brevo with a sender on
      `nayankunwar.com`.
- [ ] Add SPF, DKIM, and DMARC records for the sending domain.
- [ ] Verify live: magic link → dashboard, immediate change mail, daily digest
      at a non-UTC timezone, unsubscribe.
- [ ] Rotate the exposed `ADMIN_API_KEY` and Gmail app password; consider
      rotating `MAGIC_LINK_SECRET` / `SESSION_SECRET` / `UNSUBSCRIBE_SECRET`.
- [ ] Confirm `FRONTEND_URL=https://anveshan.nayankunwar.com` (no trailing
      slash) and redeploy the frontend if `API_INTERNAL_URL` changes.

### 3.4 Monitoring and alerting

- [ ] Uptime check on the API `/health` (and/or the public site).
- [ ] Collection freshness alert. Preferred: optional `HEARTBEAT_URL` in the
      API, pinged after each completed run and `/fail` on a failed run.
- [ ] Alert destination: operator email (or chosen channel).
- [ ] Test the alerts: pause the scheduler, then force a failing run; both
      must alert within 15 minutes.
- [ ] Document thresholds and who receives alerts.

### 3.5 Recovery

- [ ] Confirm Postgres backups / point-in-time recovery.
- [ ] Restore one backup into a scratch database; run migrations and smoke
      checks against it.
- [ ] Write the runbook: deploy, rollback, rotate secrets, restore the
      database, re-trigger collection.

### 3.6 Soak and close

- [ ] 72 hours unattended.
- [ ] Acceptance criteria below all pass.
- [ ] Update `AGENTS.md` §1, `README.md` status, and this checklist.
- [ ] Close M4.

## 4. Acceptance criteria

- Collections run on schedule for 72 hours with no manual triggers.
- Immediate and digest mail deliver; delivery failures are visible to the
  operator.
- A dead process or stale scheduler produces an alert within 15 minutes.
- A database restore is documented and has been exercised once.
- Login, dashboard, program pages, and unsubscribe work on the custom domain.

## 5. Console actions (user-side)

These need dashboard access; pairing steps will be provided.

- [ ] Render: plan change, env vars, shell migration.
- [ ] Vercel: confirm `API_INTERNAL_URL`; redeploy if it changes.
- [ ] DNS: mail authentication records (SPF/DKIM/DMARC).
- [ ] Monitoring: create the uptime/heartbeat checks.
- [ ] Database: confirm plan and backups.

## 6. Open decisions

- [ ] Hosting: Render Starter (~$7/mo) vs. Fly.io / Railway.
- [ ] Cadence: hourly vs. every 30 minutes.
- [ ] Monitoring: hosted dead-man's-switch service vs. GitHub Actions checks.
- [ ] Mail: Brevo + domain sender vs. keep the current provider.
- [ ] Database: stay on the current plan vs. upgrade for PITR/backups.

## 7. Out of scope

- A second platform collector (candidate for M5).
- Collector, diff, or notification-semantics changes.
- New change types, tables, or public API contracts.
- Everything listed as out of scope in `AGENTS.md` §2.
