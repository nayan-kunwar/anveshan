import { describe, expect, it } from "vitest";
import { canonicalize, mapHackerOneAssetType } from "../src/index.js";

describe("canonicalize", () => {
  it("lowercases domains and strips the root dot", () => {
    expect(canonicalize("Example.COM.", "DOMAIN")).toBe("example.com");
    expect(canonicalize("  API.Example.com  ", "DOMAIN")).toBe("api.example.com");
  });

  it("keeps wildcards distinct from bare domains", () => {
    expect(canonicalize("*.Example.COM", "WILDCARD")).toBe("*.example.com");
    expect(canonicalize("*.example.com", "WILDCARD")).not.toBe(
      canonicalize("example.com", "DOMAIN"),
    );
  });

  it("normalizes URLs (default ports, trailing slash, case)", () => {
    expect(canonicalize("https://Example.COM:443/a/", "URL")).toBe(
      "https://example.com/a",
    );
    expect(canonicalize("http://example.com:80", "URL")).toBe("http://example.com/");
    expect(canonicalize("https://example.com:8443/a?x=1", "URL")).toBe(
      "https://example.com:8443/a?x=1",
    );
  });

  it("rejects unparsable URLs and non-http schemes", () => {
    expect(canonicalize("not a url", "URL")).toBeNull();
    expect(canonicalize("ftp://example.com", "URL")).toBeNull();
  });

  it("assumes https for scheme-less URL scopes (browser behavior)", () => {
    // Live HackerOne data: URL-typed scopes with bare domains.
    expect(canonicalize("network.helium.com", "URL")).toBe("https://network.helium.com/");
    expect(canonicalize("Example.COM:8443/app/", "URL")).toBe(
      "https://example.com:8443/app",
    );
    // Guards: garbage without a scheme still drops, and a scheme is
    // never stacked ("ftp://" must not become "https://ftp//…").
    expect(canonicalize("not a url", "URL")).toBeNull();
    expect(canonicalize("http://exa mple.com", "URL")).toBeNull();
    expect(canonicalize("ftp://example.com", "URL")).toBeNull();
  });

  it("drops empty and oversized identifiers", () => {
    expect(canonicalize("   ", "DOMAIN")).toBeNull();
    expect(canonicalize("a".repeat(1025), "DOMAIN")).toBeNull();
  });

  it("collapses whitespace for OTHER-family types", () => {
    expect(canonicalize("  My  App   Name ", "ANDROID")).toBe("My App Name");
  });
});

describe("mapHackerOneAssetType", () => {
  it("maps known HackerOne values", () => {
    expect(mapHackerOneAssetType("URL")).toBe("URL");
    expect(mapHackerOneAssetType("wildcard")).toBe("WILDCARD");
    expect(mapHackerOneAssetType("ANDROID_PLAY_STORE")).toBe("ANDROID");
    expect(mapHackerOneAssetType("GOOGLE_PLAY_APP_ID")).toBe("ANDROID");
    expect(mapHackerOneAssetType("OTHER_APK")).toBe("ANDROID");
    expect(mapHackerOneAssetType("IOS_TESTFLIGHT")).toBe("IOS");
    expect(mapHackerOneAssetType("APPLE_STORE_APP_ID")).toBe("IOS");
    expect(mapHackerOneAssetType("OTHER_IPA")).toBe("IOS");
    expect(mapHackerOneAssetType("CIDR")).toBe("CIDR");
    expect(mapHackerOneAssetType("API")).toBe("API");
    expect(mapHackerOneAssetType("DOWNLOADABLE_EXECUTABLES")).toBe("OTHER");
    expect(mapHackerOneAssetType("SMART_CONTRACT")).toBe("OTHER");
  });

  it("maps unknown or missing values to OTHER without throwing", () => {
    expect(mapHackerOneAssetType("SOMETHING_NEW")).toBe("OTHER");
    expect(mapHackerOneAssetType(undefined)).toBe("OTHER");
    expect(mapHackerOneAssetType(null)).toBe("OTHER");
    expect(mapHackerOneAssetType("SOURCE_CODE")).toBe("OTHER");
  });
});
