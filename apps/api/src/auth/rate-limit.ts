/**
 * In-memory sliding-window rate limiter. Sufficient for the single-process
 * MVP (magic-link abuse protection); a multi-process deploy needs Redis.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** True when the call is allowed (and recorded). False when over threshold. */
  check(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

/** 5 magic-link requests per IP per 15 minutes. */
export function createIpRateLimiter(): RateLimiter {
  return new RateLimiter(5, 15 * 60_000);
}

/** 3 magic-link requests per email per 15 minutes. */
export function createEmailRateLimiter(): RateLimiter {
  return new RateLimiter(3, 15 * 60_000);
}
