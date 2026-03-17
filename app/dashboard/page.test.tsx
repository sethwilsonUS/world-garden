import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardPage from "./page";

let authState: "loading" | "signed-in" | "signed-out" = "signed-out";

vi.mock("convex/react", () => ({
  AuthLoading: ({ children }: { children: ReactNode }) =>
    authState === "loading" ? createElement("div", null, children) : null,
  Unauthenticated: ({ children }: { children: ReactNode }) =>
    authState === "signed-out" ? createElement("div", null, children) : null,
  Authenticated: ({ children }: { children: ReactNode }) =>
    authState === "signed-in" ? createElement("div", null, children) : null,
}));

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-clerk-button": "sign-in" }, children),
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
    expect(markup).toContain("Badges &amp; streaks");
  });
});
