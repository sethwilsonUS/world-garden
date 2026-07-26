// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthAwareTtsProfileProvider,
  PublicTtsProfileProvider,
  useTtsProfile,
} from "./tts-audience";

const auth = vi.hoisted(() => ({
  isLoaded: false,
  isSignedIn: false as boolean | undefined,
}));

const convexAuth = vi.hoisted(() => ({
  isLoading: true,
  isAuthenticated: false,
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => auth,
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => convexAuth,
}));

const ProfileProbe = () => {
  const profile = useTtsProfile();
  return createElement(
    "output",
    null,
    `${profile.provider}|${profile.ttsCacheKey}`,
  );
};

const renderProvider = (
  Provider: ({ children }: { children: ReactNode }) => ReactNode,
) =>
  renderToStaticMarkup(
    createElement(Provider, null, createElement(ProfileProbe)),
  );

describe("TTS audience profiles", () => {
  beforeEach(() => {
    auth.isLoaded = false;
    auth.isSignedIn = undefined;
    convexAuth.isLoading = true;
    convexAuth.isAuthenticated = false;
  });

  it("uses Edge when authentication is unavailable in local mode", () => {
    const markup = renderProvider(PublicTtsProfileProvider);

    expect(markup).toContain("edge|tts:edge:");
    expect(markup).not.toContain("openai");
  });

  it("fails safely to Edge while Clerk is loading", () => {
    auth.isLoaded = false;
    auth.isSignedIn = true;

    const markup = renderProvider(AuthAwareTtsProfileProvider);

    expect(markup).toContain("edge|tts:edge:");
    expect(markup).not.toContain("openai");
  });

  it("uses Edge for a resolved signed-out session", () => {
    auth.isLoaded = true;
    auth.isSignedIn = false;

    expect(renderProvider(AuthAwareTtsProfileProvider)).toContain(
      "edge|tts:edge:",
    );
  });

  it("stays on Edge while a signed-in Clerk session waits for Convex", () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;

    const markup = renderProvider(AuthAwareTtsProfileProvider);

    expect(markup).toContain("edge|tts:edge:");
    expect(markup).not.toContain("openai");
  });

  it("stays on Edge when Convex cannot authenticate a signed-in Clerk session", () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;
    convexAuth.isLoading = false;
    convexAuth.isAuthenticated = false;

    const markup = renderProvider(AuthAwareTtsProfileProvider);

    expect(markup).toContain("edge|tts:edge:");
    expect(markup).not.toContain("openai");
  });

  it("uses OpenAI only after both Clerk and Convex authenticate", () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;
    convexAuth.isLoading = false;
    convexAuth.isAuthenticated = true;

    const markup = renderProvider(AuthAwareTtsProfileProvider);

    expect(markup).toContain("openai|tts:openai:");
    expect(markup).not.toContain("edge|tts:edge:");
  });
});
