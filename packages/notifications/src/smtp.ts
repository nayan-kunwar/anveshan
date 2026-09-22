import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { MailMessage, SendMailFn } from "./types.js";
import { MAIL_TIMEOUT_MS } from "./types.js";

/** 10s on every SMTP phase — a hung send must never last 10 minutes. */
export const SMTP_TIMEOUT_MS = MAIL_TIMEOUT_MS;

export type { MailMessage, SendMailFn } from "./types.js";

export interface SmtpConfig {
  host: string;
  port?: number | undefined;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
}

export function createMailTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port ?? 587,
    secure: (config.port ?? 587) === 465,
    auth:
      config.user !== undefined && config.pass !== undefined
        ? { user: config.user, pass: config.pass }
        : undefined,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
}

/**
 * Send one message with an outer timeout. Transport-level timeouts cover
 * the socket phases; the race covers anything else nodemailer awaits.
 */
export function createSendMail(
  transporter: Transporter,
  from: string,
  timeoutMs = SMTP_TIMEOUT_MS,
): SendMailFn {
  return async (message: MailMessage): Promise<void> => {
    const send = transporter.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    const timeout = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`SMTP send timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref();
    });
    await Promise.race([send, timeout]);
  };
}

/** Test seam: capture sent mail without touching SMTP. */
export function createFakeSendMail(sent: MailMessage[]): SendMailFn {
  return async (message: MailMessage): Promise<void> => {
    sent.push(message);
  };
}
