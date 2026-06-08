import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
  vi.doUnmock("@clerk/nextjs");
  vi.doUnmock("@/hooks/usePersonalPlaylist");
  restoreEnvValue("NEXT_PUBLIC_LOCAL_MODE", originalLocalMode);
});

describe("PlaylistActionButton", () => {
  it("does not touch Clerk or playlist hooks in local mode", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    vi.doMock("@clerk/nextjs", () => ({
      SignInButton: () => {
        throw new Error("Clerk component should not render in local mode");
      },
      useAuth: () => {
        throw new Error("Clerk hook should not run in local mode");
      },
    }));
    vi.doMock("@/hooks/usePersonalPlaylist", () => ({
      usePersonalPlaylist: () => {
        throw new Error("Playlist hook should not run in local mode");
      },
    }));

    const { PlaylistActionButton } = await import("./PlaylistActionButton");

    expect(
      renderToStaticMarkup(
        createElement(PlaylistActionButton, {
          slug: "Taylor_Swift",
          title: "Taylor Swift",
        }),
      ),
    ).toBe("");
  });
});
