import { loadConfig } from "@anveshan/config";
import type { AppConfig } from "@anveshan/config";
import type { Database } from "@anveshan/database";
import {
  closePool,
  completeRun,
  createDb,
  createPool,
  createRun,
  findSchedulerSetting,
  runMigrations,
  truncateAll,
  upsertSchedulerSetting,
} from "@anveshan/database";
import type { Pool, PoolClient } from "pg";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAdminService } from "../src/admin/routes.js";
import { createApp } from "../src/app.js";
import { createSchedulerController } from "../src/collection/controller.js";
import type { SchedulerApplyInput } from "../src/collection/controller.js";
import { AppError } from "../src/errors.js";
import { createLogger } from "../src/logger.js";
import type { StopHandle } from "../src/stoppable.js";
import type { ProgramStore } from "../src/services/programs.js";

let db: Database | null = null;
let serialClient: PoolClient | null = null;
let ownPool: Pool | null = null;

const TEST_SERIAL_LOCK_KEY = "anveshan_test_serial";
const DB_URL = "postgres://anveshan:anveshan@localhost:5433/anveshan";
const ADMIN_KEY = "a".repeat(32);
const logger = createLogger({ LOG_LEVEL: "silent" });

beforeAll(async () => {
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    process.stderr.write("DATABASE_URL not set — skipping scheduler controller tests\n");
    return;
  }
  try {
    ownPool = createPool(databaseUrl);
    serialClient = await ownPool.connect();
    await serialClient.query("SELECT pg_advisory_lock(hashtext($1))", [
      TEST_SERIAL_LOCK_KEY,
    ]);
    await runMigrations(databaseUrl);
    db = createDb(ownPool);
    await truncateAll(db);
  } catch (error) {
    process.stderr.write(
      `Postgres unreachable — skipping scheduler controller tests: ${String(error)}\n`,
    );
    db = null;
  }
  return async () => {
    if (serialClient) {
      await serialClient.query("SELECT pg_advisory_unlock(hashtext($1))", [
        TEST_SERIAL_LOCK_KEY,
      ]);
      serialClient.release();
      serialClient = null;
    }
    if (ownPool) {
      await ownPool.end();
      ownPool = null;
    }
    await closePool();
  };
}, 60000);

beforeEach(async () => {
  if (db) await truncateAll(db);
});

function needDb(): Database {
  if (!db) throw new Error("database unavailable");
  return db;
}

function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    DATABASE_URL: DB_URL,
    ADMIN_API_KEY: ADMIN_KEY,
    COLLECTION_ENABLED: "true",
    COLLECTION_CRON: "*/30 * * * *",
    COLLECTION_TZ: "UTC",
    ...overrides,
  });
}

interface FakeTask {
  cfg: AppConfig;
  stopped: boolean;
}

interface FakeStarter {
  tasks: FakeTask[];
  startTask: (cfg: AppConfig) => StopHandle | null;
}

function fakeStarter(): FakeStarter {
  const tasks: FakeTask[] = [];
  return {
    tasks,
    startTask: (cfg: AppConfig): StopHandle | null => {
      const task: FakeTask = { cfg, stopped: false };
      tasks.push(task);
      return {
        stop: async () => {
          task.stopped = true;
        },
      };
    },
  };
}

function makeController(
  starter: FakeStarter,
  overrides: Record<string, string> = {},
  reconcileMs = 0,
) {
  return createSchedulerController({
    config: testConfig(overrides),
    pool: {} as Pool,
    db: needDb(),
    logger,
    startTask: starter.startTask,
    reconcileMs,
  });
}

