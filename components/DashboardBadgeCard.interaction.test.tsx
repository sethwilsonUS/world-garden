// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildEmptyBadgeCreditsByBadge,
  type BadgeCreditEntry,
  type BadgeProgress,
} from "@/lib/badges";
import { DashboardBadgeCard } from "./DashboardBadgeCard";

const mocks = vi.hoisted(() => ({
  isSignedIn: false,
  isAuthenticated: false,
  liveCredits: undefined as BadgeCreditEntry[] | undefined,
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isSignedIn: mocks.isSignedIn }),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.isAuthenticated }),
  useQuery: () => mocks.liveCredits,
}));

vi.mock("@/convex/_generated/api", () => ({
  api: {
    badges: {
      getViewerBadgeCreditsByKey: "getViewerBadgeCreditsByKey",
    },
  },
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const historyBadge: BadgeProgress = {
  key: "history",
  label: "History",
  description: "Stories of empires.",
  glyph: "quill-scroll",
  exp: 2,
  creditedArticleCount: 1,
  level: 0,
  expIntoLevel: 2,
  expForNextLevel: 5,
  nextLevelTarget: 5,
};

const fallbackCredit: BadgeCreditEntry = {
  wikiPageId: "roman-empire",
  slug: "Roman_Empire",
  title: "Roman Empire",
  earnedAt: Date.UTC(2026, 0, 2),
};

describe("DashboardBadgeCard dialog", () => {
  let container: HTMLDivElement;
  let root: Root;
  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  const renderCard = async (totalExp = 2) => {
    const badgeCredits = buildEmptyBadgeCreditsByBadge();
    badgeCredits.history = [fallbackCredit];

    await act(async () => {
      root.render(
        <DashboardBadgeCard
          badges={[historyBadge]}
          badgeCredits={badgeCredits}
          totalExp={totalExp}
          unlockedBadgeCount={0}
          isLoaded
        />,
      );
      await Promise.resolve();
    });
  };

  const openDialog = async () => {
    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-haspopup="dialog"]',
    )!;
    trigger.focus();
    await act(async () => trigger.click());
    return trigger;
  };

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mocks.isSignedIn = false;
    mocks.isAuthenticated = false;
    mocks.liveCredits = undefined;
    requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });
    cancelAnimationFrameSpy = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.style.overflow = "";
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it("traps focus, closes on Escape, and restores the badge trigger", async () => {
    await renderCard();
    const trigger = await openDialog();
    const dialog = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
    const closeButton = dialog.querySelector<HTMLButtonElement>(
      'button[aria-label="Close History badge details"]',
    )!;
    const articleLink = dialog.querySelector<HTMLAnchorElement>("a[href]")!;

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(
      dialog.querySelector("section[aria-live=\"polite\"]"),
    ).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(closeButton);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);

    await renderCard(3);
    expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);

    articleLink.focus();
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(closeButton);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Tab",
          shiftKey: true,
          bubbles: true,
        }),
      );
    });
    expect(document.activeElement).toBe(articleLink);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
  });

  it("uses fallback credits while signed out", async () => {
    await renderCard();
    await openDialog();

    expect(document.body.textContent).toContain("Roman Empire");
    expect(document.body.textContent).not.toContain("Loading credited articles");
  });

  it("shows live loading, mismatch, and resolved credit states", async () => {
    mocks.isSignedIn = true;
    mocks.isAuthenticated = true;
    await renderCard();
    await openDialog();
    expect(document.body.textContent).toContain("Loading credited articles");

    mocks.liveCredits = [];
    await renderCard();
    expect(document.body.textContent).toContain(
      "their titles have not synced into the modal yet",
    );

    mocks.liveCredits = [
      {
        wikiPageId: "byzantine-empire",
        slug: "Byzantine_Empire",
        title: "Byzantine Empire",
        earnedAt: Date.UTC(2026, 1, 3),
      },
    ];
    await renderCard();
    expect(document.body.textContent).toContain("Byzantine Empire");
    expect(document.body.textContent).not.toContain(
      "their titles have not synced into the modal yet",
    );
  });
});
