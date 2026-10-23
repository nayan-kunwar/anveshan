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

These are not code questions. Each needs a billing, account, or risk
decision from the operator, and `AGENTS.md` §1 keeps M4 paused until
they are settled. Nothing is broken while they are open: the local
keep-alive holds the free Render instance awake and the Node 24.22.1
security patch is live. But collection stays manual and mail only flows while the
process is awake.

### 6.1 Hosting

- [ ] **Decision:** Render Starter (~$7/mo) vs. Fly.io / Railway.
- **Why:** the free tier sleeps after ~15 minutes idle, which stops the
  scheduler, outbox worker, and digest tick. This is the root problem
  M4 exists to fix.
- **Recommendation:** Render Starter — same platform, least migration
  work.
- **Needed from operator:** choose a provider and approve the spend.

### 6.2 Collection cadence

- [ ] **Decision:** hourly vs. every 30 minutes.
- **Why:** a full run takes ~26.5 minutes. A 30-minute schedule overlaps
  and the advisory lock skips the second trigger, so it behaves like
  hourly with more noise.
- **Recommendation:** hourly (`COLLECTION_CRON=0 * * * *`).
- **Needed from operator:** confirm the interval.

### 6.3 Monitoring and alerting

- [ ] **Decision:** hosted dead-man's-switch vs. GitHub Actions checks.
- **Why:** acceptance requires a dead process or stale scheduler to
  alert within 15 minutes. Something external must watch the API.
- **Recommendation:** hosted heartbeat (e.g. Healthchecks.io free tier),
  pinged after each completed run and `/fail` on failure, plus an
  uptime check on `/health`.
- **Needed from operator:** create the check/account and provide the
  alert email. GitHub scheduled workflows proved unreliable here (the
  removed keep-alive fired once in four hours), so they are not the
  primary mechanism.

### 6.4 Production mail

- [ ] **Decision:** Brevo + sender on `nayankunwar.com` vs. keep the
      current provider.
- **Why:** magic-link login and change notifications depend on
  deliverability.
- **Recommendation:** Brevo with SPF, DKIM, and DMARC records on the
  domain.
- **Needed from operator:** choose the provider and confirm DNS access.

### 6.5 Database recovery

- [ ] **Decision:** stay on the current plan with scheduled `pg_dump`
      backups vs. upgrade for PITR/backups.
- **Why:** acceptance requires an exercised restore. Without backups, a
  bad deploy or deletion is unrecoverable.
- **Recommendation:** at minimum scheduled dumps plus one restore drill;
  upgrade if the current plan has no PITR.
- **Needed from operator:** confirm the current plan and approve any
  spend.

### 6.6 What stays blocked

Until 6.1 is settled, the scheduler cannot be enabled safely, because
the free instance will sleep and miss runs. Until 6.3 is settled, the
"alert within 15 minutes" criterion cannot be demonstrated. Until 6.4
and 6.5 are settled, the mail and restore criteria cannot be signed
off.

Work that does not depend on these decisions (runbook drafting,
`HEARTBEAT_URL` plumbing, scheduler config) can be scoped, but
implementation stays paused until the decisions are recorded here.

## 7. Out of scope

- A second platform collector (candidate for M5).
- Collector, diff, or notification-semantics changes.
- New change types, tables, or public API contracts.
- Everything listed as out of scope in `AGENTS.md` §2.
