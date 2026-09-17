import { CollectorError } from "./errors.js";
import { programsResponseSchema, scopesResponseSchema } from "./hackeroneSchemas.js";
import type { ProgramsResponse, ScopesResponse } from "./hackeroneSchemas.js";
import type { ZodType } from "zod";

export type FetchFn = typeof fetch;

export interface HackerOneLogger {
  warn(message: string, ...args: unknown[]): void;
}

const noopLogger: HackerOneLogger = { warn: () => undefined };

export interface HackerOneClientOptions {
  baseUrl: string;
  username: string;
  apiToken: string;
  /** Per-request timeout. Default 15000. */
  timeoutMs?: number;
  /** Minimum gap between requests (throttle). Default 1500. */
  minDelayMs?: number;
  /** Base for exponential backoff. Default 1000. Tests use ~1ms. */
  retryBaseMs?: number;
  /** Max retries on 429. Default 5. */
  maxRateLimitRetries?: number;
  /** Max retries on 5xx / network. Default 3. */
  maxRetryableRetries?: number;
  /** Page size for all list calls. Default 100 (HackerOne max). */
  pageSize?: number;
  /**
   * Collected-object threshold after which scope pagination switches to
   * `filter[id__gt]` cursor mode. HackerOne caps page params at 10,000
   * scopes; default 10000. Tests inject a small value.
   */
  cursorThreshold?: number;
  fetchFn?: FetchFn;
  logger?: HackerOneLogger;
}

interface ProgramItem {
  id: string;
  handle: string;
  name: string;
}

export interface ScopeItem {
  id: string;
  assetType: unknown;
  assetIdentifier: unknown;
  eligibleForBounty: boolean;
}

