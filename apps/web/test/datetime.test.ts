import { describe, expect, it } from "vitest";
import {
  buildTimezoneOptions,
  convertWallTime,
  formatDigestInstant,
  formatWallTime12h,
  isValidTimezone,
  searchTimezones,
  timezoneLabel,
  utcOffsetLabel,
} from "../app/lib/datetime.js";

describe("convertWallTime", () => {
  it("converts a UTC wall time to IST", () => {
    expect(convertWallTime("00:31", "UTC", "Asia/Kolkata")).toMatch(/6:01/);
  });

  it("converts an IST wall time to UTC", () => {
    expect(convertWallTime("13:30", "Asia/Kolkata", "UTC")).toMatch(/8:00 am/i);
  });

  it("is the identity within one zone", () => {
    expect(convertWallTime("08:00", "UTC", "UTC")).toMatch(/8:00 am/i);
  });

  it("falls back to the previous occurrence on a DST-gap day", () => {
    // 2026-03-08 02:30 never occurs in America/New_York (spring forward).
    const now = new Date("2026-03-08T12:00:00Z");
    expect(convertWallTime("02:30", "America/New_York", "UTC", now)).toMatch(/7:30/);
  });

  it("renders in the viewer zone by default", () => {
    expect(typeof convertWallTime("08:00", "UTC")).toBe("string");
  });

  it("returns null for invalid input", () => {
    expect(convertWallTime("8pm", "UTC", "UTC")).toBeNull();
    expect(convertWallTime("24:00", "UTC", "UTC")).toBeNull();
    expect(convertWallTime("08:00", "Mars/Olympus", "UTC")).toBeNull();
    expect(convertWallTime("08:00", "UTC", "Mars/Olympus")).toBeNull();
  });
});

describe("buildTimezoneOptions", () => {
  it("lists curated zones first, then the browser list without duplicates", () => {
    const options = buildTimezoneOptions(["UTC", "Europe/Paris", "Asia/Kolkata"]);
    expect(options[0]).toBe("UTC");
    expect(options.indexOf("Asia/Kolkata")).toBeLessThan(options.indexOf("Europe/Paris"));
    expect(options.filter((tz) => tz === "UTC")).toHaveLength(1);
    expect(options.filter((tz) => tz === "Asia/Kolkata")).toHaveLength(1);
    expect(options).toContain("Europe/Paris");
  });

  it("includes Kolkata even when the browser enumeration omits it", () => {
    // Observed in the wild: supportedValuesOf without Asia/Kolkata.
    const options = buildTimezoneOptions(["UTC", "Asia/Katmandu"]);
    expect(options).toContain("Asia/Kolkata");
    expect(options).toContain("Asia/Kathmandu");
  });

  it("skips blanks", () => {
    expect(buildTimezoneOptions(["", "UTC"])).not.toContain("");
  });
});

describe("isValidTimezone", () => {
  it("accepts resolvable zones including modern spellings", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("Asia/Calcutta")).toBe(true);
  });

  it("rejects junk", () => {
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("timezoneLabel", () => {
  it("labels a curated zone with country, IANA, abbreviation, and offset", () => {
    expect(timezoneLabel("Asia/Kolkata")?.text).toBe(
      "India — Asia/Kolkata (IST, UTC+5:30)",
    );
  });

  it("derives a city label with the exact offset for uncurated zones", () => {
    expect(timezoneLabel("Asia/Kuala_Lumpur")?.text).toBe(
      "Kuala Lumpur · Asia/Kuala_Lumpur (UTC+8:00)",
    );
  });

  it("tracks DST faces across the year", () => {
    expect(
      timezoneLabel("America/New_York", new Date("2026-01-15T12:00:00Z"))?.text,
    ).toBe("United States (USA) — America/New_York (EST, UTC-5:00)");
    expect(
      timezoneLabel("America/New_York", new Date("2026-07-15T12:00:00Z"))?.text,
    ).toBe("United States (USA) — America/New_York (EDT, UTC-4:00)");
  });

  it("special-cases UTC and rejects junk", () => {
    expect(timezoneLabel("UTC")?.text).toBe("UTC");
    expect(timezoneLabel("Mars/Olympus")).toBeNull();
  });

  it("is exact regardless of wall-clock seconds (no minute rounding flake)", () => {
    expect(timezoneLabel("Asia/Kolkata", new Date("2026-09-22T00:31:47Z"))?.text).toBe(
      "India — Asia/Kolkata (IST, UTC+5:30)",
    );
    expect(
      convertWallTime("00:31", "UTC", "Asia/Kolkata", new Date("2026-09-22T00:00:47Z")),
    ).toMatch(/6:01/);
  });
});

describe("searchTimezones", () => {
  const options = ["UTC", "Asia/Kolkata", "Asia/Katmandu", "America/New_York"];

  it("matches country, city, IANA, abbreviation, and offset", () => {
    expect(searchTimezones(options, "india").map((l) => l.value)).toEqual([
      "Asia/Kolkata",
    ]);
    expect(
      searchTimezones(options, "ist", new Date("2026-01-15T12:00:00Z")).map(
        (l) => l.value,
      ),
    ).toContain("Asia/Kolkata");
    expect(searchTimezones(options, "+5:30").map((l) => l.value)).toContain(
      "Asia/Kolkata",
    );
  });

  it("resolves both spellings via the curated entry", () => {
    // Stale browser data lists Asia/Katmandu; curated adds Asia/Kathmandu.
    const withBrowser = buildTimezoneOptions(["UTC", "Asia/Katmandu"]);
    expect(searchTimezones(withBrowser, "kath").map((l) => l.value)).toEqual([
      "Asia/Kathmandu",
    ]);
    expect(searchTimezones(withBrowser, "katm").map((l) => l.value)).toEqual([
      "Asia/Katmandu",
    ]);
  });

  it("returns everything on an empty query and nothing on no match", () => {
    expect(searchTimezones(options, "")).toHaveLength(4);
    expect(searchTimezones(options, "xyz-nope")).toEqual([]);
  });
});

describe("formatWallTime12h", () => {
  it("formats 24h wall times", () => {
    expect(formatWallTime12h("09:00")).toBe("9:00 AM");
    expect(formatWallTime12h("00:09")).toBe("12:09 AM");
    expect(formatWallTime12h("12:00")).toBe("12:00 PM");
    expect(formatWallTime12h("18:47")).toBe("6:47 PM");
    expect(formatWallTime12h("08:00:00")).toBe("8:00 AM");
  });

  it("rejects malformed input", () => {
    expect(formatWallTime12h("9am")).toBeNull();
    expect(formatWallTime12h("24:00")).toBeNull();
    expect(formatWallTime12h("")).toBeNull();
  });
});

describe("utcOffsetLabel", () => {
  it("returns exact numeric offsets", () => {
    expect(utcOffsetLabel("UTC")).toBe("UTC");
    expect(utcOffsetLabel("Asia/Kolkata")).toBe("UTC+5:30");
    expect(utcOffsetLabel("America/New_York", new Date("2026-01-15T12:00:00Z"))).toBe(
      "UTC-5:00",
    );
    expect(utcOffsetLabel("Mars/Olympus")).toBeNull();
  });
});

describe("formatDigestInstant", () => {
  it("renders the instant inside the digest zone", () => {
    expect(formatDigestInstant(new Date("2026-09-22T03:30:00Z"), "Asia/Kolkata")).toBe(
      "Tue, Sep 22 · 9:00 AM GMT+5:30",
    );
  });

  it("returns null for invalid zones", () => {
    expect(formatDigestInstant(new Date(), "Mars/Olympus")).toBeNull();
  });
});
