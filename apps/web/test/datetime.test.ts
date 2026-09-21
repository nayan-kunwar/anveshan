import { describe, expect, it } from "vitest";
import { convertWallTime } from "../app/lib/datetime.js";

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