describe("scheduler controller", () => {
  it("boots from env when no scheduler_settings row exists", async () => {
    const starter = fakeStarter();
    const controller = makeController(starter);
    const status = await controller.boot();
    expect(status).toMatchObject({
      enabled: true,
      source: "environment",
      cron: "*/30 * * * *",
      timezone: "UTC",
    });
    expect(starter.tasks).toHaveLength(1);
    expect(starter.tasks[0]?.cfg.COLLECTION_CRON).toBe("*/30 * * * *");
    expect(await findSchedulerSetting(needDb(), "collection")).toBeUndefined();
    await controller.stop();
    expect(starter.tasks[0]?.stopped).toBe(true);
  });

  it("boots from the database row, honoring a disabled row", async () => {
    await upsertSchedulerSetting(needDb(), "collection", {
      enabled: false,
      cron: "*/15 * * * *",
      timezone: "Asia/Kolkata",
    });
    const starter = fakeStarter();
    const controller = makeController(starter);
    const status = await controller.boot();
    expect(status).toMatchObject({
      enabled: false,
      source: "database",
      cron: "*/15 * * * *",
      timezone: "Asia/Kolkata",
    });
    expect(starter.tasks).toHaveLength(0);
    await controller.stop();
  });

  it("applies admin changes: persists, restarts the task, stops the old one", async () => {
    const starter = fakeStarter();
    const controller = makeController(starter);
    await controller.boot();
    expect(starter.tasks).toHaveLength(1);

    const status = await controller.apply({
      enabled: true,
      cron: "*/5 * * * *",
      timezone: "Asia/Kolkata",
    });
    expect(status).toMatchObject({
      enabled: true,
      source: "database",
      cron: "*/5 * * * *",
      timezone: "Asia/Kolkata",
    });
    const row = await findSchedulerSetting(needDb(), "collection");
    expect(row).toMatchObject({
      enabled: true,
      cron: "*/5 * * * *",
      timezone: "Asia/Kolkata",
    });
    expect(starter.tasks).toHaveLength(2);
    expect(starter.tasks[0]?.stopped).toBe(true);
    expect(starter.tasks[1]?.cfg.COLLECTION_CRON).toBe("*/5 * * * *");
    expect(starter.tasks[1]?.cfg.COLLECTION_TZ).toBe("Asia/Kolkata");
    await controller.stop();
  });

  it("applies a partial body on top of the existing row", async () => {
    const starter = fakeStarter();
    const controller = makeController(starter);
    await controller.boot();
    await controller.apply({ cron: "*/15 * * * *", timezone: "Europe/Berlin" });
    const status = await controller.apply({ enabled: false });
    expect(status).toMatchObject({
      enabled: false,
      source: "database",
      cron: "*/15 * * * *",
      timezone: "Europe/Berlin",
    });
    expect(starter.tasks).toHaveLength(2);
    await controller.stop();
  });

  it("rejects invalid cron and timezone without writing", async () => {
    const starter = fakeStarter();
    const controller = makeController(starter);
    await controller.boot();
    const cases: SchedulerApplyInput[] = [
      { cron: "* * * *" },
      { cron: "*/30 * * * * *" },
      { cron: "not a cron" },
      { timezone: "Mars/Olympus" },
    ];
    for (const body of cases) {
      const error = await controller.apply(body).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("BAD_REQUEST");
      expect((error as AppError).status).toBe(400);
    }
    expect(await findSchedulerSetting(needDb(), "collection")).toBeUndefined();
    expect(starter.tasks).toHaveLength(1);
    await controller.stop();
  });

  it("resets back to environment config and deletes the row", async () => {
    const starter = fakeStarter();
    const controller = makeController(starter);
    await controller.boot();
    await controller.apply({ cron: "0 * * * *" });
    const status = await controller.reset();
    expect(status).toMatchObject({
      enabled: true,
      source: "environment",
      cron: "*/30 * * * *",
      timezone: "UTC",
    });
    expect(await findSchedulerSetting(needDb(), "collection")).toBeUndefined();
    expect(starter.tasks).toHaveLength(3);
    expect(starter.tasks[1]?.stopped).toBe(true);
    expect(starter.tasks[2]?.stopped).toBe(false);
    await controller.stop();
  });

  it("honors the COLLECTION_ENABLED kill switch: no task, apply/reset rejected", async () => {
    const starter = fakeStarter();
    const controller = makeController(starter, { COLLECTION_ENABLED: "false" });
    const status = await controller.boot();
    expect(status.enabled).toBe(false);
    expect(starter.tasks).toHaveLength(0);
    for (const call of [
      () => controller.apply({ enabled: true, cron: "* * * * *" }),
      () => controller.reset(),
    ]) {
      const error = await call().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("SCHEDULER_DISABLED");
      expect((error as AppError).status).toBe(409);
    }
    expect(await findSchedulerSetting(needDb(), "collection")).toBeUndefined();
    await controller.stop();
  });

  it("reconciles external row edits without an admin call", async () => {
    const starter = fakeStarter();
    const controller = makeController(starter, {}, 25);
    await controller.boot();
    expect(starter.tasks).toHaveLength(1);
    // Simulate another instance (or hand SQL) editing the row.
    await upsertSchedulerSetting(needDb(), "collection", {
      enabled: true,
      cron: "0 9 * * *",
      timezone: "UTC",
    });
    const deadline = Date.now() + 3000;
    let status = await controller.status();
    while (status.source !== "database" && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      status = await controller.status();
    }
    expect(status).toMatchObject({
      enabled: true,
      source: "database",
      cron: "0 9 * * *",
      timezone: "UTC",
    });
    expect(starter.tasks).toHaveLength(2);
    expect(starter.tasks[0]?.stopped).toBe(true);
    expect(starter.tasks[1]?.cfg.COLLECTION_CRON).toBe("0 9 * * *");
    await controller.stop();
  });

  it("reports running/lastRun from collection_runs", async () => {
    const starter = fakeStarter();
    const controller = makeController(starter);
    await controller.boot();
    let status = await controller.status();
    expect(status.running).toBe(false);
    expect(status.lastRun).toBeNull();

    const run = await createRun(needDb());
    status = await controller.status();
    expect(status.running).toBe(true);
    expect(status.lastRun).toMatchObject({ id: run.id, status: "running" });

    await completeRun(needDb(), run.id, {
      programsSeen: 1,
      assetsSeen: 1,
      programsAdded: 0,
      assetsAdded: 0,
      assetsRemoved: 0,
    });
    status = await controller.status();
    expect(status.running).toBe(false);
    expect(status.lastRun?.status).toBe("completed");
    await controller.stop();
  });
});

