import { describe, expect, it } from "vitest";
import {
  hashMagicLinkToken,
  hashSessionToken,
  newRawToken,
  signUnsubscribe,
  verifyUnsubscribe,
} from "../src/auth/tokens.js";

const SECRET = "s".repeat(32);
const USER_ID = "11111111-2222-3333-4444-555555555555";

describe("auth tokens", () => {
  it("generates unique raw tokens", () => {
    expect(newRawToken()).not.toBe(newRawToken());
  });

  it("hashes are deterministic and domain-separated", () => {
    expect(hashMagicLinkToken("abc", SECRET)).toBe(hashMagicLinkToken("abc", SECRET));
    expect(hashMagicLinkToken("abc", SECRET)).not.toBe(hashSessionToken("abc", SECRET));
  });

  it("signUnsubscribe round-trips", () => {
    const token = signUnsubscribe(USER_ID, SECRET);
    expect(verifyUnsubscribe(USER_ID, token, SECRET)).toBe(true);
  });

  it("verifyUnsubscribe rejects wrong token", () => {
    expect(verifyUnsubscribe(USER_ID, "wrong", SECRET)).toBe(false);
  });

  it("verifyUnsubscribe rejects shorter token without throwing", () => {
    expect(verifyUnsubscribe(USER_ID, "short", SECRET)).toBe(false);
  });

  it("verifyUnsubscribe rejects wrong user", () => {
    const token = signUnsubscribe(USER_ID, SECRET);
    expect(
      verifyUnsubscribe("99999999-2222-3333-4444-555555555555", token, SECRET),
    ).toBe(false);
  });
});
