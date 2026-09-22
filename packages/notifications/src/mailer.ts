import type { MailerConfig, SendMailFn } from "./types.js";
import { createBrevoMailer } from "./brevo.js";
import { createMailTransport, createSendMail } from "./smtp.js";

/**
 * Single wiring point for all mail providers. Call sites (API boot,
 * mail:test) use this instead of building transports inline — adding a
 * provider is one file + one switch case + config schema.
 */
export function createMailer(config: MailerConfig): SendMailFn {
  switch (config.provider) {
    case "brevo": {
      const brevo = config.brevo;
      if (!brevo?.apiKey) {
        throw new Error("createMailer(brevo): brevo.apiKey is required");
      }
      return createBrevoMailer(
        { apiKey: brevo.apiKey, apiUrl: brevo.apiUrl },
        config.from,
        config.timeoutMs,
      );
    }
    case "smtp": {
      const smtp = config.smtp;
      if (!smtp?.host) {
        throw new Error("createMailer(smtp): smtp.host is required");
      }
      const transport = createMailTransport({
        host: smtp.host,
        port: smtp.port,
        user: smtp.user,
        pass: smtp.pass,
        from: config.from,
      });
      return createSendMail(transport, config.from, config.timeoutMs);
    }
    default: {
      const provider: never = config.provider;
      throw new Error(`Unsupported mail provider: ${String(provider)}`);
    }
  }
}
