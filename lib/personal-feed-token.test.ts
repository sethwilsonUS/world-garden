import { describe, expect, it } from "vitest";
import {
  createPersonalFeedToken,
  isValidPersonalFeedToken,
} from "./personal-feed-token";

describe("personal feed tokens", () => {
  it("creates unique lowercase 64-character bearer tokens", () => {
    const tokens = Array.from({ length: 20 }, () => createPersonalFeedToken());

    expect(new Set(tokens)).toHaveLength(tokens.length);
    for (const token of tokens) {
      expect(token).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it.each([
    "",
    "a".repeat(63),
    "a".repeat(65),
    "A".repeat(64),
    ` ${"a".repeat(64)}`,
    `${"a".repeat(64)} `,
    `${"a".repeat(32)}-${"a".repeat(31)}`,
  ])("rejects a non-canonical bearer token", (value) => {
    expect(isValidPersonalFeedToken(value)).toBe(false);
  });
});
