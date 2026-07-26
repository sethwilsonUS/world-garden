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

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => auth,
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

  it("uses OpenAI only for a resolved signed-in session", () => {
    auth.isLoaded = true;
    auth.isSignedIn = true;

    const markup = renderProvider(AuthAwareTtsProfileProvider);

    expect(markup).toContain("openai|tts:openai:");
    expect(markup).not.toContain("edge|tts:edge:");
  });
});
