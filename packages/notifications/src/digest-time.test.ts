import { describe, expect, it } from "vitest";
import {
  isValidTimezone,
  lastClose,
  nextClose,
  parseDigestTime,
  utcDateString,
} from "./digest-time.js";

describe("parseDigestTime", () => {
  it("accepts HH:MM and HH:MM:SS (Postgres TIME reads)", () => {
    expect(parseDigestTime("08:00")).toEqual({ hour: 8, minute: 0 });
    expect(parseDigestTime("13:30")).toEqual({ hour: 13, minute: 30 });
    expect(parseDigestTime("13:30:00")).toEqual({ hour: 13, minute: 30 });
    expect(parseDigestTime("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseDigestTime("00:00")).toEqual({ hour: 0, minute: 0 });
  });

  it("rejects malformed times", () => {
    expect(parseDigestTime("8:00")).toBeNull();
    expect(parseDigestTime("24:00")).toBeNull();
    expect(parseDigestTime("08:60")).toBeNull();
    expect(parseDigestTime("08:00:60")).toBeNull();
    expect(parseDigestTime("")).toBeNull();
    expect(parseDigestTime("morning")).toBeNull();
  });
});

describe("isValidTimezone", () => {
  it("accepts IANA names and rejects junk", () => {
    expect(isValidTimezone("UTC")).toBe(true);
    expect(isValidTimezone("Asia/Kolkata")).toBe(true);
    expect(isValidTimezone("America/New_York")).toBe(true);
    expect(isValidTimezone("Mars/Olympus")).toBe(false);
    expect(isValidTimezone("")).toBe(false);
  });
});

describe("lastClose", () => {
  it("returns the same-day close after the hour (UTC)", () => {
    expect(lastClose(new Date("2026-09-18T09:00:00Z"), "UTC", "08:00")).toEqual(
      new Date("2026-09-18T08:00:00Z"),
    );
  });

  it("returns yesterday's close before the hour (UTC)", () => {
    expect(lastClose(new Date("2026-09-18T07:00:00Z"), "UTC", "08:00")).toEqual(
      new Date("2026-09-17T08:00:00Z"),
    );
  });

  it("includes a close exactly at now", () => {
    expect(lastClose(new Date("2026-09-18T08:00:00Z"), "UTC", "08:00")).toEqual(
      new Date("2026-09-18T08:00:00Z"),
    );
  });

  it("matches the equivalent local wall time (Asia/Kolkata 13:30 = 08:00Z)", () => {
    expect(lastClose(new Date("2026-09-18T09:00:00Z"), "Asia/Kolkata", "13:30")).toEqual(
      new Date("2026-09-18T08:00:00Z"),
    );
  });

  it("skips a DST-gap wall time (US spring forward, 02:30 never occurs)", () => {
    // 2026-03-08 02:00 -> 03:00 in America/New_York.
    expect(
      lastClose(new Date("2026-03-08T12:00:00Z"), "America/New_York", "02:30"),
    ).toEqual(new Date("2026-03-07T07:30:00Z"));
    // A normal time on the same day is unaffected.
    expect(
      lastClose(new Date("2026-03-08T12:00:00Z"), "America/New_York", "08:00"),
    ).toEqual(new Date("2026-03-08T12:00:00Z"));
  });

  it("resolves a DST-overlap wall time to the latest occurrence (US fall back)", () => {
    // 2026-11-01 01:30 happens twice: 05:30Z (EDT) and 06:30Z (EST).
    expect(
      lastClose(new Date("2026-11-01T06:00:00Z"), "America/New_York", "01:30"),
    ).toEqual(new Date("2026-11-01T05:30:00Z"));
    expect(
      lastClose(new Date("2026-11-01T07:00:00Z"), "America/New_York", "01:30"),
    ).toEqual(new Date("2026-11-01T06:30:00Z"));
  });

  it("handles southern-hemisphere DST gaps (Adelaide spring forward)", () => {
    // 2026-10-04 02:00 -> 03:00 (+09:30 -> +10:30).
    expect(
      lastClose(new Date("2026-10-04T05:00:00Z"), "Australia/Adelaide", "02:30"),
    ).toEqual(new Date("2026-10-02T17:00:00Z"));
  });

  it("returns null for invalid input", () => {
    expect(lastClose(new Date(), "Mars/Olympus", "08:00")).toBeNull();
    expect(lastClose(new Date(), "UTC", "whenever")).toBeNull();
  });
});

describe("nextClose", () => {
  it("returns today's close when still ahead", () => {
    expect(nextClose(new Date("2026-09-18T07:00:00Z"), "UTC", "08:00")).toEqual(
      new Date("2026-09-18T08:00:00Z"),
    );
  });

  it("returns tomorrow's close once passed", () => {
    expect(nextClose(new Date("2026-09-18T09:00:00Z"), "UTC", "08:00")).toEqual(
      new Date("2026-09-19T08:00:00Z"),
    );
  });

  it("jumps over a DST-gap day", () => {
    expect(
      nextClose(new Date("2026-03-07T08:00:00Z"), "America/New_York", "02:30"),
    ).toEqual(new Date("2026-03-09T06:30:00Z"));
  });

  it("returns null for invalid input", () => {
    expect(nextClose(new Date(), "Mars/Olympus", "08:00")).toBeNull();
  });
});

describe("utcDateString", () => {
  it("formats the UTC calendar date", () => {
    expect(utcDateString(new Date("2026-09-18T08:00:00Z"))).toBe("2026-09-18");
    expect(utcDateString(new Date("2026-09-18T23:30:00Z"))).toBe("2026-09-18");
  });
});
