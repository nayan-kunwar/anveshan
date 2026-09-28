# Postman setup

Collection + environments for testing the Anveshan API. The full
contract lives in `docs/openapi.yaml`; this folder is the runnable
version of it.

## Files

| File                             | What                                         |
| -------------------------------- | -------------------------------------------- |
| `anveshan-collection.json`       | The collection (8 folders)                   |
| `local.postman_environment.json` | `baseUrl=http://localhost:3000`              |
| `prod.postman_environment.json`  | `baseUrl=https://anveshan-wfgg.onrender.com` |

## Import

1. **Collections → Import →** `anveshan-collection.json`
2. **Environments → Import →** both environment files
3. Pick an environment in the top-right dropdown.
4. **Set `adminKey`** (environment → `adminKey` → paste value; marked
   secret so it is not re-exported):
   - Local: the `ADMIN_API_KEY` value from your root `.env`
   - Prod: the `ADMIN_API_KEY` set in the Render dashboard
   - Empty `adminKey` → admin requests simply fail 401 (safe).

The environment ships with an **empty** `adminKey` on purpose: keys are
never committed.

## Run order

```
1. Health                          always safe
2. Programs (public)               safe; first request chains programId
3. Assets (public)                 safe (uses chained programId)
4. Changes (public)                safe
5. Auth                            "Verify magic link" needs the token
                                   from the email — paste it into the
                                   magicToken collection variable first
                                   (testEmail → yopmail inbox works)
6. Subscription                    needs the session cookie from 5;
                                   without it requests 401 (assertions
                                   accept 200/401)
7. Admin - collection runs         needs adminKey; one request has a
                                   SIDE EFFECT flag
8. Admin - scheduler               needs adminKey; PUT/DELETE change
                                   live state — run the final "Reset"
                                   request to clean up
```

Assertions are deliberately tolerant on session-dependent requests
(`200 or 401`) so the collection runs green before you finish the
manual magic-link step; they tighten to exact codes where no session
is involved (validation, 404s, admin auth).

## Side effects — read before sending

- **Trigger a collection run** (folder 7): starts a real HackerOne
  collection — 15–20 minutes of API + DB load. Poll "List recent runs"
  for status. On prod this creates a real `collection_runs` row.
- **Reschedule scheduler** (folder 8): upserts a `scheduler_settings`
  row and applies it immediately (no restart). On prod it **survives
  deploys** until you run **"Reset scheduler to env config"**.
- **Unsubscribe** (folder 6): with the placeholder token it returns
  401 (negative test). To exercise the 200 path, copy `userId` + token
  from an unsubscribe link in a real email.

## Notes

- Cookies: Postman's automatic cookie jar stores the `session` cookie
  sent by `POST /api/v1/auth/verify`; folders 6+ pick it up.
- `programId` / `runId` / `userId` are collection variables, set
  automatically by the first response of their folder. Folders 2-4 need
  at least one program: the local DB may be **empty after running the
  test suite** (tests call `truncateAll`) — run `pnpm collect` first or
  spot-check those folders against prod, which has real data.
- Render cold start: the first request after idle can take 30-50s or
  fail once — retry, then everything is warm.
- Rate limits exist on `request-magic-link` (429 is asserted as
  acceptable).
- Prod scheduler kill switch: if `COLLECTION_ENABLED=false` on Render,
  scheduler PUT/DELETE return `409 SCHEDULER_DISABLED` by design.
