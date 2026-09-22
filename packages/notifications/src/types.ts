export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export type SendMailFn = (message: MailMessage) => Promise<void>;

/** Shared send budget — hung sends must never last 10 minutes. */
export const MAIL_TIMEOUT_MS = 10_000;

export type MailProvider = "smtp" | "brevo";

export interface SmtpMailerOptions {
  host: string;
  port?: number | undefined;
  user?: string | undefined;
  pass?: string | undefined;
}

export interface BrevoMailerOptions {
  apiKey: string;
  /** Default https://api.brevo.com/v3 — override in tests/staging. */
  apiUrl?: string | undefined;
}

/**
 * Factory input. Provider-specific blocks are required only for the
 * selected provider; unknown providers throw at createMailer time.
 */
export interface MailerConfig {
  provider: MailProvider;
  from: string;
  smtp?: SmtpMailerOptions | undefined;
  brevo?: BrevoMailerOptions | undefined;
  timeoutMs?: number | undefined;
}
