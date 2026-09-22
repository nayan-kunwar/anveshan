export type ErrorCode =
  | "PROGRAM_NOT_FOUND"
  | "RUN_NOT_FOUND"
  | "BAD_REQUEST"
  | "INTERNAL"
  | "COLLECTION_FAILED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "TIMEOUT"
  | "UNAUTHORIZED"
  | "INVALID_TOKEN"
  | "EMAIL_RATE_LIMITED";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status: number) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }

  static programNotFound(): AppError {
    return new AppError("PROGRAM_NOT_FOUND", "Program not found", 404);
  }

  static badRequest(message: string): AppError {
    return new AppError("BAD_REQUEST", message, 400);
  }

  static internal(): AppError {
    return new AppError("INTERNAL", "Internal server error", 500);
  }

  static unauthorized(message = "Unauthorized"): AppError {
    return new AppError("UNAUTHORIZED", message, 401);
  }

  static invalidToken(message = "Invalid or expired token"): AppError {
    return new AppError("INVALID_TOKEN", message, 401);
  }

  static emailRateLimited(message = "Too many requests"): AppError {
    return new AppError("EMAIL_RATE_LIMITED", message, 429);
  }
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  PROGRAM_NOT_FOUND: 404,
  RUN_NOT_FOUND: 404,
  BAD_REQUEST: 400,
  INTERNAL: 500,
  COLLECTION_FAILED: 502,
  AUTH_FAILED: 502,
  RATE_LIMITED: 502,
  NETWORK: 502,
  TIMEOUT: 504,
  UNAUTHORIZED: 401,
  INVALID_TOKEN: 401,
  EMAIL_RATE_LIMITED: 429,
};

export function statusFor(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}
