import { describe, expect, it } from "vitest";
import { assetKey, diffProgram } from "../src/index.js";
import type {
  CollectedAsset,
  CollectedProgram,
  PreviousProgramState,
} from "../src/index.js";

const program: CollectedProgram = {
  externalId: "acme",
  name: "Acme",
  platform: "hackerone",
  url: "https://hackerone.com/acme",
};

function asset(identifier: string, scope: "IN" | "OUT" = "IN"): CollectedAsset {
  return { identifier, type: "DOMAIN", scope };
}

function prevState(keys: [string, string][]): PreviousProgramState {
  return { programId: "00000000-0000-0000-0000-000000000001", inAssets: new Map(keys) };
}

const k = (id: string): [string, string] => [assetKey("DOMAIN", id), id];

describe("diffProgram", () => {
  it("first collection establishes baseline with zero changes", () => {
    const result = diffProgram(null, program, [asset("a.com"), asset("b.com")], true);
    expect(result).toEqual({ programAdded: false, added: [], removed: [] });
  });

  it("new program emits PROGRAM_ADDED without per-asset events", () => {
    const result = diffProgram(null, program, [asset("a.com")], false);
    expect(result.programAdded).toBe(true);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("existing program with identical scope emits nothing", () => {
    const prev = prevState([k("example.com"), k("api.example.com")]);
    const result = diffProgram(
      prev,
      program,
      [asset("example.com"), asset("api.example.com")],
      false,
    );
    expect(result).toEqual({ programAdded: false, added: [], removed: [] });
  });

  it("new asset emits ASSET_ADDED; missing asset emits ASSET_REMOVED", () => {
    const prev = prevState([k("example.com"), k("old.example.com")]);
    const result = diffProgram(
      prev,
      program,
      [asset("example.com"), asset("new.example.com")],
      false,
    );
    expect(result.added).toEqual([
      { assetKey: "DOMAIN|new.example.com", assetIdentifier: "new.example.com" },
    ]);
    expect(result.removed).toEqual([
      { assetKey: "DOMAIN|old.example.com", assetIdentifier: "old.example.com" },
    ]);
  });

  it("OUT→IN is ADDED; IN→OUT is REMOVED", () => {
    const prev = prevState([k("a.com")]);
    const outToIn = diffProgram(
      prev,
      program,
      [asset("a.com"), asset("b.com", "OUT")],
      false,
    );
    expect(outToIn.added).toEqual([]);
    const flip = diffProgram(
      prev,
      program,
      [asset("a.com", "OUT"), asset("b.com")],
      false,
    );
    expect(flip.added.map((a) => a.assetKey)).toEqual(["DOMAIN|b.com"]);
    expect(flip.removed.map((r) => r.assetKey)).toEqual(["DOMAIN|a.com"]);
  });

  it("OUT-only (VDP) scopes never emit", () => {
    const prev = prevState([]);
    const result = diffProgram(prev, program, [asset("a.com", "OUT")], false);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("is order-independent and idempotent on repeat", () => {
    const prev = prevState([k("a.com"), k("b.com")]);
    const first = diffProgram(prev, program, [asset("b.com"), asset("a.com")], false);
    expect(first.added).toEqual([]);
    expect(first.removed).toEqual([]);
    const second = diffProgram(prev, program, [asset("a.com"), asset("b.com")], false);
    expect(second).toEqual(first);
  });

  it("type change is REMOVED(old) + ADDED(new), metadata is ignored", () => {
    // Same identifier string under another type has a different key.
    expect(assetKey("DOMAIN", "example.com")).not.toBe(
      assetKey("WILDCARD", "*.example.com"),
    );
    const prev = prevState([[assetKey("DOMAIN", "example.com"), "example.com"]]);
    const incoming: CollectedAsset[] = [
      { identifier: "*.example.com", type: "WILDCARD", scope: "IN" },
    ];
    const result = diffProgram(prev, program, incoming, false);
    expect(result.added.map((a) => a.assetKey)).toEqual(["WILDCARD|*.example.com"]);
    expect(result.removed.map((r) => r.assetKey)).toEqual(["DOMAIN|example.com"]);
  });
});
