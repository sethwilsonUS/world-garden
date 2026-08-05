import {
  DEVELOPMENT_CONVEX_URL,
  resolveClerkPublishableKey,
  resolveConvexDeploymentUrl,
} from "./public-environment.cjs";

const TEST_CLERK_KEY = "pk_test_Y2kuY3VyaW9nYXJkZW4uaW52YWxpZCQ";
const BASE64URL_TEST_CLERK_KEY =
  "pk_test_XSk_NyV-eC0uY3VyaW9nYXJkZW4uaW52YWxpZCQ=";
const LIVE_CLERK_KEY = "pk_live_cHJvZHVjdGlvbi5jdXJpb2dhcmRlbi5pbnZhbGlkJA";

describe("resolveConvexDeploymentUrl", () => {
  it.each(["development", "e2e"] as const)(
    "uses the reviewed development deployment for %s builds",
    (variant) => {
      expect(resolveConvexDeploymentUrl(variant, undefined)).toBe(
        DEVELOPMENT_CONVEX_URL,
      );
    },
  );

  it.each(["preview", "production"] as const)(
    "requires an explicit deployment for %s builds",
    (variant) => {
      expect(() => resolveConvexDeploymentUrl(variant, undefined)).toThrow(
        `EXPO_PUBLIC_CONVEX_URL is required for ${variant} builds`,
      );
    },
  );

  it("canonicalizes an explicit HTTPS Convex deployment", () => {
    expect(
      resolveConvexDeploymentUrl(
        "preview",
        "  https://preview-garden.convex.cloud/  ",
      ),
    ).toBe("https://preview-garden.convex.cloud");
  });

  it("allows loopback HTTP only for development", () => {
    expect(
      resolveConvexDeploymentUrl("development", "http://127.0.0.1:3210"),
    ).toBe("http://127.0.0.1:3210");
    expect(() =>
      resolveConvexDeploymentUrl("e2e", "http://127.0.0.1:3210"),
    ).toThrow("must use HTTPS");
  });

  it.each([
    "http://preview-garden.convex.cloud",
    "https://user:password@preview-garden.convex.cloud",
    "https://preview-garden.convex.cloud/path",
    "https://preview-garden.convex.cloud?token=nope",
    "https://preview-garden.convex.cloud#fragment",
    "https://example.com",
  ])("rejects an unsafe deployment URL: %s", (value) => {
    expect(() => resolveConvexDeploymentUrl("preview", value)).toThrow();
  });

  it.each(["preview", "production"] as const)(
    "prevents %s from silently reaching the development deployment",
    (variant) => {
      expect(() =>
        resolveConvexDeploymentUrl(variant, DEVELOPMENT_CONVEX_URL),
      ).toThrow("must not use the development deployment");
    },
  );
});

describe("resolveClerkPublishableKey", () => {
  it.each(["development", "preview", "e2e"] as const)(
    "accepts and trims a Clerk test key for %s",
    (variant) => {
      expect(resolveClerkPublishableKey(variant, `  ${TEST_CLERK_KEY}  `)).toBe(
        TEST_CLERK_KEY,
      );
    },
  );

  it("accepts and trims a Clerk live key for production", () => {
    expect(
      resolveClerkPublishableKey("production", `  ${LIVE_CLERK_KEY}  `),
    ).toBe(LIVE_CLERK_KEY);
  });

  it("accepts Clerk publishable keys encoded with the base64url alphabet", () => {
    expect(
      resolveClerkPublishableKey("development", BASE64URL_TEST_CLERK_KEY),
    ).toBe(BASE64URL_TEST_CLERK_KEY);
  });

  it.each([undefined, "", "   "])(
    "rejects a missing Clerk key instead of booting unauthenticated: %s",
    (value) => {
      expect(() => resolveClerkPublishableKey("development", value)).toThrow(
        "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required for development builds",
      );
    },
  );

  it.each([
    "pk_test_",
    "pk_test_not-base64!",
    "pk_test_bm8tZG90JA",
    "pk_test_bm8uZG90",
    "sk_test_Y2kuY3VyaW9nYXJkZW4uaW52YWxpZCQ", // betterleaks:allow
  ])("rejects a malformed Clerk publishable key: %s", (value) => {
    expect(() => resolveClerkPublishableKey("development", value)).toThrow(
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY must be a valid Clerk publishable key",
    );
  });

  it.each(["development", "preview", "e2e"] as const)(
    "prevents %s builds from using a live Clerk instance",
    (variant) => {
      expect(() => resolveClerkPublishableKey(variant, LIVE_CLERK_KEY)).toThrow(
        `${variant} builds must use a Clerk test publishable key`,
      );
    },
  );

  it("prevents production builds from using a Clerk test instance", () => {
    expect(() =>
      resolveClerkPublishableKey("production", TEST_CLERK_KEY),
    ).toThrow("production builds must use a Clerk live publishable key");
  });
});
