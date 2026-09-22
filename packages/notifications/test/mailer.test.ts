import { describe, expect, it, vi } from "vitest";
import { createMailer } from "../src/mailer.js";

describe("createMailer", () => {
  it("builds a brevo mailer when provider=brevo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const send = createMailer({
      provider: "brevo",
      from: "noreply@example.com",
      brevo: { apiKey: "k" },
    });
    await send({ to: "a@b.c", subject: "s", text: "t" });
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("builds an smtp mailer when provider=smtp", () => {
    const send = createMailer({
      provider: "smtp",
      from: "noreply@example.com",
      smtp: { host: "smtp.example.com", port: 587, user: "u", pass: "p" },
    });
    expect(typeof send).toBe("function");
  });

  it("throws when brevo is selected without an api key", () => {
    expect(() =>
      createMailer({ provider: "brevo", from: "noreply@example.com" }),
    ).toThrow(/apiKey/);
  });

  it("throws when smtp is selected without a host", () => {
    expect(() =>
      createMailer({ provider: "smtp", from: "noreply@example.com" }),
    ).toThrow(/host/);
  });
});
