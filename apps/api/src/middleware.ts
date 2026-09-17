import type { NextFunction, Request, Response } from "express";
import type { Logger } from "pino";
import { AppError, statusFor } from "./errors.js";
import type { ErrorCode } from "./errors.js";

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(400).json({ error: { code: "BAD_REQUEST", message: "Unknown route" } });
}

export function errorHandler(logger: Logger) {
  // Express requires a 4-arg signature; `error` is intentionally unknown-shaped.
  return (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (error instanceof AppError) {
      res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message } });
      return;
    }
    const code: ErrorCode = "INTERNAL";
    logger.error({ err: error }, "Unhandled request error");
    res
      .status(statusFor(code))
      .json({ error: { code, message: "Internal server error" } });
  };
}

export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
