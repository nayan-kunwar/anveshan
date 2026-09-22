import type { MailMessage, SendMailFn } from "./types.js";
import { MAIL_TIMEOUT_MS } from "./types.js";

export const BREVO_DEFAULT_API_URL = "https://api.brevo.com/v3";

export interface BrevoConfig {
  apiKey: string;
  apiUrl?: string | undefined;
}

interface BrevoErrorBody {
  code?: string;
  message?: string;
}

/**
 * Brevo transactional mail over HTTP (POST /v3/smtp/email).
 * Uses native fetch — no SDK dependency.
 */
export function createBrevoMailer(
  config: BrevoConfig,
  from: string,
  timeoutMs: number = MAIL_TIMEOUT_MS,
): SendMailFn {
  if (!config.apiKey) {
    throw new Error("Brevo mailer requires an API key");
  }
  const base = (config.apiUrl ?? BREVO_DEFAULT_API_URL).replace(/\/+$/, "");
  const url = `${base}/smtp/email`;

  return async (message: MailMessage): Promise<void> => {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "api-key": config.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: { email: from },
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new Error(`Brevo send timed out after ${timeoutMs}ms`, { cause: error });
      }
      throw error;
    }

    if (res.ok) return;

    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as BrevoErrorBody;
      if (body.message) detail = `${detail}: ${body.message}`;
      else if (body.code) detail = `${detail}: ${body.code}`;
    } catch {
      // non-JSON error body — keep status only
    }
    throw new Error(`Brevo send failed (${detail})`);
  };
}
