export {
  SMTP_TIMEOUT_MS,
  createFakeSendMail,
  createMailTransport,
  createSendMail,
} from "./smtp.js";
export type { MailMessage, SendMailFn, SmtpConfig } from "./smtp.js";
export { MAIL_TIMEOUT_MS } from "./types.js";
export type {
  BrevoMailerOptions,
  MailerConfig,
  MailProvider,
  SmtpMailerOptions,
} from "./types.js";
export { BREVO_DEFAULT_API_URL, createBrevoMailer } from "./brevo.js";
export type { BrevoConfig } from "./brevo.js";
export { createMailer } from "./mailer.js";
export { formatDigestDate, renderDaily, renderImmediate } from "./templates.js";
export type { RenderedMail, RenderOptions, TemplateChange } from "./templates.js";
export { isValidTimezone, lastClose, nextClose, parseDigestTime } from "./digest-time.js";
export type { DigestWallTime } from "./digest-time.js";
export { utcDateString } from "./digest-time.js";
