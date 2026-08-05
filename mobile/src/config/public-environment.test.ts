import {
  DEVELOPMENT_CONVEX_URL,
  resolveConvexDeploymentUrl,
} from "./public-environment";

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
