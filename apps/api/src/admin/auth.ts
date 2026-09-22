import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { AppError } from "../errors.js";

/** Shared-secret header for manual admin endpoints. Never in the URL. */
export const ADMIN_KEY_HEADER = "x-admin-key";

/**
 * Timing-safe key comparison. Mismatched lengths return false instead of
 * throwing (timingSafeEqual requires equal lengths).
 */
export function isValidAdminKey(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface RequireAdminKeyDeps {
  /** Undefined when ADMIN_API_KEY is unset — every request is UNAUTHORIZED. */
  adminKey: string | undefined;
  logger: Logger;
}

/**
 * Admin gate. Missing env, missing header, or wrong key all yield the
 * same UNAUTHORIZED (no oracle). The key value is never logged.
 */
export function createRequireAdminKey(deps: RequireAdminKeyDeps) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (!deps.adminKey) {
        throw AppError.unauthorized("Admin API disabled");
      }
      const provided = req.header(ADMIN_KEY_HEADER);
      if (!provided || !isValidAdminKey(provided, deps.adminKey)) {
        deps.logger.warn("rejected admin request with invalid key");
        throw AppError.unauthorized();
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
