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
 * Viewer-local equivalent of the 08:00 UTC daily digest time,
 * e.g. `13:30` in India. Returns null when the viewer is in UTC
 * (no suffix needed) — and always computed live, so DST zones shift
 * correctly with no branches.
 */
export function localDigestTime(utcHour = 8, utcMinute = 0): string | null {
  const probe = new Date(Date.UTC(2026, 0, 1, utcHour, utcMinute));
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(probe);
  const offset = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  if (offset === "GMT") return null;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(probe);
  return `${time} your time`;
}
