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
