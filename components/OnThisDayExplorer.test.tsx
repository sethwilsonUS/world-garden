// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnThisDayExplorer } from "./OnThisDayExplorer";
import { OnThisDaySessionProvider } from "./OnThisDaySessionProvider";
import type {
  OnThisDayCategory,
  OnThisDayOrder,
  OnThisDayPageResponse,
} from "@/lib/on-this-day-contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { pushMock, pathnameRef, searchParamsRef } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  pathnameRef: { current: "/on-this-day/july-30" },
  searchParamsRef: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathnameRef.current,
  useSearchParams: () => searchParamsRef.current,
}));

const counts = {
  selected: 1,
  events: 30,
  births: 2,
  deaths: 3,
  holidays: 4,
};
const availableCategories = {
  selected: true,
  events: true,
  births: true,
  deaths: true,
  holidays: true,
};

const responseFor = (url: string): OnThisDayPageResponse => {
  const parsed = new URL(url, "https://curiogarden.org");
  const calendarDay = parsed.searchParams.get("day") ?? "07-30";
  const category = (parsed.searchParams.get("category") ??
    "selected") as OnThisDayCategory;
  const offset = Number(parsed.searchParams.get("offset") ?? 0);
  const order = (parsed.searchParams.get("order") ??
    "newest") as OnThisDayOrder;
  const total = counts[category];
  const length = Math.min(25, total - offset);
  const items = Array.from({ length }, (_, index) => {
    const sequence = offset + index;
    return {
      id: `${calendarDay}-${category}-${order}-${sequence}`,
      year: order === "newest" ? 2000 - sequence : 1900 + sequence,
      text: `${category} item ${sequence + 1} (${calendarDay})`,
      pages: [],
    };
  });
  return {
    calendarDay,
    checkedAt: Date.UTC(2026, 10, 20, 12, 0, 0),
    changedAt: Date.UTC(2026, 10, 19, 12, 0, 0),
    degraded: false,
    provider: "wikipedia-rest-v1",
    sourceUrl: "https://en.wikipedia.org/wiki/July_30",
    category,
    order,
    offset,
    limit: 25,
    total,
    nextOffset: offset + length < total ? offset + length : null,
    counts,
    availableCategories,
    items,
  };
};

const fetchMock = vi.fn<typeof fetch>();

