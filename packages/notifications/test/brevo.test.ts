import { afterEach, describe, expect, it, vi } from "vitest";
import { BREVO_DEFAULT_API_URL, createBrevoMailer } from "../src/brevo.js";

const MESSAGE = {
  to: "user@example.com",
  subject: "[Anveshan] Sign in",
  text: "Sign in here: https://example.com/link",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createBrevoMailer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("throws when apiKey is missing", () => {
    expect(() => createBrevoMailer({ apiKey: "" }, "from@example.com")).toThrow(
      /API key/,
    );
  });

  it("POSTs the Brevo send payload and resolves on 201", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { messageId: "mid" }));
    vi.stubGlobal("fetch", fetchMock);

    const send = createBrevoMailer({ apiKey: "k" }, "noreply@example.com");
    await send(MESSAGE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BREVO_DEFAULT_API_URL}/smtp/email`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["api-key"]).toBe("k");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { email: "noreply@example.com" },
      to: [{ email: "user@example.com" }],
      subject: MESSAGE.subject,
      textContent: MESSAGE.text,
    });
  });

  it("honours a custom apiUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, {}));
    vi.stubGlobal("fetch", fetchMock);

    const send = createBrevoMailer(
      { apiKey: "k", apiUrl: "https://brevo.test/v3/" },
      "from@example.com",
    );
    await send(MESSAGE);

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://brevo.test/v3/smtp/email");
  });

  it("rejects with the Brevo error message on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(401, { code: "failed_authentication", message: "Bad API key" }),
      ),
    );

    const send = createBrevoMailer({ apiKey: "bad" }, "from@example.com");
    await expect(send(MESSAGE)).rejects.toThrow(/Brevo send failed \(HTTP 401: Bad API key\)/);
  });

  it("maps AbortSignal timeout to a clear timeout error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" }),
      ),
    );

    const send = createBrevoMailer({ apiKey: "k" }, "from@example.com", 10_000);
    await expect(send(MESSAGE)).rejects.toThrow(/Brevo send timed out after 10000ms/);
  });
});
