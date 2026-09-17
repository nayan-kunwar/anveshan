import { describe, expect, it } from "vitest";
import request from "supertest";
import type { AssetRow, ChangeRow, ProgramRow } from "@anveshan/database";
import { createApp } from "../src/app.js";
import type { ProgramStore } from "../src/services/programs.js";
import { createLogger } from "../src/logger.js";

const logger = createLogger({ LOG_LEVEL: "silent" });

function row(overrides: Partial<ProgramRow> & { id: string }): ProgramRow {
  return {
    platform: "hackerone",
    externalId: "acme",
    externalIdLower: "acme",
    externalNumericId: "1001",
    name: "Acme",
    url: "https://hackerone.com/acme",
    lastSeenAt: new Date("2026-01-02T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-02T00:00:00Z"),
    ...overrides,
  };
}

const PROGRAM_ID = "11111111-1111-1111-1111-111111111111";

const programs: ProgramRow[] = [
  row({ id: PROGRAM_ID, externalId: "acme", externalIdLower: "acme", name: "Acme" }),
  row({
    id: "22222222-2222-2222-2222-222222222222",
    externalId: "globex",
    externalIdLower: "globex",
    name: "Globex",
    url: null,
  }),
];

const assets: AssetRow[] = [
  {
    id: "a0000000-0000-0000-0000-000000000001",
    programId: PROGRAM_ID,
    externalId: "5001",
    identifier: "example.com",
    normalizedIdentifier: "example.com",
    type: "DOMAIN",
    scope: "IN",
    assetKey: "DOMAIN|example.com",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: "a0000000-0000-0000-0000-000000000002",
    programId: PROGRAM_ID,
    externalId: "5002",
    identifier: "old.example.com",
    normalizedIdentifier: "old.example.com",
    type: "DOMAIN",
    scope: "OUT",
    assetKey: "DOMAIN|old.example.com",
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

const changes: ChangeRow[] = [
  {
    id: "c0000000-0000-0000-0000-000000000001",
    type: "ASSET_ADDED",
    programId: PROGRAM_ID,
    assetId: "a0000000-0000-0000-0000-000000000001",
    assetKey: "DOMAIN|example.com",
    assetIdentifier: "example.com",
    collectionRunId: "r0000000-0000-0000-0000-000000000001",
    detectedAt: new Date("2026-02-02T00:00:00Z"),
  },
  {
    id: "c0000000-0000-0000-0000-000000000002",
    type: "ASSET_REMOVED",
    programId: PROGRAM_ID,
    assetId: "a0000000-0000-0000-0000-000000000002",
    assetKey: "DOMAIN|old.example.com",
    assetIdentifier: "old.example.com",
    collectionRunId: "r0000000-0000-0000-0000-000000000001",
    detectedAt: new Date("2026-02-01T00:00:00Z"),
  },
];

const store: ProgramStore = {
  listPrograms: async (page, pageSize) => ({
    items: programs.slice((page - 1) * pageSize, page * pageSize),
    total: programs.length,
  }),
  findProgramById: async (id) => programs.find((p) => p.id === id),
  listAssets: async (programId, scope, page, pageSize) => {
    const filtered = assets.filter(
      (a) => a.programId === programId && (scope === "ALL" || a.scope === scope),
    );
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
    };
  },
  listChanges: async (programId, since, page, pageSize) => {
    const filtered = changes
      .filter((c) => c.programId === programId && (!since || c.detectedAt >= since))
      .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
    };
  },
};

const app = createApp({ store, logger });

describe("GET /health", () => {
  it("returns ok", async () => {
    await request(app).get("/health").expect(200, { status: "ok" });
  });
});

describe("GET /api/v1/programs", () => {
  it("lists programs with pagination envelope", async () => {
    const res = await request(app).get("/api/v1/programs?page=1&pageSize=1").expect(200);
    expect(res.body.pagination).toEqual({ page: 1, pageSize: 1, total: 2 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ externalId: "acme", platform: "hackerone" });
  });

  it("rejects pageSize over 100 with BAD_REQUEST", async () => {
    const res = await request(app).get("/api/v1/programs?pageSize=101").expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});

describe("GET /api/v1/programs/:id", () => {
  it("returns the program", async () => {
    const res = await request(app).get(`/api/v1/programs/${PROGRAM_ID}`).expect(200);
    expect(res.body.data.name).toBe("Acme");
  });

  it("returns PROGRAM_NOT_FOUND for unknown ids", async () => {
    const res = await request(app)
      .get("/api/v1/programs/99999999-9999-9999-9999-999999999999")
      .expect(404);
    expect(res.body).toEqual({
      error: { code: "PROGRAM_NOT_FOUND", message: "Program not found" },
    });
  });

  it("returns BAD_REQUEST for non-UUID ids", async () => {
    const res = await request(app).get("/api/v1/programs/acme").expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});

describe("GET /api/v1/programs/:id/assets", () => {
  it("defaults to ALL scopes", async () => {
    const res = await request(app)
      .get(`/api/v1/programs/${PROGRAM_ID}/assets`)
      .expect(200);
    expect(res.body.pagination.total).toBe(2);
  });

  it("filters by scope=IN", async () => {
    const res = await request(app)
      .get(`/api/v1/programs/${PROGRAM_ID}/assets?scope=IN`)
      .expect(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].identifier).toBe("example.com");
  });

  it("rejects invalid scope values", async () => {
    const res = await request(app)
      .get(`/api/v1/programs/${PROGRAM_ID}/assets?scope=SORT_OF`)
      .expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("404s for unknown programs", async () => {
    await request(app)
      .get("/api/v1/programs/99999999-9999-9999-9999-999999999999/assets")
      .expect(404);
  });
});

describe("GET /api/v1/programs/:id/changes", () => {
  it("orders detected_at DESC", async () => {
    const res = await request(app)
      .get(`/api/v1/programs/${PROGRAM_ID}/changes`)
      .expect(200);
    expect(res.body.pagination.total).toBe(2);
    expect(res.body.data[0].type).toBe("ASSET_ADDED");
    expect(res.body.data[1].type).toBe("ASSET_REMOVED");
  });

  it("supports since filtering", async () => {
    const res = await request(app)
      .get(`/api/v1/programs/${PROGRAM_ID}/changes?since=2026-02-02T00:00:00Z`)
      .expect(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].type).toBe("ASSET_ADDED");
  });

  it("404s for unknown programs", async () => {
    await request(app)
      .get("/api/v1/programs/99999999-9999-9999-9999-999999999999/changes")
      .expect(404);
  });
});

describe("unknown routes", () => {
  it("returns a closed error code", async () => {
    const res = await request(app).get("/nope").expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});
