# Anveshan API Reference

Read-only API for querying bug-bounty programs, their in-scope assets, and detected changes.

**Base URL:** `http://localhost:3000`
**Content-Type:** `application/json`
**Authentication:** None (MVP)

---

## Pagination

All list endpoints return paginated results with this shape:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "pageSize": 25,
    "total": 593
  }
}
```

| Parameter  | Default   | Max | Description             |
| ---------- | --------- | --- | ----------------------- |
| `page`     | 1         | —   | Page number (1-indexed) |
| `pageSize` | 25 or 100 | 100 | Items per page          |

---

## Error format

All errors return a consistent JSON shape:

```json
{
  "error": {
    "code": "PROGRAM_NOT_FOUND",
    "message": "Program not found"
  }
}
```

| Code                | Status | Meaning                                   |
| ------------------- | ------ | ----------------------------------------- |
| `BAD_REQUEST`       | 400    | Invalid query parameters (Zod validation) |
| `PROGRAM_NOT_FOUND` | 404    | No program with that UUID                 |
| `INTERNAL`          | 500    | Unexpected server error                   |
| `COLLECTION_FAILED` | 500    | Background collection run failed          |
| `AUTH_FAILED`       | 500    | HackerOne API credentials invalid         |
| `RATE_LIMITED`      | 500    | HackerOne API rate limit hit              |
| `NETWORK`           | 500    | Network error reaching HackerOne          |
| `TIMEOUT`           | 500    | HackerOne API request timed out           |

---

## Endpoints

### Health check

```
GET /health
```

Returns `200 OK` if the server is running.

**Parameters:** None

**Example:**

```bash
curl http://localhost:3000/health
```

**Response (200):**

```json
{
  "status": "ok"
}
```

---

### List programs

```
GET /api/v1/programs
```

Returns all monitored bug-bounty programs, ordered by name.

**Query parameters:**

| Parameter  | Type    | Default | Description               |
| ---------- | ------- | ------- | ------------------------- |
| `page`     | integer | 1       | Page number (min: 1)      |
| `pageSize` | integer | 25      | Items per page (max: 100) |

**Example:**

```bash
curl "http://localhost:3000/api/v1/programs?page=1&pageSize=2"
```

**Response (200):**

```json
{
  "data": [
    {
      "id": "0df6bac9-82b0-4e5b-9097-8404cf003829",
      "platform": "hackerone",
      "externalId": "1password",
      "name": "1Password - Enterprise Password Manager",
      "url": "https://hackerone.com/1password",
      "updatedAt": "2026-09-17T15:05:57.690Z"
    },
    {
      "id": "d1ac661c-0837-4ce9-b283-f4b478d8e743",
      "platform": "hackerone",
      "externalId": "1win_com",
      "name": "1win",
      "url": "https://hackerone.com/1win_com",
      "updatedAt": "2026-09-17T15:05:58.342Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 2,
    "total": 593
  }
}
```

**Error (400):**

```bash
curl "http://localhost:3000/api/v1/programs?page=0"
```

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Invalid query parameters"
  }
}
```

---

### Get program by ID

```
GET /api/v1/programs/:id
```

Returns a single program by its internal UUID.

**Path parameters:**

| Parameter | Type | Description         |
| --------- | ---- | ------------------- |
| `id`      | UUID | Program internal ID |

**Example:**

```bash
curl http://localhost:3000/api/v1/programs/0df6bac9-82b0-4e5b-9097-8404cf003829
```

**Response (200):**

```json
{
  "data": {
    "id": "0df6bac9-82b0-4e5b-9097-8404cf003829",
    "platform": "hackerone",
    "externalId": "1password",
    "name": "1Password - Enterprise Password Manager",
    "url": "https://hackerone.com/1password",
    "updatedAt": "2026-09-17T15:05:57.690Z"
  }
}
```

**Error (404):**

```bash
curl http://localhost:3000/api/v1/programs/00000000-0000-0000-0000-000000000000
```

```json
{
  "error": {
    "code": "PROGRAM_NOT_FOUND",
    "message": "Program not found"
  }
}
```

---

### List program assets

```
GET /api/v1/programs/:id/assets
```

Returns all tracked assets for a program. Filter by scope to see only in-scope (`IN`) or out-of-scope (`OUT`) assets.

**Path parameters:**

| Parameter | Type | Description         |
| --------- | ---- | ------------------- |
| `id`      | UUID | Program internal ID |

**Query parameters:**

| Parameter  | Type    | Default | Description                   |
| ---------- | ------- | ------- | ----------------------------- |
| `scope`    | string  | `ALL`   | Filter: `ALL`, `IN`, or `OUT` |
| `page`     | integer | 1       | Page number (min: 1)          |
| `pageSize` | integer | 100     | Items per page (max: 100)     |

**Example — in-scope assets only:**

```bash
curl "http://localhost:3000/api/v1/programs/0df6bac9-82b0-4e5b-9097-8404cf003829/assets?scope=IN&pageSize=3"
```

**Response (200):**

```json
{
  "data": [
    {
      "id": "1a8ba65f-719d-407b-be20-bbf19687d06c",
      "identifier": "https://events.1password.com/api/",
      "type": "OTHER",
      "scope": "IN"
    },
    {
      "id": "bdc6203d-0088-4df6-bc4e-a8593de7f97f",
      "identifier": "http://--your-own-1password-account--.1password.com/",
      "type": "URL",
      "scope": "IN"
    },
    {
      "id": "ae76e33e-c507-454a-931b-eeab2c8bb40b",
      "identifier": "<Your own 1Password account> — Latest stable, beta, or nightly Browser Extension",
      "type": "OTHER",
      "scope": "IN"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 3,
    "total": 4
  }
}
```

**Example — all assets (default):**

```bash
curl "http://localhost:3000/api/v1/programs/0df6bac9-82b0-4e5b-9097-8404cf003829/assets?pageSize=2"
```

```json
{
  "data": [
    {
      "id": "1455fade-49a9-4788-8582-c59ba81c0784",
      "identifier": "*.agilebits.com",
      "type": "WILDCARD",
      "scope": "OUT"
    },
    {
      "id": "3b10d2b1-e2b7-4321-87bd-36fe3750981c",
      "identifier": "All other domains, subdomains, and 1Password Accounts that are not owned by you.",
      "type": "OTHER",
      "scope": "OUT"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 2,
    "total": 8
  }
}
```

**Error (404):**

```bash
curl "http://localhost:3000/api/v1/programs/00000000-0000-0000-0000-000000000000/assets"
```

```json
{
  "error": {
    "code": "PROGRAM_NOT_FOUND",
    "message": "Program not found"
  }
}
```

---

### List program changes

```
GET /api/v1/programs/:id/changes
```

Returns detected changes for a program, ordered by `detectedAt` descending (newest first). Filter by `since` to see changes after a specific timestamp.

**Path parameters:**

| Parameter | Type | Description         |
| --------- | ---- | ------------------- |
| `id`      | UUID | Program internal ID |

**Query parameters:**

| Parameter  | Type              | Default | Description                       |
| ---------- | ----------------- | ------- | --------------------------------- |
| `since`    | ISO 8601 datetime | —       | Only changes after this timestamp |
| `page`     | integer           | 1       | Page number (min: 1)              |
| `pageSize` | integer           | 100     | Items per page (max: 100)         |

**Example — all changes:**

```bash
curl "http://localhost:3000/api/v1/programs/0df6bac9-82b0-4e5b-9097-8404cf003829/changes"
```

**Response (200):**

```json
{
  "data": [
    {
      "id": "741151b3-16d6-4c4e-9315-61db5ce01c5f",
      "type": "PROGRAM_ADDED",
      "programId": "0df6bac9-82b0-4e5b-9097-8404cf003829",
      "assetId": null,
      "assetIdentifier": null,
      "collectionRunId": "58003519-4494-450b-88b9-4c78da50192b",
      "detectedAt": "2026-09-17T14:31:53.282Z"
    }
  ],
  "pagination": {
    "page": 1,
    "pageSize": 100,
    "total": 1
  }
}
```

**Example — changes since a date:**

```bash
curl "http://localhost:3000/api/v1/programs/0df6bac9-82b0-4e5b-9097-8404cf003829/changes?since=2026-09-17T00:00:00Z"
```

**Error (404):**

```bash
curl "http://localhost:3000/api/v1/programs/00000000-0000-0000-0000-000000000000/changes"
```

```json
{
  "error": {
    "code": "PROGRAM_NOT_FOUND",
    "message": "Program not found"
  }
}
```

---

## Change types

| Type            | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| `PROGRAM_ADDED` | New program discovered in a collection run                     |
| `ASSET_ADDED`   | Asset moved from OUT to IN scope (or new asset added in-scope) |
| `ASSET_REMOVED` | Asset moved from IN to OUT scope (or removed from program)     |

Program removal and asset metadata changes are not tracked in the MVP.

---

## Asset types

| Type       | Description                                                  |
| ---------- | ------------------------------------------------------------ |
| `DOMAIN`   | Exact domain (e.g. `example.com`)                            |
| `WILDCARD` | Wildcard domain (e.g. `*.example.com`)                       |
| `IP`       | Single IP address                                            |
| `CIDR`     | IP range in CIDR notation (e.g. `10.0.0.0/8`)                |
| `URL`      | Full URL or URL pattern                                      |
| `ANDROID`  | Android app (Play Store, APK)                                |
| `IOS`      | iOS app (App Store, TestFlight, IPA)                         |
| `API`      | API endpoint (reserved for future use; currently `URL`)      |
| `OTHER`    | Anything else (hardware, source code, smart contracts, etc.) |

---

## Quick reference

```bash
# Health check
curl http://localhost:3000/health

# List first 10 programs
curl "http://localhost:3000/api/v1/programs?pageSize=10"

# Get one program
curl http://localhost:3000/api/v1/programs/{uuid}

# In-scope assets only
curl "http://localhost:3000/api/v1/programs/{uuid}/assets?scope=IN"

# Recent changes
curl "http://localhost:3000/api/v1/programs/{uuid}/changes?since=2026-09-17T00:00:00Z"
```