describe("admin scheduler HTTP routes", () => {
  const store: ProgramStore = {
    listPrograms: async () => ({ items: [], total: 0 }),
    findProgramById: async () => undefined,
    listAssets: async () => ({ items: [], total: 0 }),
    listChanges: async () => ({ items: [], total: 0 }),
  };

  function appWith(configOverrides: Record<string, string>) {
    const starter = fakeStarter();
    const config = testConfig(configOverrides);
    const controller = createSchedulerController({
      config,
      pool: {} as Pool,
      db: needDb(),
      logger,
      startTask: starter.startTask,
      reconcileMs: 0,
    });
    const service = createAdminService({
      config,
      pool: {} as Pool,
      logger,
      db: needDb(),
      scheduler: controller,
    });
    const app = createApp({ store, logger, config, adminService: service });
    return { app, controller, starter };
  }

  it("exposes GET/PUT/DELETE behind the admin key", async () => {
    const { app, controller, starter } = appWith({});
    await controller.boot();

    const unauthorized = await request(app).get("/api/v1/admin/scheduler").expect(401);
    expect(unauthorized.body.error.code).toBe("UNAUTHORIZED");

    const get = await request(app)
      .get("/api/v1/admin/scheduler")
      .set("x-admin-key", ADMIN_KEY)
      .expect(200);
    expect(get.body.data).toMatchObject({ enabled: true, source: "environment" });

    const put = await request(app)
      .put("/api/v1/admin/scheduler")
      .set("x-admin-key", ADMIN_KEY)
      .send({ enabled: true, cron: "*/10 * * * *", timezone: "Asia/Kolkata" })
      .expect(200);
    expect(put.body.data).toMatchObject({ source: "database", cron: "*/10 * * * *" });

    const empty = await request(app)
      .put("/api/v1/admin/scheduler")
      .set("x-admin-key", ADMIN_KEY)
      .send({})
      .expect(400);
    expect(empty.body.error.code).toBe("BAD_REQUEST");

    const badCron = await request(app)
      .put("/api/v1/admin/scheduler")
      .set("x-admin-key", ADMIN_KEY)
      .send({ cron: "*/30 * * * * *" })
      .expect(400);
    expect(badCron.body.error.code).toBe("BAD_REQUEST");

    const del = await request(app)
      .delete("/api/v1/admin/scheduler")
      .set("x-admin-key", ADMIN_KEY)
      .expect(200);
    expect(del.body.data).toMatchObject({ source: "environment" });
    expect(await findSchedulerSetting(needDb(), "collection")).toBeUndefined();

    await controller.stop();
    expect(starter.tasks.length).toBeGreaterThan(0);
  });

  it("returns SCHEDULER_DISABLED (409) when the kill switch is off", async () => {
    const { app, controller } = appWith({ COLLECTION_ENABLED: "false" });
    await controller.boot();

    const get = await request(app)
      .get("/api/v1/admin/scheduler")
      .set("x-admin-key", ADMIN_KEY)
      .expect(200);
    expect(get.body.data.enabled).toBe(false);

    const put = await request(app)
      .put("/api/v1/admin/scheduler")
      .set("x-admin-key", ADMIN_KEY)
      .send({ enabled: true })
      .expect(409);
    expect(put.body.error.code).toBe("SCHEDULER_DISABLED");

    const del = await request(app)
      .delete("/api/v1/admin/scheduler")
      .set("x-admin-key", ADMIN_KEY)
      .expect(409);
    expect(del.body.error.code).toBe("SCHEDULER_DISABLED");
    await controller.stop();
  });
});
