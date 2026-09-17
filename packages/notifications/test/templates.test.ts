import { describe, expect, it } from "vitest";
import { formatDigestDate, renderDaily, renderImmediate } from "../src/index.js";
import type { TemplateChange } from "../src/index.js";

const OPTS = {
  frontendUrl: "http://localhost:3001",
  unsubscribeUrl: "http://localhost:3001/unsubscribe?user=u&token=t",
};

function asset(
  programId: string,
  programName: string,
  type: "ASSET_ADDED" | "ASSET_REMOVED",
  assetKey: string,
  identifier: string,
): TemplateChange {
  return { type, programId, programName, assetKey, assetIdentifier: identifier };
}

function programAdded(programId: string, programName: string): TemplateChange {
  return {
    type: "PROGRAM_ADDED",
    programId,
    programName,
    assetKey: null,
    assetIdentifier: null,
  };
}

describe("renderImmediate", () => {
  it("renders a single-program email with counts", () => {
    const mail = renderImmediate(
      [
        asset("p1", "Google VRP", "ASSET_ADDED", "URL|api.google.com", "api.google.com"),
        asset("p1", "Google VRP", "ASSET_ADDED", "WILDCARD|*.google.com", "*.google.com"),
        asset(
          "p1",
          "Google VRP",
          "ASSET_REMOVED",
          "URL|old.google.com",
          "old.google.com",
        ),
      ],
      OPTS,
    );
    expect(mail.subject).toBe("[Anveshan] 3 changes in Google VRP");
    expect(mail.text).toContain("Google VRP (3 changes)");
    expect(mail.text).toContain("+ ASSET_ADDED  api.google.com (URL)");
    expect(mail.text).toContain("- ASSET_REMOVED  old.google.com (URL)");
    expect(mail.text).toContain("Manage subscriptions: http://localhost:3001/dashboard");
    expect(mail.text).toContain(
      "Unsubscribe: http://localhost:3001/unsubscribe?user=u&token=t",
    );
    expect(mail.text).not.toContain("Showing");
  });

  it("renders a multi-program subject", () => {
    const mail = renderImmediate(
      [
        asset("p1", "A", "ASSET_ADDED", "URL|a.com", "a.com"),
        asset("p2", "B", "ASSET_ADDED", "URL|b.com", "b.com"),
      ],
      OPTS,
    );
    expect(mail.subject).toBe("[Anveshan] 2 changes in 2 programs");
  });

  it("renders PROGRAM_ADDED lines", () => {
    const mail = renderImmediate([programAdded("p9", "New Prog")], OPTS);
    expect(mail.subject).toBe("[Anveshan] 1 change in New Prog");
    expect(mail.text).toContain("+ PROGRAM_ADDED  New Prog");
  });

  it("caps programs at 20 with an overflow line", () => {
    const changes = Array.from({ length: 21 }, (_, i) =>
      asset(`p${i}`, `Prog ${i}`, "ASSET_ADDED", "URL|x.com", "x.com"),
    );
    const mail = renderImmediate(changes, OPTS);
    expect(mail.text).toContain("... and 1 more program");
    expect(mail.text).toContain("(Showing 20 of 21 changes)");
  });

  it("caps assets per program at 10 with an overflow line", () => {
    const changes = Array.from({ length: 11 }, (_, i) =>
      asset("p1", "Big", "ASSET_ADDED", `URL|a${i}.com`, `a${i}.com`),
    );
    const mail = renderImmediate(changes, OPTS);
    expect(mail.text).toContain("... and 1 more asset");
    expect(mail.text).toContain("(Showing 10 of 11 changes)");
  });

  it("renders a safe empty mail", () => {
    const mail = renderImmediate([], OPTS);
    expect(mail.subject).toContain("No new changes");
  });
});

describe("renderDaily", () => {
  const window = {
    ...OPTS,
    windowStart: new Date("2026-09-17T08:00:00Z"),
    windowEnd: new Date("2026-09-18T08:00:00Z"),
  };

  it("renders per-program summaries with counts", () => {
    const mail = renderDaily(
      [
        asset("p1", "Google VRP", "ASSET_ADDED", "URL|a.com", "a.com"),
        asset("p1", "Google VRP", "ASSET_ADDED", "URL|b.com", "b.com"),
        asset("p1", "Google VRP", "ASSET_ADDED", "URL|c.com", "c.com"),
        asset("p1", "Google VRP", "ASSET_REMOVED", "URL|d.com", "d.com"),
        asset("p2", "Apple", "ASSET_ADDED", "URL|e.com", "e.com"),
      ],
      window,
    );
    expect(mail.subject).toBe("[Anveshan] Daily digest — 2 programs changed (5 assets)");
    expect(mail.text).toContain("Sep 17 08:00 → Sep 18 08:00 UTC");
    expect(mail.text).toContain("+ 3 assets added, - 1 asset removed");
    expect(mail.text).toContain("+ 1 asset added");
  });

  it("marks new programs in the digest", () => {
    const mail = renderDaily([programAdded("p9", "Fresh")], window);
    expect(mail.text).toContain("Fresh");
    expect(mail.text).toContain("+ New program");
  });

  it("caps programs with an overflow line", () => {
    const changes = Array.from({ length: 21 }, (_, i) =>
      asset(`p${i}`, `Prog ${i}`, "ASSET_ADDED", "URL|x.com", "x.com"),
    );
    const mail = renderDaily(changes, window);
    expect(mail.text).toContain("... and 1 more program");
  });

  it("renders a safe empty digest", () => {
    const mail = renderDaily([], window);
    expect(mail.subject).toContain("no changes");
  });
});

describe("formatDigestDate", () => {
  it("formats UTC dates", () => {
    expect(formatDigestDate(new Date("2026-09-17T08:00:00Z"))).toBe("Sep 17 08:00");
  });
});
