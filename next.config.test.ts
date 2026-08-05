import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("nextConfig redirects", () => {
  it("transpiles the shared domain source package", () => {
    expect(nextConfig.transpilePackages).toContain("@curio-garden/domain");
  });

  it("permanently consolidates the www host onto the apex domain", async () => {
    expect(nextConfig.redirects).toBeTypeOf("function");

    await expect(nextConfig.redirects?.()).resolves.toContainEqual({
      source: "/:path*",
      has: [{ type: "host", value: "www.curiogarden.org" }],
      destination: "https://curiogarden.org/:path*",
      permanent: true,
    });
  });
});
