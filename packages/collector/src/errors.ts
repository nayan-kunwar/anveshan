export type CollectorErrorCode =
  "AUTH_FAILED" | "RATE_LIMITED" | "NETWORK" | "TIMEOUT" | "COLLECTION_FAILED";

/**
 * Classified collector failure. Never carries credentials —
 * only the endpoint path, attempt count, and HTTP status.
 */
export class CollectorError extends Error {
  readonly code: CollectorErrorCode;
  readonly status: number | undefined;
  readonly endpoint: string | undefined;

  constructor(
    code: CollectorErrorCode,
    message: string,
    options?: { status?: number; endpoint?: string },
  ) {
    super(message);
    this.name = "CollectorError";
    this.code = code;
    this.status = options?.status;
    this.endpoint = options?.endpoint;
  }
}
