import { afterEach, describe, expect, it, vi } from "vitest";

const originalLocalMode = process.env.LOCAL_MODE;
const originalPublicLocalMode = process.env.NEXT_PUBLIC_LOCAL_MODE;

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
  restoreEnvValue("LOCAL_MODE", originalLocalMode);
  restoreEnvValue("NEXT_PUBLIC_LOCAL_MODE", originalPublicLocalMode);
});

describe("proxy", () => {
  it("does not initialize Clerk middleware when server local mode is enabled", async () => {
    process.env.LOCAL_MODE = "true";
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    const clerkMiddleware = vi.fn(() => {
      throw new Error("Clerk middleware should not initialize in local mode");
    });
    vi.doMock("@clerk/nextjs/server", () => ({ clerkMiddleware }));

    const proxy = (await import("./proxy")).default;

    expect(clerkMiddleware).not.toHaveBeenCalled();
    expect(
      proxy(new Request("https://curiogarden.org/dashboard") as never, {} as never),
    ).toBeTruthy();
  });

  it("keeps Clerk middleware active when only the public local-mode flag is set", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    const clerkHandler = vi.fn(() => new Response("clerk"));
    const clerkMiddleware = vi.fn(() => clerkHandler);
    vi.doMock("@clerk/nextjs/server", () => ({ clerkMiddleware }));

    const proxy = (await import("./proxy")).default;

    expect(clerkMiddleware).toHaveBeenCalledTimes(1);
    proxy(new Request("https://curiogarden.org/dashboard") as never, {} as never);
    expect(clerkHandler).toHaveBeenCalledTimes(1);
  });
});
