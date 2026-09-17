# Collector Architecture

## Current Collector

Anveshan currently implements:

    HackerOne API Collector (`platform = "hackerone"`)

See `docs/decisions/005-hackerone.md` for platform choice.

Other collector types are intentionally not implemented yet.

Future possibilities may include:

- Web Collector
- Feed Collector
- Webhook Collector

These are outside the current MVP.

## Responsibilities

The API collector is responsible for:

1. Authentication
2. Fetching programs
3. Fetching program scope
4. Pagination
5. Rate limiting
6. Error handling
7. Normalization

## Collector Boundary

The collector should hide the external platform API.

    External API
         ↓
      API Client
         ↓
      Collector
         ↓
    Normalized Objects

The application should never depend directly on raw API responses.

## API Client

The API client handles HTTP communication with HackerOne Hacker API v1.

Base URL:

    https://api.hackerone.com/v1/hackers

Auth:

    Basic Auth: HACKERONE_USERNAME + HACKERONE_API_TOKEN
    Header: Accept: application/json

Timeouts (MVP):

    request timeout: 15000ms
    max retries on 5xx / network: 3 with exponential backoff + jitter

Responsibilities:

- base URL
- authentication
- HTTP requests
- timeouts
- response handling
- rate-limit handling

The client should not contain business logic.

## HackerOne endpoints (MVP)

### List programs

    GET /hackers/programs?page[size]=100&page[number]=N

Response (JSON:API):

    {
      "data": [
        {
          "id": "1234",
          "type": "program",
          "attributes": { "handle": "acme", "name": "Acme" }
        }
      ],
      "links": { "next": "...", "last": "..." }
    }

Internal mapping:

    externalId = attributes.handle
    externalNumericId = id
    name = attributes.name
    platform = "hackerone"
    url = "https://hackerone.com/{handle}"

### List structured scopes for a program

    GET /hackers/programs/{handle}/structured_scopes?page[size]=100&page[number]=N

Response attributes (subset used):

    id, asset_type, asset_identifier,
    eligible_for_bounty, eligible_for_submission,
    max_severity, created_at, updated_at

Internal mapping (see Asset type mapping below):

    externalId = id (string)
    identifier = asset_identifier (canonicalized, see docs/snapshot-algorithm.md)
    type = map(asset_type)
    scope = eligible_for_bounty == true ? "IN" : "OUT"

All other HackerOne attributes (severity, instruction, reference,
confidentiality/integrity/availability) are ignored for diff purposes
in the MVP. They may be persisted for debugging but MUST NOT trigger changes.

## Collector

The collector coordinates API calls.

HackerOne handle is the program key.

`getPrograms()` MUST NOT nest assets (list endpoint has no full scope).
`getProgramAssets(handle)` fetches scopes. Collection Service joins them.

    interface ProgramCollector {
      getPrograms(): Promise<CollectedProgram[]>;
      getProgramAssets(programHandle: string): Promise<CollectedAsset[]>;
    }

    interface CollectedProgram {
      externalId: string;      // handle
      name: string;
      platform: "hackerone";
      url?: string;
      externalNumericId?: string;
    }

    interface CollectedAsset {
      externalId?: string;
      identifier: string;      // canonicalized
      type: AssetType;
      scope: "IN" | "OUT";
    }

## Normalization

External API responses must be converted into internal models.

Example:

    External Program
          ↓
       Mapper
          ↓
    CollectedProgram

The internal model must not depend on external API field names.

## Pagination

Fetch all pages. Never assume the first response contains all records.

- Programs: `page[size]=100` (HackerOne max), start `page[number]=1`.
  Continue while `links.next` is present OR returned `data.length == page[size]`.
- Scopes: same page loop **until** 10,000 objects for that program, then
  switch to cursor pagination. HackerOne documents that page parameters
  return at most 10,000 structured scopes; beyond that use
  `filter[id__gt]={last_seen_id}` (results sorted by id ascending).
  Page-only collection **silently truncates** large programs and later
  emits false `ASSET_REMOVED` / misses `ASSET_ADDED`. MVP collector MUST
  implement `filter[id__gt]` after the page cap (or use cursor from the
  start for scopes).
- Preserve order-independence: sort/canonicalize before diff;
  API order is not significant.

## Rate Limits

The collector must respect HackerOne rate limits.

- Default throttle: max ~40 requests/min for structured scopes
  (below documented ~50 req/min), min 1500ms between scope requests
  unless `Retry-After` says longer.
- Configurable via env: `H1_MIN_DELAY_MS` (default 1500),
  `H1_MAX_CONCURRENCY` (default 1, must stay 1 in MVP).
