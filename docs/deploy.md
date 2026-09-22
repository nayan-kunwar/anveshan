# Deploying Anveshan (split: Vercel frontend + hosted API)

Local run guide: [`running.md`](running.md). Docker Compose reference:
[README Production](../README.md#production).

Split deployment is required because the two processes have different
shapes: the frontend is a stateless Next.js app (fits Vercel); the API
is a long-lived Node process (Express + `node-cron` scheduler + 30s
delivery-worker interval + persistent `pg` pool) that does **not** fit
serverless functions. Host the API on Render / Railway / Fly / a VPS
(the existing `apps/api/Dockerfile` builds it).

```
browser ──https──▶ your-app.vercel.app ──/api/* rewrite──▶ API host:3000 ──▶ managed Postgres
                   (static + SSR, no env)   (first-party cookie)   (cron + worker + pool)
```

---

## 1. Frontend (Vercel)

Vercel project settings: Root Directory `apps/web`, Framework Next.js,
package manager pnpm. No `vercel.json` needed.

| Variable           | Value                     | Notes                                                                                        |
| ------------------ | ------------------------- | -------------------------------------------------------------------------------------------- |
| `API_INTERNAL_URL` | `https://<your-api-host>` | Public API URL. Baked into `/api/*` rewrites **at build time** — redeploy after changing it. |

That is the only variable. There are no `NEXT_PUBLIC_*` values: the
browser needs zero env (the API address lives in the server-side
rewrite), and secrets must never ship to the page bundle. `PORT` is
Vercel-managed — ignore it.

`API_INTERNAL_URL` keeps the session cookie first-party (browser →
your domain → rewrite → API), so no CORS setup is needed.

---

## 2. API (long-lived host)

| Variable                                    | Required?                       | Notes                                                                               |
| ------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| `DATABASE_URL`                              | Yes (only hard-required var)    | Managed Postgres reachable from the API host — not `localhost` unless same machine  |
| `FRONTEND_URL`                              | Yes in practice                 | Exact Vercel URL, no trailing slash (see §4)                                        |
| `MAGIC_LINK_SECRET`, `SESSION_SECRET`       | Yes for login                   | 32+ random chars (`openssl rand -base64 32`); fail-closed per endpoint when missing |
| `UNSUBSCRIBE_SECRET`                        | Yes for mail links              | Same generation; every email embeds links signed with it                            |
| `SMTP_HOST/PORT/USER/PASS/FROM`             | Yes for real mail               | Gmail is local-only; use Resend/Postmark/SES in production                          |
| `NOTIFICATIONS_ENABLED`                     | Yes for change mail             | Default `false` = outbox never enqueues/drains                                      |
| `HACKERONE_USERNAME`, `HACKERONE_API_TOKEN` | Yes for collection              | Every collection run fails closed without them                                      |
| `PORT`, `LOG_LEVEL`                         | No (`3000`, `info`)             | Match the host's expected port if required                                          |
| `COLLECTION_CRON`, `COLLECTION_TZ`          | No (`*/30 * * * *`, `UTC`)      | Scheduler cadence                                                                   |
| `DIGEST_TICK_CRON`                          | No (`* * * * *`)                | Per-minute tick over personal digest closes (Settings → time + timezone)            |
| `AUTH_EMAIL_ENABLED`                        | No (auto-derived from `SMTP_*`) | Explicit override only if needed                                                    |

After boot, logs must show `anveshan api listening` plus the scheduler
and digest-cron start lines — and must **not** show
`delivery worker disabled (NOTIFICATIONS_ENABLED=false)`.

### Render field values (native, no Docker)

Use a **Web Service** with the **native** runtime (leave the Docker
option off) — set these fields exactly:

| Field              | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| Root Directory     | _(empty — monorepo root, not `apps/api`)_                                |
| Build Command      | `pnpm install --frozen-lockfile && pnpm --filter @anveshan/api... build` |
| Start Command      | `node apps/api/dist/index.js`                                            |
| Env `NODE_VERSION` | `22` (matches `apps/api/Dockerfile`; Render's default 24 works too)      |

Never put `corepack enable` in the Build Command: Render's `/usr/bin`
is read-only, corepack fails with `EROFS: read-only file system`, and
the build dies before `pnpm install`. Render detects pnpm from
`pnpm-lock.yaml` and provides it natively — the install needs no
shim. The scoped `--filter @anveshan/api...` build compiles the API
and its workspace dependencies only, skipping the Next.js build (and
its memory cost) on an API-only service.

After the first green deploy, run once in **Render Shell**:
`pnpm db:migrate`. Do not set `PORT` (Render injects it; Express
already honours it).

---

## 3. Wiring checklist

- [ ] API + managed Postgres deployed; `DATABASE_URL` reachable from API host
- [ ] `FRONTEND_URL` = exact Vercel URL on the API; `API_INTERNAL_URL` = API URL on Vercel (then redeploy frontend)
- [ ] Three secrets set; SMTP set; `NOTIFICATIONS_ENABLED=true`; HackerOne creds set
- [ ] `curl https://<api-host>/health` → `{"status":"ok"}`
- [ ] Login flow works end-to-end (magic link → callback → dashboard, no bounce to `/login`)
- [ ] `pnpm mail:test -- --email you@yopmail.com --yes` (from a machine with DB access) still sends

---

## 4. Symptom fixes

| Symptom                                                | Cause                                                                                                   | Fix                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Magic-link requested, login loops back to `/login`     | `FRONTEND_URL` still localhost/`http` → cookie set without `Secure` on an https site → browser drops it | Set `FRONTEND_URL` to the https Vercel URL, restart API       |
| `401 UNAUTHORIZED` / `INVALID_TOKEN` on auth endpoints | Secrets missing (fail-closed by design)                                                                 | Set the three `*_SECRET` vars, restart API                    |
| No change mail, worker log says `disabled`             | `NOTIFICATIONS_ENABLED` unset/false                                                                     | Set `true`, restart API                                       |
| No mail at all, magic link included                    | `SMTP_*` unset (`AUTH_EMAIL_ENABLED` derives false)                                                     | Set SMTP vars                                                 |
| Emails link to localhost                               | Stale `FRONTEND_URL`                                                                                    | Update to Vercel URL, restart API (links render at send time) |
| New deploy didn't pick up API URL change               | Rewrites bake `API_INTERNAL_URL` at build                                                               | Redeploy the frontend after changing the variable             |
