import type { AssetType } from "./types.js";

/**
 * Canonicalize an asset identifier for diff identity.
 * Pure function — see docs/snapshot-algorithm.md §3.
 *
 * Returns null when the identifier is unusable (caller drops it with a warn).
 */
export function canonicalize(raw: string, type: AssetType): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 1024) return null;

  switch (type) {
    case "DOMAIN":
    case "WILDCARD": {
      // Lowercase, strip FQDN root dot. Keep leading "*." — it is
      // a different key from the bare domain.
      const lower = trimmed.toLowerCase();
      return lower.endsWith(".") ? lower.slice(0, -1) : lower;
    }
    case "URL":
      return canonicalizeUrl(trimmed);
    case "IP":
    case "CIDR":
      return trimmed.toLowerCase();
    case "ANDROID":
    case "IOS":
    case "API":
    case "OTHER":
      // Collapse interior whitespace to a single space.
      return trimmed.replace(/\s+/g, " ");
  }
}

function canonicalizeUrl(raw: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) return null;
  let port = parsed.port;
  if ((scheme === "https:" && port === "443") || (scheme === "http:" && port === "80")) {
    port = "";
  }
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  const search = parsed.search;
  const hash = parsed.hash;
  return `${scheme}//${host}${port !== "" ? `:${port}` : ""}${path}${search}${hash}`;
}

/**
 * Explicit HackerOne `asset_type` (uppercased) → internal AssetType.
 * Grounded in live API responses (Sep 2026), not guesses.
 */
const HACKERONE_ASSET_TYPE_MAP: Record<string, AssetType> = {
  URL: "URL",
  WILDCARD: "WILDCARD",
  DOMAIN: "DOMAIN",
  CIDR: "CIDR",
  IP: "IP",
  IP_ADDRESS: "IP",
  API: "API",
  ANDROID_PLAY_STORE: "ANDROID",
  ANDROID_APK: "ANDROID",
  ANDROID: "ANDROID",
  GOOGLE_PLAY_APP_ID: "ANDROID",
  OTHER_APK: "ANDROID",
  IOS_APP_STORE: "IOS",
  IOS_TESTFLIGHT: "IOS",
  IOS_IPA: "IOS",
  IOS: "IOS",
  APPLE_STORE_APP_ID: "IOS",
  TESTFLIGHT: "IOS",
  OTHER_IPA: "IOS",
  SOURCE_CODE: "OTHER",
  SOURCECODE: "OTHER",
  HARDWARE: "OTHER",
  EXECUTABLE: "OTHER",
  WINDOWS_MICROSOFT_STORE: "OTHER",
  WINDOWS_APP_STORE_APP_ID: "OTHER",
  DOWNLOADABLE_EXECUTABLES: "OTHER",
  SMART_CONTRACT: "OTHER",
  AI_MODEL: "OTHER",
  OTHER: "OTHER",
  OTHER_ASSET: "OTHER",
};

/**
 * Map a raw HackerOne `asset_type` string to the internal AssetType.
 * Unknown / missing values map to OTHER (never throws).
 */
export function mapHackerOneAssetType(raw: unknown): AssetType {
  if (typeof raw !== "string") return "OTHER";
  return HACKERONE_ASSET_TYPE_MAP[raw.toUpperCase().trim()] ?? "OTHER";
}

/** True when the raw value is explicitly mapped (no warning needed). */
export function isKnownHackerOneAssetType(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  return raw.toUpperCase().trim() in HACKERONE_ASSET_TYPE_MAP;
}
