import type { AppConfig } from "@anveshan/config";
import pino from "pino";
import type { Logger } from "pino";

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">): Logger {
  return pino({
    level: config.LOG_LEVEL,
    // Defense in depth: never log secrets even if a call site slips.
    redact: {
      paths: [
        "*.apiToken",
        "*.api_token",
        "*.password",
        "*.token",
        "headers.authorization",
        "headers.Authorization",
      ],
      censor: "[REDACTED]",
    },
  });
}
