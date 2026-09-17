export {
  SMTP_TIMEOUT_MS,
  createFakeSendMail,
  createMailTransport,
  createSendMail,
} from "./smtp.js";
export type { MailMessage, SendMailFn, SmtpConfig } from "./smtp.js";
export { formatDigestDate, renderDaily, renderImmediate } from "./templates.js";
export type { RenderedMail, RenderOptions, TemplateChange } from "./templates.js";
