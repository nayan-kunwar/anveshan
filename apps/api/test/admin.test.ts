import { describe, expect, it } from "vitest";
import request from "supertest";
import { loadConfig } from "@anveshan/config";
import type { Database } from "@anveshan/database";
import type { Pool } from "pg";
import { isValidAdminKey } from "../src/admin/auth.js";
import { createAdminService } from "../src/admin/routes.js";
import type { AdminRunDto, AdminService } from "../src/admin/routes.js";
import { createApp } from "../src/app.js";
import type { ProgramStore } from "../src/services/programs.js";
import type { CollectionSummary } from "../src/collection/service.js";
import { createLogger } from "../src/logger.js";

const logger = createLogger({ LOG_LEVEL: "silent" });
const ADMIN_KEY = "a".repeat(32);

const store: ProgramStore = {
  listPrograms: async () => ({ items: [], total: 0 }),
  findProgramById: async () => undefined,
  listAssets: async () => ({ items: [], total: 0 }),
  listChanges: async () => ({ items: [], total: 0 }),
};

const RUN_ID = "33333333-3333-3333-3333-333333333333";

const runDto: AdminRunDto = {
  id: RUN_ID,
  status: "completed",
  startedAt: "2026-03-01T00:00:00.000Z",
  completedAt: "2026-03-01T00:20:00.000Z",
  programsSeen: 2,
  assetsSeen: 3,
  programsAdded: 0,
  assetsAdded: 1,
  assetsRemoved: 0,
  errorCode: null,
  errorMessage: null,
};

function stubService(overrides: Partial<AdminService> = {}): AdminService {
  return {
    trigger: async () => ({
      status: "running",
      startedAt: "2026-03-02T00:00:00.000Z",
    }),
    recent: async () => [runDto],
    find: async (id) => (id === RUN_ID ? runDto : undefined),
    ...overrides,
  };
}

function appWithAdmin(service: AdminService, adminKey: string | undefined) {
  const config = loadConfig({
    DATABASE_URL: "postgres://anveshan:anveshan@localhost:5433/anveshan",
    ...(adminKey === undefined ? {} : { ADMIN_API_KEY: adminKey }),
  });
  return createApp({ store, logger, config, adminService: service });
}

describe("admin key verification", () => {
  it("round-trips the correct key", () => {
    expect(isValidAdminKey(ADMIN_KEY, ADMIN_KEY)).toBe(true);
  });

  it("rejects wrong keys", () => {
    expect(isValidAdminKey("b".repeat(32), ADMIN_KEY)).toBe(false);
  });

  it("rejects shorter keys without throwing", () => {
    expect(isValidAdminKey("short", ADMIN_KEY)).toBe(false);
  });
});

describe("POST /api/v1/admin/collections", () => {
  it("returns 202 with running status for a valid key", async () => {
    const app = appWithAdmin(stubService(), ADMIN_KEY);
    const res = await request(app)
      .post("/api/v1/admin/collections")
      .set("x-admin-key", ADMIN_KEY)
      .expect(202);
    expect(res.body.data).toMatchObject({ status: "running" });
    expect(typeof res.body.data.startedAt).toBe("string");
  });

  it("returns UNAUTHORIZED without a key", async () => {
    const app = appWithAdmin(stubService(), ADMIN_KEY);
    const res = await request(app).post("/api/v1/admin/collections").expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED for a wrong key", async () => {
    const app = appWithAdmin(stubService(), ADMIN_KEY);
    const res = await request(app)
      .post("/api/v1/admin/collections")
      .set("x-admin-key", "b".repeat(32))
      .expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED when ADMIN_API_KEY is unset", async () => {
    const app = appWithAdmin(stubService(), undefined);
    const res = await request(app)
      .post("/api/v1/admin/collections")
      .set("x-admin-key", ADMIN_KEY)
      .expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 200 skipped when a trigger is already in flight", async () => {
    const app = appWithAdmin(
      stubService({
        trigger: async () => ({
          status: "skipped",
          startedAt: "2026-03-02T00:00:00.000Z",
        }),
      }),
      ADMIN_KEY,
    );
    const res = await request(app)
      .post("/api/v1/admin/collections")
      .set("x-admin-key", ADMIN_KEY)
      .expect(200);
    expect(res.body.data.status).toBe("skipped");
  });
});

describe("GET /api/v1/admin/collections", () => {
  it("lists recent runs for a valid key", async () => {
    const app = appWithAdmin(stubService(), ADMIN_KEY);
    const res = await request(app)
      .get("/api/v1/admin/collections")
      .set("x-admin-key", ADMIN_KEY)
      .expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ id: RUN_ID, status: "completed" });
  });

  it("rejects listing without a key", async () => {
    const app = appWithAdmin(stubService(), ADMIN_KEY);
    const res = await request(app).get("/api/v1/admin/collections").expect(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects limit over 50 with BAD_REQUEST", async () => {
    const app = appWithAdmin(stubService(), ADMIN_KEY);
    const res = await request(app)
      .get("/api/v1/admin/collections?limit=51")
      .set("x-admin-key", ADMIN_KEY)
      .expect(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });
});

describe("GET /api/v1/admin/collections/:id", () => {
  it("returns the run for a known id", async () => {
    const app = appWithAdmin(stubService(), ADMIN_KEY);
    const res = await request(app)
      .get(`/api/v1/admin/collections/${RUN_ID}`)
      .set("x-admin-key", ADMIN_KEY)
      .expect(200);
    expect(res.body.data).toMatchObject({ id: RUN_ID });
  });

  it("returns RUN_NOT_FOUND for unknown ids", async () => {
    const app = appWithAdmin(stubService(), ADMIN_KEY);
    const res = await request(app)
      .get("/api/v1/admin/collections/99999999-9999-9999-9999-999999999999")
      .set("x-admin-key", ADMIN_KEY)
      .expect(404);
    expect(res.body.error.code).toBe("RUN_NOT_FOUND");
  });
});

describe("admin trigger single-flight", () => {
  it("skips while a run is in flight, accepts again after it finishes", async () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://anveshan:anveshan@localhost:5433/anveshan",
      ADMIN_API_KEY: ADMIN_KEY,
    });
    let resolveRun!: (summary: CollectionSummary) => void;
    const pending = new Promise<CollectionSummary>((resolve) => {
      resolveRun = resolve;
    });
    const service = createAdminService({
      config,
      pool: {} as Pool,
      logger,
      db: {} as Database,
      runOnce: () => pending,
    });

    const first = await service.trigger();
    expect(first.status).toBe("running");
    const second = await service.trigger();
    expect(second.status).toBe("skipped");

    resolveRun({
      runId: RUN_ID,
      status: "completed",
      programsSeen: 1,
      assetsSeen: 1,
      programsAdded: 0,
      assetsAdded: 0,
      assetsRemoved: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const third = await service.trigger();
    expect(third.status).toBe("running");
  });
});