describe("OnThisDayExplorer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    pathnameRef.current = "/on-this-day/july-30";
    searchParamsRef.current = new URLSearchParams();
    window.history.replaceState(null, "", "/on-this-day/july-30");
    pushMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input) =>
      Response.json(responseFor(String(input))),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses Wikimedia's human-authored description as the image alternative and shows quiet freshness copy", async () => {
    fetchMock.mockImplementationOnce(async (input) => {
      const response = responseFor(String(input));
      return Response.json({
        ...response,
        items: response.items.map((item, index) =>
          index === 0
            ? {
                ...item,
                image: {
                  source:
                    "https://upload.wikimedia.org/wikipedia/commons/apollo.jpg",
                  width: 640,
                  height: 480,
                  articleTitle: "Apollo 11",
                  altText:
                    "Apollo 11 astronauts in a life raft after their Pacific splashdown.",
                },
              }
            : item,
        ),
      });
    });

    await act(async () =>
      root.render(
        <OnThisDayExplorer initialDay={{ month: 7, day: 30 }} />,
      ),
    );
    await act(async () => undefined);

    expect(container.querySelector("h1")?.textContent).toBe(
      "On This Day: July 30",
    );
    expect(container.querySelector("img")?.getAttribute("alt")).toBe(
      "Apollo 11 astronauts in a life raft after their Pacific splashdown.",
    );
    expect(container.querySelector(".on-this-day-source-note")?.textContent).toContain(
      "Lists from Wikipedia, last checked Nov 20, 2026.",
    );
    expect(container.textContent).not.toContain("(UTC)");
  });

  it("uses manual keyboard tabs, updates URL via replaceState, and progressively reveals a cached category", async () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    await act(async () =>
      root.render(
        <OnThisDayExplorer initialDay={{ month: 7, day: 30 }} />,
      ),
    );
    await act(async () => undefined);

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    expect(
      tabs.map((tab) => tab.textContent?.replace(/, \d+ items$/u, "")),
    ).toEqual([
      "Highlights 1",
      "Events 30",
      "Births 2",
      "Deaths 3",
      "Holidays 4",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("selected item 1");
    const persistentStatus = container.querySelector(
      "#on-this-day-live-status",
    );
    expect(persistentStatus).not.toBeNull();
    expect(persistentStatus?.textContent).toBe(
      "Showing 1 of 1 highlight, newest first.",
    );

    tabs[0].focus();
    await act(async () =>
      tabs[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () =>
      tabs[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      ),
    );
    await act(async () => undefined);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      "",
      "/on-this-day/july-30?category=events",
    );
    expect(container.querySelector("#on-this-day-live-status")).toBe(
      persistentStatus,
    );
    expect(document.activeElement).toBe(tabs[1]);
    expect(container.querySelectorAll("ol.timeline-list > li")).toHaveLength(
      25,
    );

    const showMore = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Show 5 more"),
    ) as HTMLButtonElement;
    showMore.focus();
    await act(async () => showMore.click());
    await act(async () => undefined);
    expect(container.querySelectorAll("ol.timeline-list > li")).toHaveLength(
      30,
    );
    expect(document.activeElement).toBe(showMore);

    await act(async () => {
      tabs[0].click();
      tabs[1].click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps focus on the sort control while requesting the opposite end and syncs non-default sort to URL", async () => {
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    await act(async () =>
      root.render(
        <OnThisDayExplorer initialDay={{ month: 7, day: 30 }} />,
      ),
    );
    await act(async () => undefined);
    const eventsTab = container.querySelector<HTMLButtonElement>(
      "#on-this-day-tab-events",
    )!;
    await act(async () => eventsTab.click());
    await act(async () => undefined);

    const sortButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Oldest first",
    ) as HTMLButtonElement;
    let resolveOldestRequest: (() => void) | undefined;
    fetchMock.mockImplementationOnce(
      async (input) =>
        await new Promise<Response>((resolve) => {
          resolveOldestRequest = () =>
            resolve(Response.json(responseFor(String(input))));
        }),
    );
    sortButton.focus();
    await act(async () => sortButton.click());

    expect(document.activeElement).toBe(sortButton);
    expect(sortButton.textContent).toBe("Oldest first");
    expect(container.querySelector("ol.timeline-list time")?.textContent).toBe(
      "2000",
    );
    expect(container.querySelector("#on-this-day-live-status")?.textContent).toBe(
      "Loading events…",
    );
    expect(replaceStateSpy).toHaveBeenLastCalledWith(
      null,
      "",
      "/on-this-day/july-30?category=events&order=oldest",
    );

    await act(async () => resolveOldestRequest?.());
    await act(async () => undefined);

    expect(document.activeElement).toBe(sortButton);
    expect(sortButton.textContent).toBe("Newest first");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("order=oldest");
    expect(container.querySelector("ol.timeline-list time")?.textContent).toBe(
      "1900",
    );
  });

  it("preserves loaded items and offers a retry after a pagination failure", async () => {
    await act(async () =>
      root.render(
        <OnThisDayExplorer initialDay={{ month: 7, day: 30 }} />,
      ),
    );
    await act(async () => undefined);
    const eventsTab = container.querySelector<HTMLButtonElement>(
      "#on-this-day-tab-events",
    )!;
    await act(async () => eventsTab.click());
    await act(async () => undefined);

    fetchMock.mockImplementationOnce(async () =>
      Response.json(
        { error: "Wikimedia took the scenic route." },
        { status: 503 },
      ),
    );
    const showMore = container.querySelector<HTMLButtonElement>(
      ".on-this-day-show-more",
    )!;
    await act(async () => showMore.click());
    await act(async () => undefined);

    expect(container.querySelectorAll("ol.timeline-list > li")).toHaveLength(
      25,
    );
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try loading these events again",
    ) as HTMLButtonElement;
    expect(retry).toBeTruthy();

    await act(async () => retry.click());
    await act(async () => undefined);
    expect(container.querySelectorAll("ol.timeline-list > li")).toHaveLength(
      30,
    );
  });

  it("aborts an obsolete category request when returning to cached results", async () => {
    await act(async () =>
      root.render(
        <OnThisDayExplorer initialDay={{ month: 7, day: 30 }} />,
      ),
    );
    await act(async () => undefined);
    let aborted = false;
    fetchMock.mockImplementationOnce(
      async (_input, init) =>
        await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );

    const eventsTab = container.querySelector<HTMLButtonElement>(
      "#on-this-day-tab-events",
    )!;
    const highlightsTab = container.querySelector<HTMLButtonElement>(
      "#on-this-day-tab-selected",
    )!;
    await act(async () => eventsTab.click());
    await act(async () => highlightsTab.click());
    await act(async () => undefined);

    expect(aborted).toBe(true);
    expect(highlightsTab.getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("selected item 1");
  });

  it("shows degraded status message and disables unavailable tabs", async () => {
    fetchMock.mockImplementationOnce(async (input) =>
      Response.json({
        ...responseFor(String(input)),
        degraded: true,
        provider: "featured-fallback",
        counts: {
          selected: 1,
          events: 0,
          births: 0,
          deaths: 0,
          holidays: 0,
        },
        availableCategories: {
          selected: true,
          events: false,
          births: false,
          deaths: false,
          holidays: false,
        },
      }),
    );
    await act(async () =>
      root.render(
        <OnThisDayExplorer initialDay={{ month: 7, day: 30 }} />,
      ),
    );
    await act(async () => undefined);

    expect(
      container.querySelector(".on-this-day-degraded-status")?.textContent,
    ).toBe("Only highlights are available for this day right now.");

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    expect(tabs[0].disabled).toBe(false);
    expect(tabs.slice(1).every((tab) => tab.disabled)).toBe(true);
    expect(tabs[1].getAttribute("aria-label")).toBe("Events 0 items");

    tabs[0].focus();
    await act(async () =>
      tabs[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("caches days independently across navigation, preserves day-specific items on return, and pushes picker selections preserving tab and sort", async () => {
    searchParamsRef.current = new URLSearchParams(
      "category=births&order=oldest",
    );

    await act(async () =>
      root.render(
        <OnThisDaySessionProvider>
          <OnThisDayExplorer initialDay={{ month: 7, day: 30 }} />
        </OnThisDaySessionProvider>,
      ),
    );
    await act(async () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("day=07-30");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("category=births");
    expect(fetchMock.mock.calls[0]?.[0]).toContain("order=oldest");
    expect(container.querySelector("h1")?.textContent).toBe(
      "On This Day: July 30",
    );

    // Open calendar picker and select July 31.
    const pickerBtn = container.querySelector<HTMLButtonElement>(
      ".on-this-day-nav-picker",
    )!;
    act(() => pickerBtn.click());
    const july31 = container.querySelector<HTMLButtonElement>(
      'button[aria-label="July 31"]',
    )!;
    act(() => july31.click());

    expect(pushMock).toHaveBeenCalledWith(
      "/on-this-day/july-31?category=births&order=oldest",
      { scroll: false },
    );

    // Navigate to July 31 within the same mounted session provider.
    pathnameRef.current = "/on-this-day/july-31";
    await act(async () =>
      root.render(
        <OnThisDaySessionProvider>
          <OnThisDayExplorer initialDay={{ month: 7, day: 31 }} />
        </OnThisDaySessionProvider>,
      ),
    );
    await act(async () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toContain("day=07-31");
    expect(container.querySelector("h1")?.textContent).toBe(
      "On This Day: July 31",
    );
    expect(container.textContent).toContain("births item 1 (07-31)");

    // Return to July 30 -> served from day-keyed cache with zero additional requests.
    pathnameRef.current = "/on-this-day/july-30";
    await act(async () =>
      root.render(
        <OnThisDaySessionProvider>
          <OnThisDayExplorer initialDay={{ month: 7, day: 30 }} />
        </OnThisDaySessionProvider>,
      ),
    );
    await act(async () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector("h1")?.textContent).toBe(
      "On This Day: July 30",
    );
    expect(container.textContent).toContain("births item 1 (07-30)");
  });

  it("replaces stale cached day entries when a newer server initialResponse arrives", async () => {
    const older = {
      ...responseFor("/api/on-this-day?day=07-30&category=selected"),
      changedAt: Date.UTC(2026, 10, 19, 12, 0, 0),
      items: [
        { id: "old-1", year: 1990, text: "Older cached highlight", pages: [] },
      ],
    };
    const newer = {
      ...older,
      changedAt: Date.UTC(2026, 10, 21, 12, 0, 0),
      items: [
        { id: "new-1", year: 2025, text: "Freshly updated highlight", pages: [] },
      ],
    };

    await act(async () =>
      root.render(
        <OnThisDaySessionProvider>
          <OnThisDayExplorer
            initialDay={{ month: 7, day: 30 }}
            initialResponse={older}
          />
        </OnThisDaySessionProvider>,
      ),
    );
    expect(container.textContent).toContain("Older cached highlight");

    await act(async () =>
      root.render(
        <OnThisDaySessionProvider>
          <OnThisDayExplorer
            initialDay={{ month: 7, day: 30 }}
            initialResponse={newer}
          />
        </OnThisDaySessionProvider>,
      ),
    );
    expect(container.textContent).toContain("Freshly updated highlight");
    expect(container.textContent).not.toContain("Older cached highlight");
  });

  it("falls back to an available tab stop when navigating to a highlights-only day while Events is active", async () => {
    searchParamsRef.current = new URLSearchParams("category=events");
    window.history.replaceState(null, "", "/on-this-day/july-30?category=events");
    const replaceStateSpy = vi.spyOn(window.history, "replaceState");

    fetchMock.mockImplementation(async (input) =>
      Response.json({
        ...responseFor(String(input)),
        degraded: true,
        provider: "featured-fallback",
        counts: {
          selected: 1,
          events: 0,
          births: 0,
          deaths: 0,
          holidays: 0,
        },
        availableCategories: {
          selected: true,
          events: false,
          births: false,
          deaths: false,
          holidays: false,
        },
      }),
    );

    await act(async () =>
      root.render(
        <OnThisDayExplorer initialDay={{ month: 7, day: 30 }} />,
      ),
    );
    await act(async () => undefined);

    const highlightsTab = container.querySelector<HTMLButtonElement>(
      "#on-this-day-tab-selected",
    )!;
    const eventsTab = container.querySelector<HTMLButtonElement>(
      "#on-this-day-tab-events",
    )!;
    expect(eventsTab.disabled).toBe(true);
    expect(highlightsTab.getAttribute("aria-selected")).toBe("true");
    expect(highlightsTab.tabIndex).toBe(0);
    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      "",
      "/on-this-day/july-30",
    );
  });
});
