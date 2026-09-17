import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CollectorError, HackerOneClient, HackerOneCollector } from "../src/index.js";
import type { FetchFn } from "../src/index.js";

function fixture(name: string): unknown {
  const raw = readFileSync(
    new URL(`./fixtures/hackerone/${name}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(raw) as unknown;
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function urlString(url: Parameters<FetchFn>[0]): string {
  if (typeof url === "string") return url;
  if (url instanceof URL) return url.toString();
  return url.url;
}

function clientWith(
  fetchFn: FetchFn,
  overrides: Record<string, unknown> = {},
): HackerOneClient {
  return new HackerOneClient({
    baseUrl: "https://api.hackerone.com/v1/hackers",
    username: "user",
    apiToken: "token",
    minDelayMs: 0,
    retryBaseMs: 1,
    timeoutMs: 1000,
    fetchFn,
    ...overrides,
  });
}

describe("HackerOneClient programs", () => {
  it("paginates all program pages and stops at the last page", async () => {
    const fetchFn: FetchFn = async (url) => {
      const u = urlString(url);
      if (u.includes("page%5Bnumber%5D=2") || u.includes("page[number]=2")) {
        return jsonResponse(fixture("programs-page-2.json"));
      }
      return jsonResponse(fixture("programs-page-1.json"));
    };
    const client = clientWith(fetchFn);
    const collector = new HackerOneCollector(client);
    const programs = await collector.getPrograms();
    expect(programs.map((p) => p.externalId)).toEqual(["acme", "globex", "initech"]);
    expect(programs[0]).toMatchObject({
      name: "Acme Corp",
      platform: "hackerone",
      url: "https://hackerone.com/acme",
      externalNumericId: "1001",
    });
  });

  it("sends Basic auth and Accept headers", async () => {
    let captured: Headers | undefined;
    const fetchFn: FetchFn = (url, init) => {
      captured = new Headers(init?.headers);
      return Promise.resolve(jsonResponse(fixture("programs-page-2.json")));
    };
    await clientWith(fetchFn).listPrograms();
    expect(captured?.get("Accept")).toBe("application/json");
    expect(captured?.get("Authorization")).toMatch(/^Basic /);
    const decoded = Buffer.from(
      (captured?.get("Authorization") ?? "").slice(6),
      "base64",
    ).toString();
    expect(decoded).toBe("user:token");
  });

  it("maps 401 to AUTH_FAILED", async () => {
    const fetchFn: FetchFn = async () => jsonResponse(fixture("error-401.json"), 401);
    const error = await clientWith(fetchFn)
      .listPrograms()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CollectorError);
    expect((error as CollectorError).code).toBe("AUTH_FAILED");
  });

  it("maps malformed bodies to COLLECTION_FAILED", async () => {
    const fetchFn: FetchFn = async () => jsonResponse({ unexpected: true });
    const error = await clientWith(fetchFn)
      .listPrograms()
      .catch((e: unknown) => e);
    expect((error as CollectorError).code).toBe("COLLECTION_FAILED");
  });
});

describe("HackerOneClient scopes", () => {
  it("normalizes mixed IN/OUT scopes and canonicalizes identifiers", async () => {
    const fetchFn: FetchFn = async () => jsonResponse(fixture("scopes-mixed.json"));
    const collector = new HackerOneCollector(clientWith(fetchFn));
    const assets = await collector.getProgramAssets("acme");
    expect(assets).toHaveLength(5);
    const byExternalId = new Map(assets.map((a) => [a.externalId, a]));
    expect(byExternalId.get("5001")).toMatchObject({
      identifier: "https://example.com/app",
      type: "URL",
      scope: "IN",
    });
    expect(byExternalId.get("5002")).toMatchObject({ type: "WILDCARD", scope: "IN" });
    expect(byExternalId.get("5003")).toMatchObject({ type: "CIDR", scope: "IN" });
    expect(byExternalId.get("5004")).toMatchObject({ type: "DOMAIN", scope: "OUT" });
    expect(byExternalId.get("5005")).toMatchObject({ type: "OTHER", scope: "OUT" });
  });

  it("returns [] for empty scope pages", async () => {
    const fetchFn: FetchFn = async () => jsonResponse(fixture("scopes-empty.json"));
    const collector = new HackerOneCollector(clientWith(fetchFn));
    await expect(collector.getProgramAssets("acme")).resolves.toEqual([]);
  });

  it("drops scopes with missing identifiers and maps unknown types to OTHER", async () => {
    const fetchFn: FetchFn = async () =>
      jsonResponse({
        data: [
          {
            id: "1",
            attributes: { asset_type: "FUTURE_TYPE", eligible_for_bounty: true },
          },
          {
            id: "2",
            attributes: {
              asset_type: "FUTURE_TYPE",
              asset_identifier: "x",
              eligible_for_bounty: true,
            },
          },
        ],
        links: {},
      });
    const warnings: string[] = [];
    const collector = new HackerOneCollector(clientWith(fetchFn), {
      warn: (m: string) => warnings.push(m),
    });
    const assets = await collector.getProgramAssets("acme");
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ type: "OTHER", scope: "IN" });
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("retries 429 honoring Retry-After then succeeds", async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls += 1;
      if (calls === 1) {
        return jsonResponse(fixture("error-429.json"), 429, { "Retry-After": "0" });
      }
      return jsonResponse(fixture("scopes-empty.json"));
    };
    const collector = new HackerOneCollector(clientWith(fetchFn));
    await expect(collector.getProgramAssets("acme")).resolves.toEqual([]);
    expect(calls).toBe(2);
  });

  it("fails closed with RATE_LIMITED after repeated 429s", async () => {
    const fetchFn: FetchFn = async () =>
      jsonResponse(fixture("error-429.json"), 429, { "Retry-After": "0" });
    const error = await clientWith(fetchFn, { maxRateLimitRetries: 2 })
      .listScopes("acme")
      .catch((e: unknown) => e);
    expect((error as CollectorError).code).toBe("RATE_LIMITED");
  });

  it("retries 5xx then surfaces COLLECTION_FAILED", async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls += 1;
      if (calls === 1) return new Response("boom", { status: 500 });
      return jsonResponse(fixture("scopes-empty.json"));
    };
    await expect(clientWith(fetchFn).listScopes("acme")).resolves.toEqual([]);
    const always500: FetchFn = async () => new Response("boom", { status: 500 });
    const error = await clientWith(always500, { maxRetryableRetries: 1 })
      .listScopes("acme")
      .catch((e: unknown) => e);
    expect((error as CollectorError).code).toBe("COLLECTION_FAILED");
  });

  it("surfaces TIMEOUT when the API hangs", async () => {
    const hanging: FetchFn = (() => new Promise(() => undefined)) as unknown as FetchFn;
    const error = await clientWith(hanging, { timeoutMs: 20, maxRetryableRetries: 0 })
      .listScopes("acme")
      .catch((e: unknown) => e);
    expect((error as CollectorError).code).toBe("TIMEOUT");
  });

  it("switches to filter[id__gt] cursor past the page cap", async () => {
    const requested: string[] = [];
    const page = (ids: string[], next: boolean): unknown => ({
      data: ids.map((id) => ({
        id,
        attributes: {
          asset_type: "DOMAIN",
          asset_identifier: `h${id}.example.com`,
          eligible_for_bounty: true,
        },
      })),
      links: next ? { next: "https://x/?page=2" } : {},
    });
    const fetchFn: FetchFn = async (url) => {
      const u = urlString(url);
      requested.push(u);
      if (u.includes("filter%5Bid__gt%5D") || u.includes("filter[id__gt]")) {
        return jsonResponse(page(["105"], false));
      }
      if (u.includes("page%5Bnumber%5D=2") || u.includes("page[number]=2")) {
        return jsonResponse(page(["103", "104"], true));
      }
      return jsonResponse(page(["101", "102"], true));
    };
    const client = clientWith(fetchFn, { pageSize: 2, cursorThreshold: 4 });
    const collector = new HackerOneCollector(client);
    const assets = await collector.getProgramAssets("acme");
    expect(assets).toHaveLength(5);
    expect(requested.some((u) => u.includes("id__gt"))).toBe(true);
  });

  it("treats submission-only scopes as OUT", async () => {
    const fetchFn: FetchFn = async () =>
      jsonResponse({
        data: [
          {
            id: "9",
            attributes: {
              asset_type: "DOMAIN",
              asset_identifier: "vdp.example.com",
              eligible_for_bounty: false,
              eligible_for_submission: true,
            },
          },
        ],
        links: {},
      });
    const collector = new HackerOneCollector(clientWith(fetchFn));
    const assets = await collector.getProgramAssets("vdp-program");
    expect(assets[0]?.scope).toBe("OUT");
  });
});

describe("collector logging hygiene", () => {
  it("never sends credentials in error messages", async () => {
    const fetchFn: FetchFn = async () => {
      throw new Error("socket hangup");
    };
    const error = (await clientWith(fetchFn, { maxRetryableRetries: 0 })
      .listPrograms()
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain("token");
  });
});
