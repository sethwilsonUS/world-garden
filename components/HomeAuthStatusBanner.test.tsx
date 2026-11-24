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

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

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
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("shows a one-line guest note with a single sign-in action", () => {
    authState = "signed-out";

    const markup = renderToStaticMarkup(createElement(HomeAuthStatusBanner));

    expect(markup).toContain("No account needed.");
    expect(markup).toContain(
      "Sign in for more natural narration, a synced Library, and your personal podcast playlist.",
    );
    expect(markup.match(/>Sign in</g)).toHaveLength(1);
    expect(markup).not.toContain(">Library<");
    expect(markup).not.toContain("Sign in when you want");
    expect(markup).not.toContain("Clerk-to-Convex");
  });

  it("shows a compact welcome with a dashboard link when signed in", () => {
    authState = "signed-in";
    convexAuthState = "authenticated";

    const markup = renderToStaticMarkup(createElement(HomeAuthStatusBanner));

    expect(markup).toContain("Welcome back, Seth");
    expect(markup).toContain("Open Dashboard");
    expect(markup).toContain("1 saved article waiting in Library.");
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

  it("reserves space without text while auth is resolving", () => {
    authState = "loading";

    const markup = renderToStaticMarkup(createElement(HomeAuthStatusBanner));

    expect(markup).toContain("min-h-11");
    expect(markup).toContain("data-home-account-note");
    expect(markup).not.toContain("Sign in");
    expect(markup).not.toContain("<aside");
  });

  it("does not use live-region or alert semantics", () => {
    const markup = renderToStaticMarkup(createElement(HomeAuthStatusBanner));

    expect(markup).not.toContain("aria-live");
    expect(markup).not.toContain('role="status"');
    expect(markup).not.toContain('role="alert"');
  });

  it("remembers a dismissed guest note across remounts", async () => {
    await act(async () => {
      root.render(createElement(HomeAuthStatusBanner));
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("No account needed.");

    const dismissButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss account note"]',
    );

    expect(dismissButton).not.toBeNull();

    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain("No account needed.");

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(HomeAuthStatusBanner));
      await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain("No account needed.");

    authState = "signed-in";
    convexAuthState = "authenticated";
    await act(async () => {
      root.render(createElement(HomeAuthStatusBanner));
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("Welcome back, Seth");
  });

  it.each(["getItem", "setItem"] as const)(
    "dismisses notes independently for this view when storage %s throws",
    async (operation) => {
      vi.spyOn(Storage.prototype, operation).mockImplementation(() => {
        throw new DOMException("Storage is blocked", "SecurityError");
      });
      vi.spyOn(console, "debug").mockImplementation(() => {});
      const renderNote = () => act(() => root.render(<HomeAuthStatusBanner />));
      const dismissNote = () => {
        const button = container.querySelector<HTMLButtonElement>(
          'button[aria-label="Dismiss account note"]',
        );
        expect(button).not.toBeNull();
        return act(() => button?.click());
      };

      await renderNote();
      await dismissNote();
      expect(container.querySelector("aside")).toBeNull();

      authState = "signed-in";
      convexAuthState = "authenticated";
      await renderNote();
      expect(container.textContent).toContain("Welcome back, Seth");
      await dismissNote();
      expect(container.querySelector("aside")).toBeNull();

      authState = "signed-out";
      await renderNote();
      expect(container.querySelector("aside")).toBeNull();
    },
  );

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
      'button[aria-label="Dismiss account note"]',
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
      'button[aria-label="Dismiss account note"]',
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
    expect(document.body.textContent).not.toContain("No account needed.");
  });
});
