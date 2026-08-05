import {
  DEVELOPMENT_CONVEX_URL,
  DEVELOPMENT_WEB_ORIGIN,
  PRODUCTION_WEB_ORIGIN,
  resolveClerkPublishableKey,
  resolveConvexDeploymentUrl,
  resolvePublicWebOrigin,
} from "./public-environment.cjs";

const TEST_CLERK_KEY = "pk_test_Y2kuY3VyaW9nYXJkZW4uaW52YWxpZCQ";
const BASE64URL_TEST_CLERK_KEY =
  "pk_test_XSk_NyV-eC0uY3VyaW9nYXJkZW4uaW52YWxpZCQ=";
const LIVE_CLERK_KEY = "pk_live_cHJvZHVjdGlvbi5jdXJpb2dhcmRlbi5pbnZhbGlkJA";
const PR_PREVIEW_WEB_ORIGIN =
  "https://world-garden-git-media-sethwilsonus-projects.vercel.app";

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

describe("resolvePublicWebOrigin", () => {
  it.each(["development", "e2e"] as const)(
    "uses the loopback web application for local %s tooling",
    (variant) => {
      expect(resolvePublicWebOrigin(variant, undefined)).toBe(
        DEVELOPMENT_WEB_ORIGIN,
      );
    },
  );

  it("defaults production to the one canonical public origin", () => {
    expect(resolvePublicWebOrigin("production", undefined)).toBe(
      PRODUCTION_WEB_ORIGIN,
    );
  });

  it("requires preview builds to name an explicit non-production origin", () => {
    expect(() => resolvePublicWebOrigin("preview", undefined)).toThrow(
      "EXPO_PUBLIC_WEB_ORIGIN is required for preview builds",
    );
    expect(() =>
      resolvePublicWebOrigin("preview", PRODUCTION_WEB_ORIGIN),
    ).toThrow("preview builds must not use the production web origin");
  });

  it("canonicalizes a reviewed preview HTTPS origin", () => {
    expect(
      resolvePublicWebOrigin("preview", `  ${PR_PREVIEW_WEB_ORIGIN}/  `),
    ).toBe(PR_PREVIEW_WEB_ORIGIN);
  });

  it("allows only the approved local HTTP hosts for development and local E2E", () => {
    expect(resolvePublicWebOrigin("development", "http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
    expect(resolvePublicWebOrigin("e2e", "http://10.0.2.2:3000")).toBe(
      "http://10.0.2.2:3000",
    );
    expect(() =>
      resolvePublicWebOrigin("development", "http://192.168.1.4:3000"),
    ).toThrow("must use HTTPS or an approved local HTTP host");
    expect(() =>
      resolvePublicWebOrigin("preview", "http://10.0.2.2:3000"),
    ).toThrow("must use HTTPS");
  });

  it.each(["development", "preview", "e2e"] as const)(
    "requires a reviewed HTTPS override for a cloud %s build",
    (variant) => {
      expect(() =>
        resolvePublicWebOrigin(variant, undefined, {
          requireExplicitHttps: true,
        }),
      ).toThrow(
        "Cloud non-production builds require an explicit HTTPS web origin",
      );
      expect(() =>
        resolvePublicWebOrigin(variant, "http://127.0.0.1:3000", {
          requireExplicitHttps: true,
        }),
      ).toThrow(
        "Cloud non-production builds require an explicit HTTPS web origin",
      );
      expect(
        resolvePublicWebOrigin(variant, PR_PREVIEW_WEB_ORIGIN, {
          requireExplicitHttps: true,
        }),
      ).toBe(PR_PREVIEW_WEB_ORIGIN);
    },
  );

  it("accepts only canonical HTTPS port 443", () => {
    expect(
      resolvePublicWebOrigin("preview", `${PR_PREVIEW_WEB_ORIGIN}:443`),
    ).toBe(PR_PREVIEW_WEB_ORIGIN);
    expect(() =>
      resolvePublicWebOrigin("preview", `${PR_PREVIEW_WEB_ORIGIN}:444`),
    ).toThrow("EXPO_PUBLIC_WEB_ORIGIN must use canonical HTTPS port 443");
    expect(
      resolvePublicWebOrigin("production", `${PRODUCTION_WEB_ORIGIN}:443`),
    ).toBe(PRODUCTION_WEB_ORIGIN);
  });

  it.each([
    "ftp://curio-garden-preview.vercel.app",
    `https://user:password@${new URL(PR_PREVIEW_WEB_ORIGIN).hostname}`,
    `${PR_PREVIEW_WEB_ORIGIN}/api`,
    `${PR_PREVIEW_WEB_ORIGIN}/./`,
    `${PR_PREVIEW_WEB_ORIGIN}?token=nope`,
    `${PR_PREVIEW_WEB_ORIGIN}#fragment`,
    "https://localhost:3000",
    "https://0.0.0.0:3000",
    "not a URL",
  ])("rejects an unsafe public web origin: %s", (value) => {
    expect(() => resolvePublicWebOrigin("preview", value)).toThrow();
  });

  it.each([
    "https://attacker.example.com",
    "https://curio-garden-preview.vercel.app",
    "https://world-garden-randomhash-sethwilsonus-projects.vercel.app",
    "https://world-garden-git--sethwilsonus-projects.vercel.app",
    "https://world-garden-git-media-sethwilsonus-projects.vercel.app.evil.example",
  ])(
    "rejects a host outside the Curio Garden PR-preview allowlist: %s",
    (value) => {
      expect(() => resolvePublicWebOrigin("preview", value)).toThrow(
        "must name an approved Curio Garden PR preview host",
      );
    },
  );

  it("rejects every production-origin crossover, including ports and aliases", () => {
    expect(resolvePublicWebOrigin("production", PRODUCTION_WEB_ORIGIN)).toBe(
      PRODUCTION_WEB_ORIGIN,
    );
    expect(() =>
      resolvePublicWebOrigin("production", "https://curiogarden.org:444"),
    ).toThrow(`production builds must use ${PRODUCTION_WEB_ORIGIN}`);
    expect(() =>
      resolvePublicWebOrigin("production", "https://www.curiogarden.org"),
    ).toThrow(`production builds must use ${PRODUCTION_WEB_ORIGIN}`);
    expect(() =>
      resolvePublicWebOrigin("production", "https://world-garden.vercel.app"),
    ).toThrow(`production builds must use ${PRODUCTION_WEB_ORIGIN}`);
    expect(() => resolvePublicWebOrigin("e2e", PRODUCTION_WEB_ORIGIN)).toThrow(
      "e2e builds must not use the production web origin",
    );
    expect(() =>
      resolvePublicWebOrigin("preview", "https://www.curiogarden.org"),
    ).toThrow("preview builds must not use the production web origin");
    expect(() =>
      resolvePublicWebOrigin("e2e", "https://world-garden.vercel.app"),
    ).toThrow("e2e builds must not use the production web origin");
    expect(() =>
      resolvePublicWebOrigin("e2e", "https://curiogarden.org:444"),
    ).toThrow("e2e builds must not use the production web origin");
  });
});
