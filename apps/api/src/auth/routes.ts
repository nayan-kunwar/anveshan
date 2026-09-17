import type { AppConfig } from "@anveshan/config";
import type { Database } from "@anveshan/database";
import type { SendMailFn } from "@anveshan/notifications";
import type { Request, Response } from "express";
import type { Logger } from "pino";
import type { z } from "zod";
import { AppError } from "../errors.js";
import {
  requestMagicLinkSchema,
  unsubscribeSchema,
  verifyMagicLinkSchema,
} from "../validation.js";
import {
  clearSessionCookie,
  parseSessionCookie,
  setSessionCookie,
} from "./middleware.js";
import type { RateLimiter } from "./rate-limit.js";
import {
  logoutSession,
  requestMagicLink,
  toUserDto,
  unsubscribeUser,
  verifyMagicLink,
} from "./service.js";
import type { SessionUser } from "./middleware.js";

export interface AuthRouteDeps {
  db: Database;
  config: AppConfig;
  logger: Logger;
  sendMail: SendMailFn;
  ipLimiter: RateLimiter;
  emailLimiter: RateLimiter;
}

function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw AppError.badRequest("Invalid request body");
  }
  return parsed.data as z.infer<T>;
}

/** Secure follows FRONTEND_URL (https), not NODE_ENV — Docker prod can be HTTP. */
function cookieSecure(frontendUrl: string): boolean {
  try {
    return new URL(frontendUrl).protocol === "https:";
  } catch {
    return false;
  }
}

function serviceDeps(deps: AuthRouteDeps) {
  return {
    db: deps.db,
    config: deps.config,
    logger: deps.logger,
    sendMail: deps.sendMail,
  };
}

export function createAuthRoutes(deps: AuthRouteDeps): {
  requestMagicLink: (req: Request, res: Response) => Promise<void>;
  verify: (req: Request, res: Response) => Promise<void>;
  me: (req: Request, res: Response) => Promise<void>;
  logout: (req: Request, res: Response) => Promise<void>;
  unsubscribe: (req: Request, res: Response) => Promise<void>;
} {
  return {
    requestMagicLink: async (req, res) => {
      const body = parseBody(requestMagicLinkSchema, req.body);
      const ip = req.ip ?? "unknown";
      if (
        !deps.ipLimiter.check(ip) ||
        !deps.emailLimiter.check(body.email.toLowerCase())
      ) {
        throw AppError.emailRateLimited();
      }
      await requestMagicLink(serviceDeps(deps), body.email);
      res.status(200).json({ ok: true });
    },

    verify: async (req, res) => {
      const body = parseBody(verifyMagicLinkSchema, req.body);
      const { user, sessionToken } = await verifyMagicLink(serviceDeps(deps), body.token);
      setSessionCookie(
        res,
        sessionToken,
        Math.floor(deps.config.SESSION_EXPIRY / 1000),
        cookieSecure(deps.config.FRONTEND_URL),
      );
      res.status(200).json({ data: user });
    },

    me: async (req, res) => {
      const user = (req as Request & { user: SessionUser }).user;
      res.status(200).json({
        data: toUserDto({
          id: user.id,
          email: user.email,
          emailVerifiedAt: user.emailVerifiedAt,
          createdAt: user.createdAt,
        }),
      });
    },

    logout: async (req, res) => {
      await logoutSession(serviceDeps(deps), parseSessionCookie(req));
      clearSessionCookie(res);
      res.status(200).json({ ok: true });
    },

    unsubscribe: async (req, res) => {
      const body = parseBody(unsubscribeSchema, req.body);
      await unsubscribeUser(serviceDeps(deps), body.userId, body.token);
      res.status(200).json({ ok: true });
    },
  };
}
