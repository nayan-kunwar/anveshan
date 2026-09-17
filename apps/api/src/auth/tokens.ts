import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 bytes of CSPRNG, hex-encoded. Never logged, never stored raw. */
export function newRawToken(): string {
  return randomBytes(32).toString("hex");
}

function hmacHex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

/** Hash a raw magic-link token for DB storage. */
export function hashMagicLinkToken(rawToken: string, secret: string): string {
  return hmacHex(secret, `magic-link:${rawToken}`);
}

/** Hash a raw session token for DB storage. */
export function hashSessionToken(rawToken: string, secret: string): string {
  return hmacHex(secret, `session:${rawToken}`);
}

/** Sign an unsubscribe link payload. No expiry in v1. */
export function signUnsubscribe(userId: string, secret: string): string {
  return hmacHex(secret, `unsubscribe:${userId}`);
}

/**
 * Verify an unsubscribe token. Returns false (never throws) on any
 * mismatch, including length differences (timingSafeEqual throws on
 * unequal lengths, so guard first).
 */
export function verifyUnsubscribe(
  userId: string,
  token: string,
  secret: string,
): boolean {
  const expected = signUnsubscribe(userId, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(token, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