- On HTTP 429:
  1. Read `Retry-After` header if present, else exponential backoff
     (1s, 2s, 4s, max 30s) + jitter.
  2. Retry up to 5 times, then fail the collection run with
     `RATE_LIMITED` status (do not persist partial snapshots).
- 429 responses must be handled explicitly.

## Asset type mapping (HackerOne -> internal)

HackerOne `asset_type` values are case-insensitive. Normalize with
`toUpperCase().trim()` first, then map:

| HackerOne `asset_type`                                 | Internal `AssetType` |
| ------------------------------------------------------ | -------------------- |
| `URL`                                                  | `URL`                |
| `WILDCARD`                                             | `WILDCARD`           |
| `DOMAIN`                                               | `DOMAIN`             |
| `CIDR`                                                 | `CIDR`               |
| `IP` / `IP_ADDRESS`                                    | `IP`                 |
| `ANDROID_PLAY_STORE` / `ANDROID_APK` / `ANDROID`       | `ANDROID`            |
| `IOS_APP_STORE` / `IOS_TESTFLIGHT` / `IOS_IPA` / `IOS` | `IOS`                |
| `SOURCE_CODE` / `SOURCECODE`                           | `OTHER`              |
| `HARDWARE`                                             | `OTHER`              |
| `EXECUTABLE` / `WINDOWS_MICROSOFT_STORE`               | `OTHER`              |
| `OTHER` / `OTHER_ASSET` / unknown / missing            | `OTHER`              |

Unmapped values MUST map to `OTHER`, never throw. Log at `warn`
with program handle + raw value (no secrets).

`API` internal type is reserved for future explicit API assets;
HackerOne URL assets that are clearly API endpoints stay `URL` in MVP.
Do not guess.

## Scope rule (HackerOne)

- Persist ALL structured scopes (both IN and OUT) for auditability.
- Diff ONLY `scope == "IN"` (`eligible_for_bounty == true`).
- `eligible_for_submission == true` but `eligible_for_bounty == false`
  is still `OUT` for diff purposes.
- Rationale: bounty-eligibility is the hacker-visible bounty-eligible
  signal on HackerOne.
- VDP / no-bounty programs typically have `eligible_for_bounty=false` on
  every scope. Anveshan still stores the program and OUT assets, still
  emits `PROGRAM_ADDED` on non-first runs, and emits **no** `ASSET_*`
  events unless a scope later becomes bounty-eligible.

## Errors

Map HTTP status to internal error codes:

| HackerOne response               | Internal code                   | Action                                                     |
| -------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| 401 / 403                        | `AUTH_FAILED`                   | fail run, check `HACKERONE_USERNAME`/`HACKERONE_API_TOKEN` |
| 429                              | `RATE_LIMITED`                  | honor `Retry-After`, backoff, retry 5x then fail run       |
| timeout / ECONNRESET / ENOTFOUND | `NETWORK` / `TIMEOUT`           | retry 3x, then fail run                                    |
| 5xx                              | `COLLECTION_FAILED`             | retry 3x, then fail run                                    |
| invalid JSON / missing `data`    | `COLLECTION_FAILED` (malformed) | fail run, log shape                                        |

The collector should distinguish between:

- authentication failure (`AUTH_FAILED`)
- rate limiting (`RATE_LIMITED`)
- timeout (`TIMEOUT`)
- network failure (`NETWORK`)
- malformed response (`COLLECTION_FAILED`)
- server errors (`COLLECTION_FAILED`)

Errors should contain enough context to debug the problem without exposing secrets.
Fail-closed: on any unhandled program-level error, mark the whole
run `failed` and persist no snapshot/changes for that run.

## Test fixtures (contract)

Unit tests MUST NOT hit network. Mirror real HackerOne shapes in:

    packages/collector/test/fixtures/hackerone/
      programs-page-1.json   # 2 programs, links.next present
      programs-page-2.json   # 1 program, last page
      scopes-mixed.json      # IN + OUT, URL + WILDCARD + CIDR
      scopes-empty.json      # { "data": [], "links": {} }
      error-401.json
      error-429.json         # with Retry-After header in test harness

Each fixture MUST have `data` array with JSON:API `id`/`type`/`attributes`
and `links` object. Zod schemas validate fixtures in tests; malformed
fixtures fail fast.

## Security

Never log:

- API keys
- access tokens
- authorization headers
- secrets

Only access information through authorized HackerOne API access.
Respect HackerOne terms + rate limits. No scraping of hackerone.com HTML
in MVP — API only.
