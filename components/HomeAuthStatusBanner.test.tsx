// @vitest-environment jsdom

import { createElement, type ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchForm } from "./SearchForm";
import { HomeAuthStatusBanner } from "./HomeAuthStatusBanner";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

let authState: "loading" | "signed-in" | "signed-out" = "signed-out";
let convexAuthState: "loading" | "authenticated" | "unauthenticated" =
  "unauthenticated";

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

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isLoading: convexAuthState === "loading",
    isAuthenticated: convexAuthState === "authenticated",
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

describe("HomeAuthStatusBanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    authState = "signed-out";
    convexAuthState = "unauthenticated";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("shows compact guest-mode sign-in guidance without old Clerk setup jargon", () => {
    authState = "signed-out";

    const markup = renderToStaticMarkup(createElement(HomeAuthStatusBanner));

    expect(markup).toContain(
      "Curio Garden stays public without an account. Sign in for more natural article narration, synced bookmarks, your dashboard, and a personal playlist.",
    );
    expect(markup).toContain(
      "Sign in for more natural article narration, bookmarks, and your playlist.",
    );
    expect(markup).toContain("Sign in");
    expect(markup).not.toContain("Sign in when you want");
    expect(markup).not.toContain("Clerk-to-Convex");
  });

  it("shows compact dashboard and library CTAs when signed in", () => {
    authState = "signed-in";
    convexAuthState = "authenticated";

    const markup = renderToStaticMarkup(createElement(HomeAuthStatusBanner));

    expect(markup).toContain("Welcome back, Seth");
    expect(markup).toContain("Dashboard");
    expect(markup).toContain("Library");
    expect(markup).not.toContain("more natural article narration");
  });

  it("keeps account claims quiet while the Convex bridge is connecting", () => {
    authState = "signed-in";
    convexAuthState = "loading";

    const markup = renderToStaticMarkup(createElement(HomeAuthStatusBanner));

    expect(markup).toContain("Connecting your account");
    expect(markup).toContain("standard article voice");
    expect(markup).not.toContain("Dashboard has synced");
  });

  it("describes a degraded account bridge without claiming features are synced", () => {
    authState = "signed-in";
    convexAuthState = "unauthenticated";

    const markup = renderToStaticMarkup(createElement(HomeAuthStatusBanner));

    expect(markup).toContain("Account connection paused");
    expect(markup).toContain("Browsing still works");
    expect(markup).not.toContain("Dashboard has synced");
  });

  it("shows a quiet loading state while auth is resolving", () => {
    authState = "loading";

    const markup = renderToStaticMarkup(createElement(HomeAuthStatusBanner));

    expect(markup).toContain("Checking session");
    expect(markup).toContain("Account shortcuts will appear here");
    expect(markup).not.toContain("more natural article narration");
  });

  it("does not use live-region or alert semantics", () => {
    const markup = renderToStaticMarkup(createElement(HomeAuthStatusBanner));

    expect(markup).not.toContain("aria-live");
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain('role="alert"');
  });

  it("dismisses the banner for the current mount", async () => {
    await act(async () => {
      root.render(createElement(HomeAuthStatusBanner));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Browse now, sync later");

    const dismissButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss account notice"]',
    );

    expect(dismissButton).not.toBeNull();

    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain("Browse now, sync later");
  });

  it("keeps focus on the search input when auth state resolves and the banner dismisses", async () => {
    authState = "loading";
    convexAuthState = "loading";

    await act(async () => {
      root.render(
        <>
          <HomeAuthStatusBanner />
          <SearchForm />
        </>,
      );
      await Promise.resolve();
    });

    const searchInput = document.getElementById("search-input");
    expect(searchInput).toBeInstanceOf(HTMLInputElement);
    searchInput?.focus();
    expect(document.activeElement).toBe(searchInput);

    authState = "signed-in";
    convexAuthState = "authenticated";

    await act(async () => {
      root.render(
        <>
          <HomeAuthStatusBanner />
          <SearchForm />
        </>,
      );
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(searchInput);

    const dismissButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss account notice"]',
    );

    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(searchInput);
  });

  it("moves focus to search when the focused dismiss button removes itself", async () => {
    await act(async () => {
      root.render(
        <>
          <HomeAuthStatusBanner />
          <SearchForm />
        </>,
      );
      await Promise.resolve();
    });

    const searchInput = document.getElementById("search-input");
    const dismissButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss account notice"]',
    );
    expect(searchInput).toBeInstanceOf(HTMLInputElement);
    expect(dismissButton).toBeInstanceOf(HTMLButtonElement);

    dismissButton?.focus();
    expect(document.activeElement).toBe(dismissButton);

    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(searchInput);
    expect(document.body.textContent).not.toContain("Browse now, sync later");
  });
});