function basicAuth(username: string, apiToken: string): string {
  return `Basic ${Buffer.from(`${username}:${apiToken}`, "utf8").toString("base64")}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(baseMs: number, attempt: number): number {
  const capped = Math.min(baseMs * 2 ** attempt, 30000);
  return capped + Math.floor(Math.random() * Math.min(capped, 1000));
}

export class HackerOneClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutMs: number;
  private readonly minDelayMs: number;
  private readonly retryBaseMs: number;
  private readonly maxRateLimitRetries: number;
  private readonly maxRetryableRetries: number;
  private readonly pageSize: number;
  private readonly cursorThreshold: number;
  private readonly fetchFn: FetchFn;
  private readonly logger: HackerOneLogger;
  private lastRequestAt = 0;

  constructor(options: HackerOneClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.authHeader = basicAuth(options.username, options.apiToken);
    this.timeoutMs = options.timeoutMs ?? 15000;
    this.minDelayMs = options.minDelayMs ?? 1500;
    this.retryBaseMs = options.retryBaseMs ?? 1000;
    this.maxRateLimitRetries = options.maxRateLimitRetries ?? 5;
    this.maxRetryableRetries = options.maxRetryableRetries ?? 3;
    this.pageSize = options.pageSize ?? 100;
    this.cursorThreshold = options.cursorThreshold ?? 10000;
    this.fetchFn = options.fetchFn ?? fetch;
    this.logger = options.logger ?? noopLogger;
  }

  /** All programs visible to the credential (paginated). */
  async listPrograms(): Promise<ProgramItem[]> {
    const items: ProgramItem[] = [];
    let page = 1;
    for (;;) {
      const url =
        `${this.baseUrl}/programs?page[size]=${this.pageSize}` + `&page[number]=${page}`;
      const body = await this.request(url, "programs");
      const parsed = this.parse(programsResponseSchema, body, url, "programs");
      for (const item of parsed.data) {
        const handle = item.attributes.handle.trim();
        const name = item.attributes.name.trim();
        if (!handle || !name) {
          this.logger.warn("Skipping program with missing handle/name");
          continue;
        }
        items.push({ id: String(item.id), handle, name });
      }
      if (!this.hasNext(parsed, this.pageSize)) break;
      page += 1;
      if (page > 5000) {
        throw new CollectorError(
          "COLLECTION_FAILED",
          "Program pagination exceeded 5000 pages — aborting",
          { endpoint: "programs" },
        );
      }
    }
    return items;
  }

  /** All structured scopes for one program handle (page loop, then id cursor). */
  async listScopes(programHandle: string): Promise<ScopeItem[]> {
    const endpoint = `programs/${programHandle}/structured_scopes`;
    const seen = new Map<string, ScopeItem>();

    // Phase 1: page[number] loop.
    let page = 1;
    for (;;) {
      const url =
        `${this.baseUrl}/${endpoint}?page[size]=${this.pageSize}` +
        `&page[number]=${page}`;
      const body = await this.request(url, endpoint);
      const parsed = this.parse(scopesResponseSchema, body, url, endpoint);
      this.collectScopes(parsed, seen);
      if (!this.hasNext(parsed, this.pageSize)) return [...seen.values()];
      if (seen.size >= this.cursorThreshold) break;
      page += 1;
    }

    // Phase 2: cursor mode past the page-param cap.
    let cursor = maxNumericId(seen.keys());
    let cursorPages = 0;
    for (;;) {
      const url =
        `${this.baseUrl}/${endpoint}?page[size]=${this.pageSize}` +
        `&filter[id__gt]=${encodeURIComponent(cursor)}`;
      const body = await this.request(url, endpoint);
      const parsed = this.parse(scopesResponseSchema, body, url, endpoint);
      const before = seen.size;
      this.collectScopes(parsed, seen);
      if (parsed.data.length < this.pageSize || seen.size === before) break;
      cursor = maxNumericId(seen.keys());
      cursorPages += 1;
      if (cursorPages > 5000) {
        throw new CollectorError(
          "COLLECTION_FAILED",
          `Scope cursor pagination exceeded 5000 pages for ${programHandle} — aborting`,
          { endpoint },
        );
      }
    }
    return [...seen.values()];
  }

  private collectScopes(parsed: ScopesResponse, seen: Map<string, ScopeItem>): void {
    for (const item of parsed.data) {
      const id = String(item.id);
      if (seen.has(id)) continue;
      seen.set(id, {
        id,
        assetType: item.attributes.asset_type,
        assetIdentifier: item.attributes.asset_identifier,
        eligibleForBounty: item.attributes.eligible_for_bounty === true,
      });
    }
  }

  private hasNext(parsed: ProgramsResponse | ScopesResponse, pageSize: number): boolean {
    if (parsed.links?.next) return true;
    return parsed.data.length === pageSize;
  }

  private parse<T>(schema: ZodType<T>, body: unknown, url: string, endpoint: string): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new CollectorError(
        "COLLECTION_FAILED",
        `Malformed HackerOne response at ${endpoint}: missing data array`,
        { endpoint: this.pathOf(url) },
      );
    }
    return parsed.data;
  }

  private pathOf(url: string): string {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }

  private async request(url: string, endpoint: string): Promise<unknown> {
    // Throttle: minimum gap between requests (sequential, concurrency 1).
    const wait = this.minDelayMs - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);

    let rateLimitAttempts = 0;
    let retryableAttempts = 0;
    for (;;) {
      this.lastRequestAt = Date.now();
      let response: Response;
      try {
        response = await this.fetchWithTimeout(url);
      } catch (error) {
        if (error instanceof CollectorError && error.code === "TIMEOUT") {
          retryableAttempts += 1;
          if (retryableAttempts > this.maxRetryableRetries) throw error;
          await sleep(backoffMs(this.retryBaseMs, retryableAttempts));
          continue;
        }
        retryableAttempts += 1;
        if (retryableAttempts > this.maxRetryableRetries) {
          throw new CollectorError("NETWORK", `Network failure calling ${endpoint}`, {
            endpoint: this.pathOf(url),
          });
        }
        await sleep(backoffMs(this.retryBaseMs, retryableAttempts));
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        throw new CollectorError(
          "AUTH_FAILED",
          `HackerOne rejected credentials (HTTP ${response.status}) at ${endpoint}`,
          { status: response.status, endpoint: this.pathOf(url) },
        );
      }
      if (response.status === 429) {
        rateLimitAttempts += 1;
        if (rateLimitAttempts > this.maxRateLimitRetries) {
          throw new CollectorError(
            "RATE_LIMITED",
            `HackerOne rate limit persisted at ${endpoint} after ${this.maxRateLimitRetries} retries`,
            { status: 429, endpoint: this.pathOf(url) },
          );
        }
        await sleep(this.retryAfterMs(response));
        continue;
      }
      if (response.status >= 500) {
        retryableAttempts += 1;
        if (retryableAttempts > this.maxRetryableRetries) {
          throw new CollectorError(
            "COLLECTION_FAILED",
            `HackerOne server error (HTTP ${response.status}) at ${endpoint}`,
            { status: response.status, endpoint: this.pathOf(url) },
          );
        }
        await sleep(backoffMs(this.retryBaseMs, retryableAttempts));
        continue;
      }
      if (!response.ok) {
        throw new CollectorError(
          "COLLECTION_FAILED",
          `HackerOne request failed (HTTP ${response.status}) at ${endpoint}`,
          { status: response.status, endpoint: this.pathOf(url) },
        );
      }
      try {
        const body: unknown = await response.json();
        return body;
      } catch {
        throw new CollectorError(
          "COLLECTION_FAILED",
          `Invalid JSON from HackerOne at ${endpoint}`,
          { endpoint: this.pathOf(url) },
        );
      }
    }
  }

  private retryAfterMs(response: Response): number {
    const header = response.headers.get("retry-after");
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    }
    return backoffMs(this.retryBaseMs, 1);
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new CollectorError("TIMEOUT", "HackerOne request timed out", {
            endpoint: this.pathOf(url),
          }),
        );
      }, this.timeoutMs);
    });
    try {
      // Single timer drives both abort and rejection: no dangling rejection
      // if the fetch wins the race, because the timer is cleared in finally.
      return await Promise.race([
        this.fetchFn(url, {
          headers: { Accept: "application/json", Authorization: this.authHeader },
          signal: controller.signal,
        }),
        timeout,
      ]);
    } catch (error) {
      if (error instanceof CollectorError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new CollectorError("TIMEOUT", "HackerOne request timed out", {
          endpoint: this.pathOf(url),
        });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

function maxNumericId(ids: Iterable<string>): string {
  let max = "0";
  let maxNum = 0;
  for (const id of ids) {
    const n = Number(id);
    if (Number.isFinite(n) && n > maxNum) {
      maxNum = n;
      max = id;
    } else if (max === "0" && !Number.isFinite(n)) {
      max = id;
    }
  }
  return max;
}
