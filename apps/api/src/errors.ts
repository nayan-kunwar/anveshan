export type ErrorCode =
  | "PROGRAM_NOT_FOUND"
  | "BAD_REQUEST"
  | "INTERNAL"
  | "COLLECTION_FAILED"
  | "AUTH_FAILED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "TIMEOUT";

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
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  PROGRAM_NOT_FOUND: 404,
  BAD_REQUEST: 400,
  INTERNAL: 500,
  COLLECTION_FAILED: 502,
  AUTH_FAILED: 502,
  RATE_LIMITED: 502,
  NETWORK: 502,
  TIMEOUT: 504,
};

export function statusFor(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}
