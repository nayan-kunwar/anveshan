# Running Anveshan

Single guide for running the project locally, from zero to working stack.
Commands run from the repo root unless noted.

---

## 1. Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose
- HackerOne account + API token (https://hackerone.com/settings/api_token) —
  only needed for `pnpm collect` / `pnpm test:live`. Unit tests use fixtures.

---

## 2. First-time setup

```bash
pnpm install
cp .env.example .env
```

Fill in `.env` (see `.env.example`, the source of truth):

| Variable                                                    | Needed for                       | Notes                                                         |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------- |
| `DATABASE_URL`                                              | everything                       | Template default points at Docker Postgres (`localhost:5433`) |
| `HACKERONE_USERNAME` / `HACKERONE_API_TOKEN`                | `pnpm collect`, `pnpm test:live` | Leave blank for API/frontend/tests                            |
| `MAGIC_LINK_SECRET`, `SESSION_SECRET`, `UNSUBSCRIBE_SECRET` | signing in locally               | Any 32-char strings; fail-closed per endpoint when missing    |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`                       | receiving real emails            | Optional locally (see §6)                                     |

Then start Postgres and migrate:

```bash
docker compose up -d postgres
pnpm db:migrate
```

---

## 3. Run the API

```bash
pnpm dev
```

- API at http://localhost:3000
- Check: `curl http://localhost:3000/health` → `{"status":"ok"}`
- The dev server also runs the collection scheduler every 30 minutes
  (`COLLECTION_CRON`). To run the API without it:
  `COLLECTION_ENABLED=false pnpm dev`

---

## 4. Run the frontend

Second terminal:

```bash
pnpm dev:web
```

- Frontend at http://localhost:3001
- Start at http://localhost:3001/login
- `/api/*` is rewritten to the API, so the session cookie stays
  first-party — no CORS setup needed. The API must be running (§3).

---

## 5. Sign in locally

1. Open http://localhost:3001/login, enter your email.
2. The request always returns 200, even if mail isn't configured.
3. **Without SMTP** (`SMTP_*` unset): no email goes out — expected locally.
   `AUTH_EMAIL_ENABLED` derives to false and the link is skipped (logged).
4. **With SMTP** (e.g. Gmail app password for local dev): the sign-in link
   arrives by mail, valid 15 minutes, single-use.
5. After verifying, manage subscriptions at http://localhost:3001/dashboard
   (frequency, watched programs, new-program flag).

---

## 6. Run the collector

```bash
pnpm collect
```

- Uses the same service as the scheduler. Requires HackerOne credentials.
- A full pass takes ~15–20 minutes (rate-limited, ~590 programs).
- The first successful run establishes the baseline (**0 changes**);
  only later runs emit `PROGRAM_ADDED` / `ASSET_ADDED` / `ASSET_REMOVED`.
- Prints a summary (`status`, `run`, program/asset counts) on completion.

---

## 7. Run tests

```bash
pnpm test
```

- Unit + API tests with fixtures; never hits the network.
- DB-backed tests need Postgres reachable: export `DATABASE_URL`
  (e.g. `export DATABASE_URL=postgres://anveshan:anveshan@localhost:5433/anveshan`).
- Test env forces `COLLECTION_ENABLED=false`, `NOTIFICATIONS_ENABLED=false`,
  `AUTH_EMAIL_ENABLED=false` — no cron, no SMTP.
- Live HackerOne check (opt-in): `H1_LIVE_TEST=1 pnpm test:live` with real
  `HACKERONE_USERNAME` / `HACKERONE_API_TOKEN`.

---

## 8. Gotchas

- **Don't run `pnpm dev` while running `pnpm test`.** The dev scheduler
  holds the collection advisory lock, so collection tests report `skipped`.
  Stop the API first, or start it with `COLLECTION_ENABLED=false`.
- **Stray servers on ports 3000/3001** (e.g. after a killed terminal) cause
  `EADDRINUSE`. Find and stop them:
  ```bash
  netstat -ano | grep -E ":300[01]" | grep LISTENING
  taskkill //PID <pid> //F
  ```
- **`.env` lives at the repo root only.** Entry points resolve it via
  `initLocalEnv()` regardless of working directory — never add per-package
  `.env` files. Shell-exported variables win over the file.

---

## 9. Production

See [README Production section](../README.md#production). Short version:

```bash
cp .env.example .env   # fill credentials, secrets, SMTP, FRONTEND_URL
docker compose --profile api up -d --build
```

Starts `postgres` + `api` (port 3000) + `web` (port 3001). For real mail:
`NOTIFICATIONS_ENABLED=true`, SMTP creds, and the three auth secrets.
