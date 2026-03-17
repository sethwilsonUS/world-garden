import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardPage from "./page";

let authState: "loading" | "signed-in" | "signed-out" = "signed-out";

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
    feedToken: "opaque-token",
    feedUrl: "https://curiogarden.org/api/podcast/personal.xml?token=opaque-token",
    isAvailable: true,
    isLoaded: true,
    addBySlug: async () => {},
    remove: async () => {},
    moveUp: async () => {},
    moveDown: async () => {},
    retry: async () => {},
    isAdding: () => false,
    isInPlaylist: () => false,
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
    expect(markup).toContain("Badges &amp; streaks");
  });

  it("renders the signed-in dashboard modules", () => {
    authState = "signed-in";

    const markup = renderToStaticMarkup(createElement(DashboardPage));

    expect(markup).toContain("Welcome back, Seth");
    expect(markup).toContain("Open Library");
    expect(markup).toContain("2 saved articles");
    expect(markup).toContain("Playlist");
    expect(markup).toContain("opaque-token");
    expect(markup).toContain("Badges &amp; streaks");
  });
});
