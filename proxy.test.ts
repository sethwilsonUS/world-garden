import { afterEach, describe, expect, it, vi } from "vitest";

const originalLocalMode = process.env.NEXT_PUBLIC_LOCAL_MODE;

const restoreEnvValue = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@clerk/nextjs/server");
  restoreEnvValue("NEXT_PUBLIC_LOCAL_MODE", originalLocalMode);
});

describe("proxy", () => {
  it("does not initialize Clerk middleware in local mode", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    const clerkMiddleware = vi.fn(() => {
      throw new Error("Clerk middleware should not initialize in local mode");
    });
    vi.doMock("@clerk/nextjs/server", () => ({ clerkMiddleware }));

    const proxy = (await import("./proxy")).default;

    expect(clerkMiddleware).not.toHaveBeenCalled();
    expect(proxy(new Request("https://curiogarden.org/dashboard"))).toBeTruthy();
  });
});
