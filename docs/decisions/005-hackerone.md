# ADR 005 — Use HackerOne Hacker API v1 as MVP Source

## Status

Accepted

## Context

AGENTS.md required a "real bug-bounty platform API" but did not name one.
Without a named platform the collector cannot be implemented because auth,
pagination, rate limits, and scope shape differ per platform.

Options considered:

- HackerOne Hacker API v1 (`https://api.hackerone.com/v1/hackers`)
- Bugcrowd API
- Intigriti API

## Decision

Use HackerOne Hacker API v1 for the MVP.

Base URL:

    https://api.hackerone.com/v1/hackers

Auth:

    Basic Auth with username + API token
    curl -u "<HACKERONE_USERNAME>:<HACKERONE_API_TOKEN>"

Endpoints used:

    GET /hackers/programs?page[size]=100&page[number]=N
    GET /hackers/programs/{handle}/structured_scopes?page[size]=100&page[number]=N

Docs:

- https://api.hackerone.com/getting-started-hacker-api/
- https://api.hackerone.com/hacker-resources/ (`Programs / Get Programs`, `Get Structured Scopes`)
- https://api.hackerone.com/hacker-reference/ (`structured-scope`)

## Reason

- Structured JSON:API responses for programs and scope.
- `structured_scopes` exposes exactly what Anveshan needs:
  `id`, `asset_type`, `asset_identifier`, `eligible_for_bounty`,
  `eligible_for_submission`, `max_severity`, timestamps.
- Pagination via `page[number]` / `page[size]` (max 100).
- Documented rate limiting (notably ~50 req/min on structured scopes
  per 2026-06-22 changelog). Forces correct backoff design now.
- Large program set to prove diff reliability.

## Consequences

### Positive

- Collector contract is now buildable.
- Fixtures can mirror real shapes.
- Live verification checklist is concrete.

### Negative

- Requires HackerOne credentials for live runs.
- HackerOne API visibility depends on the authenticated hacker's
  program access (private programs not visible to the token are
  out of scope by definition).
- `asset_type` vocabulary differs from internal `AssetType`
  and requires an explicit mapping table (see `docs/collector.md`).
- Structured-scopes fan-out: 1 request per program + pagination.
  Must throttle + handle 429.
- Page parameters return at most 10,000 structured scopes per program.
  Collector must continue with `filter[id__gt]` (see `docs/collector.md`).

## Program identity

- `externalId` = HackerOne program `handle` (stable, human-readable,
  used in `/programs/{handle}/structured_scopes`).
- Also persist HackerOne numeric `id` as `external_numeric_id`
  for debugging, but `handle` is the join key.
- `platform` = constant `"hackerone"`.
- `name` = `attributes.name`, `url` = `https://hackerone.com/{handle}`.

## Scope identity

- `externalId` = HackerOne structured-scope `id` (string).
- Diff identity is NOT the numeric id alone. See
  `docs/snapshot-algorithm.md` for canonical key.

## Out of scope

- Report submission, hacktivity, earnings, payouts.
- Scope exclusions endpoint (`Get Scope Exclusions`) — revisit only
  if `eligible_for_bounty=false` proves insufficient.
- Asset enrichment / CSV import endpoints (program-side API,
  not hacker API).

## Future

If a second platform is added, it must produce the same
`CollectedProgram` / `CollectedAsset` shapes. Domain and diff
engine do not change.
