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
  ): { y: number; mo: number; d: number; h: number; mi: number } => {
    const parts = fromFmt.formatToParts(at);
    const get = (type: string): number =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    return {
      y: get("year"),
      mo: get("month"),
      d: get("day"),
      h: get("hour"),
      mi: get("minute"),
    };
  };
  const offsetMinutes = (at: Date): number => {
    const w = partsOf(at);
    return Math.round((Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - at.getTime()) / 60_000);
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
