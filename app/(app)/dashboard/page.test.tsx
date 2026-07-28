import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardPage from "./page";

let authState: "loading" | "signed-in" | "signed-out" = "signed-out";
let playlistIsAvailable = true;
let playlistIsLoaded = true;
const originalLocalMode = process.env.NEXT_PUBLIC_LOCAL_MODE;

const restoreEnvValue = (key: string, value: string | undefined) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

afterEach(() => {
  restoreEnvValue("NEXT_PUBLIC_LOCAL_MODE", originalLocalMode);
  playlistIsAvailable = true;
  playlistIsLoaded = true;
});

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-clerk-button": "sign-in" }, children),
  useAuth: () => ({
    isLoaded: authState !== "loading",
    isSignedIn: authState === "signed-in",
  }),
  useUser: () => ({
    user: {
      firstName: "Seth",
      fullName: "Seth Wilson",
      primaryEmailAddress: { emailAddress: "seth@example.com" },
    },
    isLoaded: true,
  }),
}));

vi.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({
    entries: [
      { slug: "mars", title: "Mars", savedAt: 10 },
      { slug: "venus", title: "Venus", savedAt: 20 },
    ],
    isLoaded: true,
    storageMode: "account",
    isBookmarked: () => false,
    toggle: () => {},
    remove: () => {},
  }),
}));

vi.mock("@/hooks/usePersonalPlaylist", () => ({
  usePersonalPlaylist: () => ({
    entries: [
      {
        _id: "playlist-1",
        slug: "mars",
        title: "Mars",
        position: 0,
        publishedAt: 10,
        status: "ready",
      },
    ],
    feedStatus: "active",
    feedUrl:
      "https://curiogarden.org/api/podcast/personal.xml?token=opaque-token",
    isAvailable: playlistIsAvailable,
    isFeedUpdating: false,
    isLoaded: playlistIsLoaded,
    addBySlug: async () => {},
    rotateFeed: async () => {},
    revokeFeed: async () => {},
    remove: async () => {},
    moveUp: async () => {},
    moveDown: async () => {},
    retry: async () => {},
    isAdding: () => false,
    isInPlaylist: () => false,
  }),
}));

vi.mock("@/hooks/useBadges", () => ({
  useBadges: () => ({
    badges: [
      {
        key: "history",
        label: "History",
        description: "Stories of empires.",
        glyph: "quill-scroll",
        exp: 0,
        creditedArticleCount: 0,
        level: 0,
        expIntoLevel: 0,
        expForNextLevel: 5,
        nextLevelTarget: 5,
      },
    ],
    totalExp: 0,
    unlockedBadgeCount: 0,
    isLoaded: true,
  }),
}));

vi.mock("@/lib/analytics", () => ({
  analytics: {
    dashboardPageAccessed: vi.fn(),
  },
}));

describe("DashboardPage", () => {
  it("renders a sign-in teaser for signed-out visitors", () => {
    authState = "signed-out";

    const markup = renderToStaticMarkup(createElement(DashboardPage));

    expect(markup).toContain("Sign in to open your dashboard");
    expect(markup).toContain("Open Library");
    expect(markup).toContain("Playlist");
    expect(markup).toContain("Topic badges");
    expect(markup).toContain("Available when signed in");
    expect(markup).not.toContain("Coming soon");
    expect(markup).not.toContain("Planned next");
    expect(markup).not.toContain("Future garden");
  });

  it("renders the signed-in dashboard modules", () => {
    authState = "signed-in";

    const markup = renderToStaticMarkup(createElement(DashboardPage));

    expect(markup).toContain("Welcome back, Seth");
    expect(markup).toContain("Open Library");
    expect(markup).toContain("2 saved articles");
    expect(markup).toContain("Playlist");
    expect(markup).toContain("opaque-token");
    expect(markup).toContain("Your private feed is active");
    expect(markup).toContain("Signed-in progress");
    expect(markup).toContain('href="/account"');
    expect(markup).toContain("Account &amp; data");
    expect(markup).toContain(
      "Podcast plays in podcast apps do not count toward badges yet.",
    );
  });

  it("does not offer account-data controls to signed-out visitors", () => {
    authState = "signed-out";

    const markup = renderToStaticMarkup(createElement(DashboardPage));

    expect(markup).not.toContain('href="/account"');
    expect(markup).not.toContain("Account &amp; data");
  });

  it("waits for account hydration before exposing private feed controls", () => {
    authState = "signed-in";
    playlistIsAvailable = false;
    playlistIsLoaded = false;

    const markup = renderToStaticMarkup(createElement(DashboardPage));

    expect(markup).toContain("Syncing queue");
    expect(markup).not.toContain("opaque-token");
    expect(markup).not.toContain("Create private feed URL");
    expect(markup).not.toContain("Private RSS feed is not created");
  });

  it("renders the local-mode dashboard without touching Clerk", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    vi.resetModules();
    vi.doMock("@clerk/nextjs", () => ({
      SignInButton: () => {
        throw new Error("Clerk component should not render in local mode");
      },
      useAuth: () => {
        throw new Error("Clerk hook should not run in local mode");
      },
      useUser: () => {
        throw new Error("Clerk hook should not run in local mode");
      },
    }));

    const LocalDashboardPage = (await import("./page")).default;
    const markup = renderToStaticMarkup(createElement(LocalDashboardPage));

    expect(markup).toContain(
      "Dashboard is only available with accounts enabled",
    );
  });
});
