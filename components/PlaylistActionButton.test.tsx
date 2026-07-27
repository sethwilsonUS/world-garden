import { createElement, type ReactNode } from "react";
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

  it("explains that Playlist creates a podcast episode", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    vi.doMock("@clerk/nextjs", () => ({
      SignInButton: ({ children }: { children: ReactNode }) =>
        createElement("div", null, children),
      useAuth: () => ({
        isLoaded: true,
        isSignedIn: false,
      }),
    }));
    vi.doMock("@/hooks/usePersonalPlaylist", () => ({
      usePersonalPlaylist: () => ({
        addBySlug: vi.fn(),
        isAdding: () => false,
        isAvailable: false,
        isLoaded: true,
        isInPlaylist: () => false,
      }),
    }));

    const { PlaylistActionButton } = await import("./PlaylistActionButton");
    const markup = renderToStaticMarkup(
      createElement(PlaylistActionButton, {
        slug: "Taylor_Swift",
        title: "Taylor Swift",
        variant: "labeled",
      }),
    );

    expect(markup).toContain("Add to Playlist");
    expect(markup).toContain(
      'aria-label="Add to Playlist: sign in to add Taylor Swift and generate a podcast episode"',
    );
    expect(markup).toContain(
      'title="Playlist: sign in to generate a podcast episode"',
    );
  });
});
