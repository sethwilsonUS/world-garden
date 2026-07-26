import { describe, expect, it } from "vitest";
import { resolveTtsProviderAccess } from "./tts-access-policy";

describe("resolveTtsProviderAccess", () => {
  it("defaults public requests to Edge and authenticated requests to OpenAI", () => {
    expect(resolveTtsProviderAccess({ audience: "public" })).toEqual({
      requestedProvider: "edge",
      provider: "edge",
    });
    expect(resolveTtsProviderAccess({ audience: "authenticated" })).toEqual({
      requestedProvider: "openai",
      provider: "openai",
    });
  });

  it("coerces public OpenAI requests to Edge with an auth reason", () => {
    expect(
      resolveTtsProviderAccess({
        audience: "public",
        requestedProvider: "openai",
      }),
    ).toEqual({
      requestedProvider: "openai",
      provider: "edge",
      fallbackReason: "openai_auth",
    });
  });

  it("preserves explicit Edge for signed-in and trusted callers", () => {
    expect(
      resolveTtsProviderAccess({
        audience: "authenticated",
        requestedProvider: "edge",
      }),
    ).toEqual({ requestedProvider: "edge", provider: "edge" });
    expect(
      resolveTtsProviderAccess({
        audience: "public",
        requestedProvider: "edge",
        trusted: true,
      }),
    ).toEqual({ requestedProvider: "edge", provider: "edge" });
  });

  it("allows trusted explicit OpenAI while keeping its omitted default public", () => {
    expect(
      resolveTtsProviderAccess({
        audience: "public",
        requestedProvider: "openai",
        trusted: true,
      }),
    ).toEqual({ requestedProvider: "openai", provider: "openai" });
    expect(
      resolveTtsProviderAccess({ audience: "public", trusted: true }),
    ).toEqual({ requestedProvider: "edge", provider: "edge" });
  });

  it("forces local mode to Edge", () => {
    expect(
      resolveTtsProviderAccess({
        audience: "authenticated",
        requestedProvider: "openai",
        localMode: true,
        trusted: true,
      }),
    ).toEqual({
      requestedProvider: "openai",
      provider: "edge",
      fallbackReason: "openai_auth",
    });
  });
});
