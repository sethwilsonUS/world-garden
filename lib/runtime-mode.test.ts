import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocalMode } from "./runtime-mode";

describe("isLocalMode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("recognizes either server or public local-mode flag", () => {
    expect(isLocalMode()).toBe(false);

    vi.stubEnv("LOCAL_MODE", "true");
    expect(isLocalMode()).toBe(true);

    vi.stubEnv("LOCAL_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
    expect(isLocalMode()).toBe(true);
  });
});
