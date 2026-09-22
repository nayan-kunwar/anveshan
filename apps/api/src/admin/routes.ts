import type { AppConfig } from "@anveshan/config";
import type { CollectionRunRow, Database } from "@anveshan/database";
import { findRunById, listRecentRuns } from "@anveshan/database";
import type { Request, Response } from "express";
import type { Pool } from "pg";
import type { Logger } from "pino";
import type { z } from "zod";
import { runCollection } from "../collection/service.js";
import type { CollectionSummary } from "../collection/service.js";
import { AppError } from "../errors.js";
import { enqueueAfterCollection } from "../notifications/enqueue.js";
import { adminRecentRunsQuerySchema, programIdParamSchema } from "../validation.js";

function parseAdminQuery<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw AppError.badRequest("Invalid query parameters");
  }
  return parsed.data as z.infer<T>;
}

export interface AdminRunDto {
  id: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  programsSeen: number;
  assetsSeen: number;
  programsAdded: number;
  assetsAdded: number;
  assetsRemoved: number;
  errorCode: string | null;
  errorMessage: string | null;
}

export function toAdminRunDto(row: CollectionRunRow): AdminRunDto {
  return {
    id: row.id,
    status: row.status,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    programsSeen: row.programsSeen,
    assetsSeen: row.assetsSeen,
    programsAdded: row.programsAdded,
    assetsAdded: row.assetsAdded,
    assetsRemoved: row.assetsRemoved,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
  };
}

export interface AdminServiceDeps {
  config: AppConfig;
  pool: Pool;
  logger: Logger;
  db: Database;
  /** Injected in tests; defaults to the real collection + enqueue chain. */
  runOnce?: () => Promise<CollectionSummary>;
}

export interface TriggerResult {
  status: "running" | "skipped";
  startedAt: string;
}

export interface AdminService {
  trigger(): Promise<TriggerResult>;
  recent(limit: number): Promise<AdminRunDto[]>;
  find(id: string): Promise<AdminRunDto | undefined>;
}

/**
 * Manual collection trigger. Async by design: a full run takes 15-20
 * minutes, far beyond any HTTP timeout, so POST returns 202 immediately
 * and the run proceeds in the background. Single-flight per process via
 * an in-memory flag; the collection advisory lock remains the real
 * guard (a trigger that loses the lock finishes as `skipped`).
 */
export function createAdminService(deps: AdminServiceDeps): AdminService {
  const { config, pool, logger, db } = deps;
  const runOnce =
    deps.runOnce ??
    (async (): Promise<CollectionSummary> => {
      const summary = await runCollection({ config, pool, logger });
      await enqueueAfterCollection({ db, config, logger }, summary);
      return summary;
    });

  let inFlight = false;

  return {
    trigger: async (): Promise<TriggerResult> => {
      if (inFlight) {
        logger.warn("admin collection trigger skipped (already in flight)");
        return { status: "skipped", startedAt: new Date().toISOString() };
      }
      inFlight = true;
      const startedAt = new Date().toISOString();
      logger.info("admin collection triggered");
      setImmediate(() => {
        runOnce()
          .then((summary) => {
            logger.info(
              { status: summary.status, runId: summary.runId },
              "admin collection finished",
            );
          })
          .catch((error: unknown) => {
            logger.error({ err: error }, "admin collection crashed");
          })
          .finally(() => {
            inFlight = false;
          });
      });
      return { status: "running", startedAt };
    },

    recent: async (limit: number): Promise<AdminRunDto[]> => {
      const rows = await listRecentRuns(db, limit);
      return rows.map(toAdminRunDto);
    },

    find: async (id: string): Promise<AdminRunDto | undefined> => {
      const row = await findRunById(db, id);
      return row ? toAdminRunDto(row) : undefined;
    },
  };
}

export function createAdminRoutes(service: AdminService): {
  triggerCollections: (req: Request, res: Response) => Promise<void>;
  listCollections: (req: Request, res: Response) => Promise<void>;
  getCollection: (req: Request, res: Response) => Promise<void>;
} {
  return {
    triggerCollections: async (_req, res) => {
      const result = await service.trigger();
      res.status(result.status === "running" ? 202 : 200).json({ data: result });
    },

    listCollections: async (req, res) => {
      const query = parseAdminQuery(adminRecentRunsQuerySchema, req.query);
      res.json({ data: await service.recent(query.limit) });
    },

    getCollection: async (req, res) => {
      const params = parseAdminQuery(programIdParamSchema, req.params);
      // programIdParamSchema validates an `id` UUID path param.
      const run = await service.find(params.id);
      if (!run) throw new AppError("RUN_NOT_FOUND", "Collection run not found", 404);
      res.json({ data: run });
    },
  };
}
