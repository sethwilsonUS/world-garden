// @vitest-environment jsdom

import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BadgeProgressToastProvider,
  useBadgeProgressToasts,
} from "./BadgeProgressToastProvider";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

const TriggerToasts = ({
  articleTitle,
  badges,
}: {
  articleTitle: string;
  badges: Parameters<
    ReturnType<typeof useBadgeProgressToasts>["showBadgeProgressToasts"]
  >[0]["badges"];
}) => {
  const { showBadgeProgressToasts } = useBadgeProgressToasts();

  useEffect(() => {
    showBadgeProgressToasts({ articleTitle, badges });
  }, [articleTitle, badges, showBadgeProgressToasts]);

  return null;
};

describe("BadgeProgressToastProvider", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("renders its children without crashing in static markup", () => {
    const markup = renderToStaticMarkup(
      <BadgeProgressToastProvider>
        <div>hello</div>
      </BadgeProgressToastProvider>,
    );

    expect(markup).toContain("hello");
  });

  it("shows one toast per awarded badge", async () => {
    await act(async () => {
      root.render(
        <BadgeProgressToastProvider>
          <TriggerToasts
            articleTitle="Roman roads"
            badges={[
              {
                key: "history",
                label: "History",
                description: "Stories of empires.",
                glyph: "quill-scroll",
                exp: 1,
                creditedArticleCount: 1,
                level: 0,
                expIntoLevel: 1,
                expForNextLevel: 5,
                nextLevelTarget: 5,
                previousLevel: 0,
                leveledUp: false,
                gainedExp: 1,
              },
              {
                key: "technology",
                label: "Technology",
                description: "Machines, etc.",
                glyph: "gear",
                exp: 1,
                creditedArticleCount: 1,
                level: 0,
                expIntoLevel: 1,
                expForNextLevel: 5,
                nextLevelTarget: 5,
                previousLevel: 0,
                leveledUp: false,
                gainedExp: 1,
              },
            ]}
          />
        </BadgeProgressToastProvider>,
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("History");
    expect(document.body.textContent).toContain("Technology");
    expect(document.body.querySelectorAll('article[aria-label*="Credited from"]').length).toBe(2);
    expect(
      document.body.querySelector('section[aria-label="Badge progress"]')?.className,
    ).toContain("bottom-4");
  });

  it("uses special level-up copy and icon when a badge levels up", async () => {
    await act(async () => {
      root.render(
        <BadgeProgressToastProvider>
          <TriggerToasts
            articleTitle="Roman Empire"
            badges={[
              {
                key: "history",
                label: "History",
                description: "Stories of empires.",
                glyph: "quill-scroll",
                exp: 5,
                creditedArticleCount: 5,
                level: 1,
                expIntoLevel: 0,
                expForNextLevel: 10,
                nextLevelTarget: 15,
                previousLevel: 0,
                leveledUp: true,
                gainedExp: 1,
              },
            ]}
          />
        </BadgeProgressToastProvider>,
      );
      await Promise.resolve();
    });

    expect(document.body.textContent).toContain("Badge leveled up");
    expect(document.body.textContent).toContain(
      "Roman Empire pushed History from level 0 to level 1.",
    );
    expect(document.body.textContent).toContain("Up from Lvl 0");
    expect(document.body.querySelector('[data-level-up-icon="true"]')).not.toBeNull();
  });

  it("keeps badge toasts visible until they are dismissed", async () => {
    await act(async () => {
      root.render(
        <BadgeProgressToastProvider>
          <TriggerToasts
            articleTitle="Henry Villard"
            badges={[
              {
                key: "history",
                label: "History",
                description: "Stories of empires.",
                glyph: "quill-scroll",
                exp: 1,
                creditedArticleCount: 1,
                level: 0,
                expIntoLevel: 1,
                expForNextLevel: 5,
                nextLevelTarget: 5,
                previousLevel: 0,
                leveledUp: false,
                gainedExp: 1,
              },
            ]}
          />
        </BadgeProgressToastProvider>,
      );
      await Promise.resolve();
    });

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(document.body.textContent).toContain("History");

    const dismissButton = document.body.querySelector(
      'button[aria-label="Dismiss badge progress for History"]',
    );

    expect(dismissButton).not.toBeNull();

    await act(async () => {
      dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      document.body.querySelector('button[aria-label="Dismiss badge progress for History"]'),
    ).toBeNull();
    expect(document.body.querySelectorAll('article[aria-label*="Credited from"]').length).toBe(0);
  });
});
