import type { NextFunction, Request, Response } from "express";
import type { Database } from "@anveshan/database";
import { deleteSessionByHash, findSessionByHash, findUserById } from "@anveshan/database";
import { AppError } from "../errors.js";
import { hashSessionToken } from "./tokens.js";

export const SESSION_COOKIE = "session";

export interface SessionUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface AuthenticatedRequest extends Request {
  user: SessionUser;
}

/** Manual Cookie header parse — no cookie-parser dependency. */
export function parseSessionCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === SESSION_COOKIE) {
      const value = part.slice(idx + 1).trim();
      if (!value) return undefined;
      try {
        return decodeURIComponent(value);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function setSessionCookie(
  res: Response,
  rawToken: string,
  maxAgeSec: number,
  secure: boolean,
): void {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(rawToken)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
}

export interface RequireSessionDeps {
  db: Database;
  /** Undefined when SESSION_SECRET is unset — every request is UNAUTHORIZED. */
  sessionSecret: string | undefined;
}

/**
 * Session gate. Missing secret, missing/invalid cookie, unknown row, or
 * expired row (deleted on read + cookie cleared) → UNAUTHORIZED.
 */
export function createRequireSession(deps: RequireSessionDeps) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!deps.sessionSecret) {
        throw AppError.unauthorized();
      }
      const rawToken = parseSessionCookie(req);
      if (!rawToken) {
        throw AppError.unauthorized();
      }
      const session = await findSessionByHash(
        deps.db,
        hashSessionToken(rawToken, deps.sessionSecret),
      );
      if (!session) {
        throw AppError.unauthorized();
      }
      if (session.expiresAt.getTime() <= Date.now()) {
        await deleteSessionByHash(deps.db, session.tokenHash);
        clearSessionCookie(res);
        throw AppError.unauthorized("Session expired");
      }
      const user = await findUserById(deps.db, session.userId);
      if (!user) {
        throw AppError.unauthorized();
      }
      (req as AuthenticatedRequest).user = {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
      };
      next();
    } catch (error) {
      next(error);
    }
  };
}
