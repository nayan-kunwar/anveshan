import { describe, expect, it } from "vitest";
import {
  buildTimezoneOptions,
  convertWallTime,
  isValidTimezone,
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
