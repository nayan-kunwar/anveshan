import type { Database, SubscriptionRow } from "@anveshan/database";
import {
  addWatch,
  clearUnsubscribed,
  findProgramById,
  findSubscription,
  listWatches,
  removeWatch,
  upsertSubscription,
} from "@anveshan/database";
import { nextClose } from "@anveshan/notifications";
import type { Request, Response } from "express";
import type { z } from "zod";
import { AppError } from "../errors.js";
import type { SessionUser } from "../auth/middleware.js";
import {
  subscriptionBodySchema,
  watchBodySchema,
  watchParamSchema,
} from "../validation.js";

export interface SubscriptionRouteDeps {
  db: Database;
}

function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw AppError.badRequest("Invalid request body");
  }
  return parsed.data as z.infer<T>;
}

function parseParams<T extends z.ZodTypeAny>(schema: T, params: unknown): z.infer<T> {
  const parsed = schema.safeParse(params);
  if (!parsed.success) {
    throw AppError.badRequest("Invalid path parameters");
  }
  return parsed.data as z.infer<T>;
}

function userIdOf(req: Request): string {
  return (req as Request & { user: SessionUser }).user.id;
}

/**
 * Public subscription shape. digestTimeLocal is minute precision
 * ("HH:MM"); nextDigestAt previews the coming daily close (null for
 * immediate cadence or unusable prefs).
 */
function toSubscriptionResponse(row: SubscriptionRow): {
  frequency: string;
  watchNewPrograms: boolean;
  watchAllPrograms: boolean;
  digestTimezone: string;
  digestTimeLocal: string;
  nextDigestAt: string | null;
  updatedAt: string;
} {
  const nextDigestAt =
    row.frequency === "daily"
      ? (nextClose(new Date(), row.digestTimezone, row.digestTimeLocal)?.toISOString() ??
        null)
      : null;
  return {
    frequency: row.frequency,
    watchNewPrograms: row.watchNewPrograms,
    watchAllPrograms: row.watchAllPrograms,
    digestTimezone: row.digestTimezone,
    digestTimeLocal: row.digestTimeLocal.slice(0, 5),
    nextDigestAt,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createSubscriptionRoutes(deps: SubscriptionRouteDeps): {
  getSubscription: (req: Request, res: Response) => Promise<void>;
  putSubscription: (req: Request, res: Response) => Promise<void>;
  listWatches: (req: Request, res: Response) => Promise<void>;
  addWatch: (req: Request, res: Response) => Promise<void>;
  removeWatch: (req: Request, res: Response) => Promise<void>;
} {
  return {
    getSubscription: async (req, res) => {
      const row = await findSubscription(deps.db, userIdOf(req));
      res.status(200).json({
        data: row ? toSubscriptionResponse(row) : null,
      });
    },

    putSubscription: async (req, res) => {
      const body = parseBody(subscriptionBodySchema, req.body);
      const userId = userIdOf(req);
      const row = await upsertSubscription(deps.db, userId, body);
      // Saving a subscription opts back in after an unsubscribe link.
      await clearUnsubscribed(deps.db, userId);
      res.status(200).json({
        data: toSubscriptionResponse(row),
      });
    },

    listWatches: async (req, res) => {
      const items = await listWatches(deps.db, userIdOf(req));
      res.status(200).json({ data: items });
    },

    addWatch: async (req, res) => {
      const body = parseBody(watchBodySchema, req.body);
      const program = await findProgramById(deps.db, body.programId);
      if (!program) {
        throw AppError.programNotFound();
      }
      await addWatch(deps.db, userIdOf(req), body.programId);
      res.status(200).json({ ok: true });
    },

    removeWatch: async (req, res) => {
      const params = parseParams(watchParamSchema, req.params);
      await removeWatch(deps.db, userIdOf(req), params.programId);
      res.status(200).json({ ok: true });
    },
  };
}
