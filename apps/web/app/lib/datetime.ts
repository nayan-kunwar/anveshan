/**
 * Viewer-local timestamp with an explicit zone label.
 *
 * Renders in the browser's timezone (correct for every country with no
 * per-country code) using a 24h clock plus the short zone abbreviation,
 * e.g. `21 Sept 2026, 16:29:24 IST` in India. Falls back to the raw
 * input when it is not a valid date.
 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(date);
}

/** Hand-written countries for curated zones (auto-derived rows show the city only). */
interface CuratedZone {
  country: string;
  /** Standard-time abbreviation; `dst` when the zone observes daylight saving. */
  std: string;
  dst?: string;
}

const CURATED_ZONES: Record<string, CuratedZone> = {
  "Asia/Kolkata": { country: "India", std: "IST" },
  "Asia/Kathmandu": { country: "Nepal", std: "NPT" },
  "Asia/Dhaka": { country: "Bangladesh", std: "BST" },
  "Asia/Jakarta": { country: "Indonesia", std: "WIB" },
  "Asia/Singapore": { country: "Singapore", std: "SGT" },
  "Asia/Tokyo": { country: "Japan", std: "JST" },
  "Asia/Dubai": { country: "UAE", std: "GST" },
  "Europe/London": { country: "UK", std: "GMT", dst: "BST" },
  "Europe/Berlin": { country: "Germany", std: "CET", dst: "CEST" },
  "America/New_York": { country: "United States (USA)", std: "EST", dst: "EDT" },
  "America/Chicago": { country: "United States (USA)", std: "CST", dst: "CDT" },
  "America/Denver": { country: "United States (USA)", std: "MST", dst: "MDT" },
  "America/Los_Angeles": { country: "United States (USA)", std: "PST", dst: "PDT" },
  "Australia/Sydney": { country: "Australia", std: "AEST", dst: "AEDT" },
  "Pacific/Auckland": { country: "New Zealand", std: "NZST", dst: "NZDT" },
};

/**
 * Curated common timezones in modern canonical spelling. Listed first in
 * the picker so major zones are findable even when a browser's
 * `supportedValuesOf("timeZone")` enumeration is stale (observed: missing
 * Asia/Kolkata and Asia/Kathmandu while resolving them fine).
 */
export const COMMON_TIMEZONES: string[] = ["UTC", ...Object.keys(CURATED_ZONES)];

/**
 * Picker options: curated zones first, then the browser's full list
 * minus duplicates. Pure (browser list injectable for tests).
 */
export function buildTimezoneOptions(browserZones: string[]): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const tz of [...COMMON_TIMEZONES, ...browserZones]) {
    if (!tz || seen.has(tz)) continue;
    seen.add(tz);
    options.push(tz);
  }
  return options;
}

/** True when the runtime can resolve the zone (same check the API uses). */
export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface TimezoneLabel {
  value: string;
  text: string;
  haystack: string;
}

function offsetMinutesAt(timeZone: string, instant: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(instant);
    const get = (type: string): number =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    // Seconds included: truncating them skews the offset by a minute
    // whenever wall-clock seconds are >= 30 (flake by wall clock).
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    if (Number.isNaN(asUtc)) return null;
    return Math.round((asUtc - instant.getTime()) / 60_000);
  } catch {
    return null;
  }
}

