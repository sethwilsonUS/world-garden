import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeAuthStatusCard } from "./HomeAuthStatusCard";

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
  }),
}));

vi.mock("@/hooks/useBookmarks", () => ({
  useBookmarks: () => ({
    entries: [{ slug: "mars", title: "Mars", savedAt: 10 }],
    isLoaded: true,
    storageMode: "account",
    isBookmarked: () => false,
    toggle: () => {},
    remove: () => {},
  }),
}));

describe("HomeAuthStatusCard", () => {
  it("shows guest-mode sign-in guidance without old Clerk setup jargon", () => {
    authState = "signed-out";

    const markup = renderToStaticMarkup(createElement(HomeAuthStatusCard));

    expect(markup).toContain("Continue with Google or create an email account");
    expect(markup).not.toContain("Clerk-to-Convex");
  });

  it("shows an open-dashboard CTA when signed in", () => {
    authState = "signed-in";

    const markup = renderToStaticMarkup(createElement(HomeAuthStatusCard));

    expect(markup).toContain("Open Dashboard");
    expect(markup).toContain("Open Library");
  });
});
