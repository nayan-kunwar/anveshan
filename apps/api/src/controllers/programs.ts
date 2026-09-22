import type { Request, Response } from "express";
import type { z } from "zod";
import { AppError } from "../errors.js";
import type { ProgramStore } from "../services/programs.js";
import {
  getProgramOrThrow,
  toAssetDto,
  toChangeDto,
  toProgramDto,
} from "../services/programs.js";
import {
  assetsQuerySchema,
  changesQuerySchema,
  programIdParamSchema,
  programsQuerySchema,
} from "../validation.js";

function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const parsed = schema.safeParse(query);
  if (!parsed.success) {
    throw AppError.badRequest("Invalid query parameters");
  }
  return parsed.data as z.infer<T>;
}

export function createProgramController(store: ProgramStore): {
  listPrograms: (req: Request, res: Response) => Promise<void>;
  getProgram: (req: Request, res: Response) => Promise<void>;
  listAssets: (req: Request, res: Response) => Promise<void>;
  listChanges: (req: Request, res: Response) => Promise<void>;
} {
  return {
    listPrograms: async (req, res) => {
      const query = parseQuery(programsQuerySchema, req.query);
      const q = query.q?.trim() ? query.q.trim() : undefined;
      const { items, total } = await store.listPrograms(query.page, query.pageSize, q);
      res.json({
        data: items.map(toProgramDto),
        pagination: { page: query.page, pageSize: query.pageSize, total },
      });
    },

    getProgram: async (req, res) => {
      const params = parseQuery(programIdParamSchema, req.params);
      const program = await getProgramOrThrow(store, params.id);
      res.json({ data: toProgramDto(program) });
    },

    listAssets: async (req, res) => {
      const params = parseQuery(programIdParamSchema, req.params);
      const query = parseQuery(assetsQuerySchema, req.query);
      await getProgramOrThrow(store, params.id);
      const { items, total } = await store.listAssets(
        params.id,
        query.scope,
        query.page,
        query.pageSize,
      );
      res.json({
        data: items.map(toAssetDto),
        pagination: { page: query.page, pageSize: query.pageSize, total },
      });
    },

    listChanges: async (req, res) => {
      const params = parseQuery(programIdParamSchema, req.params);
      const query = parseQuery(changesQuerySchema, req.query);
      await getProgramOrThrow(store, params.id);
      const since = query.since ? new Date(query.since) : undefined;
      const { items, total } = await store.listChanges(
        params.id,
        since,
        query.page,
        query.pageSize,
      );
      res.json({
        data: items.map(toChangeDto),
        pagination: { page: query.page, pageSize: query.pageSize, total },
      });
    },
  };
}
