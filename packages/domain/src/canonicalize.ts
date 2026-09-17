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
 * Map a raw HackerOne `asset_type` string to the internal AssetType.
 * Unknown / missing values map to OTHER (never throws).
 */
export function mapHackerOneAssetType(raw: unknown): AssetType {
  if (typeof raw !== "string") return "OTHER";
  const v = raw.toUpperCase().trim();
  switch (v) {
    case "URL":
      return "URL";
    case "WILDCARD":
      return "WILDCARD";
    case "DOMAIN":
      return "DOMAIN";
    case "CIDR":
      return "CIDR";
    case "IP":
    case "IP_ADDRESS":
      return "IP";
    case "ANDROID_PLAY_STORE":
    case "ANDROID_APK":
    case "ANDROID":
      return "ANDROID";
    case "IOS_APP_STORE":
    case "IOS_TESTFLIGHT":
    case "IOS_IPA":
    case "IOS":
      return "IOS";
    case "SOURCE_CODE":
    case "SOURCECODE":
    case "HARDWARE":
    case "EXECUTABLE":
    case "WINDOWS_MICROSOFT_STORE":
    case "OTHER":
    case "OTHER_ASSET":
      return "OTHER";
    default:
      return "OTHER";
  }
}
