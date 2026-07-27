import { afterEach, describe, expect, it } from "vitest";
import {
  buildProductFeedbackRateLimitKey,
  getProductFeedbackWriteSecret,
  normalizeProductFeedbackInput,
} from "./product-feedback";

const originalWriteSecret = process.env.PRODUCT_FEEDBACK_WRITE_SECRET;

afterEach(() => {
  if (originalWriteSecret === undefined) {
    delete process.env.PRODUCT_FEEDBACK_WRITE_SECRET;
  } else {
    process.env.PRODUCT_FEEDBACK_WRITE_SECRET = originalWriteSecret;
  }
});

describe("normalizeProductFeedbackInput", () => {
  it("normalizes the public feedback fields without adding request metadata", () => {
    expect(
      normalizeProductFeedbackInput({
        kind: "accessibility",
        message: "  The player label is difficult to understand.\r\n  ",
        environment: "  VoiceOver with Safari  ",
        contactEmail: "  reader@example.com  ",
        researchOptIn: true,
      }),
    ).toEqual({
      kind: "accessibility",
      message: "The player label is difficult to understand.",
      environment: "VoiceOver with Safari",
      contactEmail: "reader@example.com",
      researchOptIn: true,
    });
  });

  it("accepts anonymous feedback and omits blank optional fields", () => {
    expect(
      normalizeProductFeedbackInput({
        kind: "product",
        message: "Please make playlists easier to find.",
        environment: "   ",
        contactEmail: "",
        researchOptIn: false,
        articleTitle: "   ",
        articleSlug: "",
        articleRevisionId: "   ",
      }),
    ).toEqual({
      kind: "product",
      message: "Please make playlists easier to find.",
      researchOptIn: false,
    });
  });

  it("normalizes an explicitly supplied article context", () => {
    expect(
      normalizeProductFeedbackInput({
        kind: "technical",
        message: "The third section did not start playing.",
        researchOptIn: false,
        articleTitle: "  The Lord of the Rings  ",
        articleSlug: "  The_Lord_of_the_Rings  ",
        articleRevisionId: "  1234567890  ",
      }),
    ).toEqual({
      kind: "technical",
      message: "The third section did not start playing.",
      researchOptIn: false,
      articleTitle: "The Lord of the Rings",
      articleSlug: "The_Lord_of_the_Rings",
      articleRevisionId: "1234567890",
    });
  });

  it.each([
    [{ articleTitle: "Saturn" }],
    [{ articleSlug: "Saturn" }],
    [{ articleRevisionId: "1234567890" }],
    [{ articleTitle: "Saturn", articleRevisionId: "1234567890" }],
  ])("rejects incoherent article context %#", (articleContext) => {
    expect(() =>
      normalizeProductFeedbackInput({
        kind: "product",
        message: "Article feedback",
        researchOptIn: false,
        ...articleContext,
      }),
    ).toThrow("Article title and slug are required together");
  });

  it("rejects invalid and oversized article context fields", () => {
    const feedback = {
      kind: "technical",
      message: "Article feedback",
      researchOptIn: false,
      articleTitle: "Saturn",
      articleSlug: "Saturn",
    } as const;

    expect(() =>
      normalizeProductFeedbackInput({
        ...feedback,
        articleTitle: "x".repeat(513),
      }),
    ).toThrow("Article title is too long");
    expect(() =>
      normalizeProductFeedbackInput({
        ...feedback,
        articleSlug: "x".repeat(769),
      }),
    ).toThrow("Article slug is too long");
    expect(() =>
      normalizeProductFeedbackInput({
        ...feedback,
        articleRevisionId: "revision-123",
      }),
    ).toThrow("Article revision ID is invalid");
    expect(() =>
      normalizeProductFeedbackInput({
        ...feedback,
        articleRevisionId: "1".repeat(21),
      }),
    ).toThrow("Article revision ID is invalid");
    expect(() =>
      normalizeProductFeedbackInput({
        ...feedback,
        articleTitle: "Saturn\nhttps://example.test/private",
      }),
    ).toThrow("Article title must be a single line");
  });

  it("requires a valid contact email for research volunteers", () => {
    expect(() =>
      normalizeProductFeedbackInput({
        kind: "other",
        message: "I would like to help.",
        researchOptIn: true,
      }),
    ).toThrow("Contact email is required");

    expect(() =>
      normalizeProductFeedbackInput({
        kind: "other",
        message: "I would like to help.",
        contactEmail: "not-an-email",
        researchOptIn: true,
      }),
    ).toThrow("Contact email is invalid");
  });

  it("rejects unknown fields, invalid types, control characters, and oversized text", () => {
    expect(() =>
      normalizeProductFeedbackInput({
        kind: "technical",
        message: "The button does nothing.",
        researchOptIn: false,
        analyticsId: "do-not-collect-this",
      }),
    ).toThrow("Unexpected feedback field");

    expect(() =>
      normalizeProductFeedbackInput({
        kind: "technical",
        message: "The button does nothing.",
        researchOptIn: "false",
      }),
    ).toThrow("Research choice is invalid");

    expect(() =>
      normalizeProductFeedbackInput({
        kind: "technical",
        message: "Broken\u0000message",
        researchOptIn: false,
      }),
    ).toThrow("Message contains unsupported characters");

    expect(() =>
      normalizeProductFeedbackInput({
        kind: "technical",
        message: "x".repeat(4_001),
        researchOptIn: false,
      }),
    ).toThrow("Message is too long");
  });
});

describe("product feedback server configuration", () => {
  it("returns only a non-empty dedicated write secret", () => {
    process.env.PRODUCT_FEEDBACK_WRITE_SECRET = "  feedback-secret  ";
    expect(getProductFeedbackWriteSecret()).toBe("feedback-secret");

    process.env.PRODUCT_FEEDBACK_WRITE_SECRET = "   ";
    expect(getProductFeedbackWriteSecret()).toBeNull();
  });
});

describe("buildProductFeedbackRateLimitKey", () => {
  it("creates a stable, secret-salted identifier without exposing the address", async () => {
    const first = await buildProductFeedbackRateLimitKey(
      "203.0.113.42",
      "feedback-secret",
    );
    const second = await buildProductFeedbackRateLimitKey(
      "203.0.113.42",
      "feedback-secret",
    );
    const differentSalt = await buildProductFeedbackRateLimitKey(
      "203.0.113.42",
      "different-secret",
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^route-quota:product-feedback:[a-f0-9]{64}$/);
    expect(first).not.toContain("203.0.113.42");
    expect(differentSalt).not.toBe(first);
  });

  it("fails closed instead of sharing one quota when an address is unavailable", async () => {
    await expect(
      buildProductFeedbackRateLimitKey(null, "feedback-secret"),
    ).rejects.toThrow("Feedback rate-limit client address is missing");
  });
});