function offsetLabel(offsetMinutes: number): string {
  if (offsetMinutes === 0) return "UTC";
  const sign = offsetMinutes > 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return `UTC${sign}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
}

/** DST face for a curated zone: standard is the smaller January/July offset. */
function curatedAbbreviation(meta: CuratedZone, timeZone: string, now: Date): string {
  if (!meta.dst) return meta.std;
  const year = now.getUTCFullYear();
  const jan = offsetMinutesAt(timeZone, new Date(Date.UTC(year, 0, 1)));
  const jul = offsetMinutesAt(timeZone, new Date(Date.UTC(year, 6, 1)));
  const current = offsetMinutesAt(timeZone, now);
  if (jan === null || jul === null || current === null || jan === jul) return meta.std;
  return current === Math.min(jan, jul) ? meta.std : (meta.dst ?? meta.std);
}

/**
 * Friendly picker label with a live DST-aware suffix, e.g.
 * "India — Asia/Kolkata (IST, UTC+5:30)". Null on invalid zones.
 * Curated zones use fixed abbreviations (deterministic on every
 * runtime — observed ICU builds returning "GMT+5:30" instead of
 * "IST"); other zones show the exact computed offset.
 */
export function timezoneLabel(tz: string, now: Date = new Date()): TimezoneLabel | null {
  if (tz === "UTC") {
    return { value: "UTC", text: "UTC", haystack: "utc coordinated universal time" };
  }
  if (!isValidTimezone(tz)) return null;
  const offset = offsetMinutesAt(tz, now);
  if (offset === null) return null;
  const meta = CURATED_ZONES[tz];
  let suffix: string;
  if (meta) {
    const abbr = curatedAbbreviation(meta, tz, now);
    suffix = offset === 0 ? abbr : `${abbr}, ${offsetLabel(offset)}`;
  } else {
    suffix = offsetLabel(offset);
  }
  const city = tz.includes("/")
    ? tz.split("/").slice(1).join(" / ").replace(/_/g, " ")
    : tz;
  const text = meta
    ? `${meta.country} — ${tz} (${suffix})`
    : `${city} · ${tz} (${suffix})`;
  const haystack = `${meta?.country ?? ""} ${city} ${tz} ${suffix}`.toLowerCase();
  return { value: tz, text, haystack };
}

/**
 * Filter picker options by free text (country, city, IANA, abbreviation,
 * or offset). Empty query returns everything, curated order preserved.
 */
export function searchTimezones(
  options: string[],
  query: string,
  now: Date = new Date(),
): TimezoneLabel[] {
  const q = query.trim().toLowerCase();
  const results: TimezoneLabel[] = [];
  for (const tz of options) {
    const label = timezoneLabel(tz, now);
    if (!label) continue;
    if (!q || label.haystack.includes(q)) results.push(label);
  }
  return results;
}

/**
 * Convert a daily "HH:MM" wall time in `fromTimeZone` to the same
 * instant rendered in another zone (default: the viewer's local zone),
 * e.g. ("00:31", "UTC") -> "6:01 AM" in India. Null on invalid input.
 * Anchored on `now` (injectable for tests); a DST-gap wall time falls
 * back to the previous day's occurrence. Intl only, no date library.
 */
export function convertWallTime(
  timeLocal: string,
  fromTimeZone: string,
  toTimeZone?: string,
  now: Date = new Date(),
): string | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeLocal.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  let fromFmt: Intl.DateTimeFormat;
  let toFmt: Intl.DateTimeFormat;
  try {
    fromFmt = new Intl.DateTimeFormat("en-US", {
      timeZone: fromTimeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    toFmt = new Intl.DateTimeFormat(undefined, {
      timeZone: toTimeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
  const partsOf = (
    at: Date,
  ): { y: number; mo: number; d: number; h: number; mi: number; s: number } => {
    const parts = fromFmt.formatToParts(at);
    const get = (type: string): number =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    return {
      y: get("year"),
      mo: get("month"),
      d: get("day"),
      h: get("hour"),
      mi: get("minute"),
      s: get("second"),
    };
  };
  const offsetMinutes = (at: Date): number => {
    const w = partsOf(at);
    return Math.round(
      (Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - at.getTime()) / 60_000,
    );
  };
  // Resolve the wall reading on one wall-date: iterate the fixed point,
  // then accept only an exact wall match (gap days yield nothing).
  const resolveOn = (wallDate: { y: number; mo: number; d: number }): number | null => {
    const target = Date.UTC(wallDate.y, wallDate.mo - 1, wallDate.d, hour, minute);
    let guess = target;
    for (let i = 0; i < 3; i += 1) {
      guess += target - (guess + offsetMinutes(new Date(guess)) * 60_000);
    }
    const w = partsOf(new Date(guess));
    if (w.h !== hour || w.mi !== minute) return null;
    if (w.y !== wallDate.y || w.mo !== wallDate.mo || w.d !== wallDate.d) return null;
    return guess;
  };
  const today = partsOf(now);
  const instant =
    resolveOn(today) ?? resolveOn(partsOf(new Date(now.getTime() - 86_400_000)));
  if (instant === null) return null;
  return toFmt.format(new Date(instant));
}
