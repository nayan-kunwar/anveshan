/**
 * Per-user digest close arithmetic. Pure (no I/O, no clock reads):
 * callers pass `now` explicitly, so every path is unit-testable.
 *
 * A "close" is the latest instant <= `now` whose wall-clock time in the
 * user's IANA timezone equals their HH:MM preference. A digest covers
 * [close - 24h, close). No date library: Intl only.
 */

export interface DigestWallTime {
  hour: number;
  minute: number;
}

/** Accept "HH:MM" (settings UI) and "HH:MM:SS" (Postgres TIME reads). */
export function parseDigestTime(value: string): DigestWallTime | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value.trim());
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function isValidTimezone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, created);
  return created;
}

function wallParts(timeZone: string, instant: Date): WallParts {
  const parts = formatter(timeZone).formatToParts(instant);
  const get = (type: string): number => {
    const found = parts.find((p) => p.type === type)?.value ?? "";
    return Number(found);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset such that wall-clock = UTC instant + offset (minutes). */
function tzOffsetMinutes(timeZone: string, instant: Date): number {
  const w = wallParts(timeZone, instant);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

function wallMatches(timeZone: string, instant: Date, target: DigestWallTime): boolean {
  const w = wallParts(timeZone, instant);
  return w.hour === target.hour && w.minute === target.minute;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * Latest close instant <= `now` for (timeZone, timeLocal), or null for
 * invalid input. DST-gap days (wall time never occurs) simply yield the
 * previous day's close — the tick's due-window then skips that day.
 */
export function lastClose(now: Date, timeZone: string, timeLocal: string): Date | null {
  const target = parseDigestTime(timeLocal);
  if (!target || !isValidTimezone(timeZone)) return null;
  const nowMs = now.getTime();
  const targetMs = (target.hour * 60 + target.minute) * 60_000;
  const todayMidnightUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  let best: number | null = null;
  // A close <= now always lies within the last ~26h (25h DST day + margin);
  // its UTC date is one of the last four UTC dates.
  for (let back = 0; back < 4; back += 1) {
    const base = todayMidnightUtc - back * DAY_MS;
    // Fixed-point iteration: instant + offset(instant) = base + target.
    let guess = base + targetMs;
    for (let i = 0; i < 3; i += 1) {
      guess = base + targetMs - tzOffsetMinutes(timeZone, new Date(guess)) * 60_000;
    }
    // Forward probe catches an overlap day's second occurrence.
    for (let k = 0; k < 3; k += 1) {
      const candidate = guess + k * HOUR_MS;
      if (candidate > nowMs) break;
      if (wallMatches(timeZone, new Date(candidate), target)) {
        if (best === null || candidate > best) best = candidate;
      }
    }
  }
  return best === null ? null : new Date(best);
}

/** First close strictly after `now`, or null for invalid input. */
export function nextClose(now: Date, timeZone: string, timeLocal: string): Date | null {
  if (!parseDigestTime(timeLocal) || !isValidTimezone(timeZone)) return null;
  // The next close is at most ~73h out (skipped calendar dates included);
  // walk back from there to the first close after now.
  let probe = new Date(now.getTime() + 73 * HOUR_MS);
  for (let i = 0; i < 5; i += 1) {
    const close = lastClose(probe, timeZone, timeLocal);
    if (!close) return null;
    if (close.getTime() <= now.getTime()) return null;
    const prev = lastClose(new Date(close.getTime() - 1000), timeZone, timeLocal);
    if (!prev || prev.getTime() <= now.getTime()) return close;
    probe = prev;
  }
  return null;
}

/** UTC calendar date of an instant ("digest_on" key), YYYY-MM-DD. */
export function utcDateString(instant: Date): string {
  const full = instant.toISOString();
  const date = full.slice(0, 10);
  if (!date) throw new Error("invalid digest date");
  return date;
}
