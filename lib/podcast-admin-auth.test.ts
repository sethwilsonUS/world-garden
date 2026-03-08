import { describe, expect, it } from "vitest";
import { getPodcastAdminAuthError } from "./podcast-admin-auth";

describe("getPodcastAdminAuthError", () => {
  it("requires CRON_SECRET to be configured", () => {
    expect(getPodcastAdminAuthError(null, "")).toBe(
      "CRON_SECRET is not configured",
    );
  });

  it("rejects missing or incorrect bearer tokens", () => {
    expect(getPodcastAdminAuthError(null, "secret")).toBe("Unauthorized");
    expect(getPodcastAdminAuthError("Bearer wrong", "secret")).toBe(
      "Unauthorized",
    );
  });

  it("accepts the configured bearer token", () => {
    expect(getPodcastAdminAuthError("Bearer secret", "secret")).toBeNull();
  });
});

