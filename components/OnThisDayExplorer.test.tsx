// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnThisDayExplorer } from "./OnThisDayExplorer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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

const responseFor = (url: string) => {
  const parsed = new URL(url, "https://curiogarden.org");
  const category = parsed.searchParams.get("category") ?? "selected";
  const offset = Number(parsed.searchParams.get("offset") ?? 0);
  const order = parsed.searchParams.get("order") ?? "newest";
  const total = counts[category as keyof typeof counts];
  const length = Math.min(25, total - offset);
  const items = Array.from({ length }, (_, index) => {
    const sequence = offset + index;
    return {
      id: `${category}-${order}-${sequence}`,
      year: order === "newest" ? 2000 - sequence : 1900 + sequence,
      text: `${category} item ${sequence + 1}`,
      pages: [],
    };
  });
  return {
    requestedDate: "2026-07-30",
    snapshotDate: "2026-07-30",
    snapshotIsStale: false,
    provider: "wikifeeds-v1",
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

describe("OnThisDayExplorer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => responseFor(String(input)),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("uses manual keyboard tabs and progressively reveals a cached category", async () => {
    await act(async () => root.render(<OnThisDayExplorer />));
    await act(async () => undefined);

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    expect(tabs.map((tab) => tab.textContent?.replace(/, \d+ items$/u, ""))).toEqual([
      "Highlights1",
      "Events30",
      "Births2",
      "Deaths3",
      "Holidays4",
    ]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(container.textContent).toContain("selected item 1");
    const statuses = container.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toBe(
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
    expect(document.activeElement).toBe(tabs[1]);
    expect(container.querySelectorAll("ol.timeline-list > li")).toHaveLength(25);

    const showMore = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Show 5 more"),
    ) as HTMLButtonElement;
    showMore.focus();
    await act(async () => showMore.click());
    await act(async () => undefined);
    expect(container.querySelectorAll("ol.timeline-list > li")).toHaveLength(30);
    expect(document.activeElement).toBe(showMore);

    tabs[0].click();
    tabs[1].click();
    await act(async () => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps focus on the sort control while requesting the opposite end", async () => {
    await act(async () => root.render(<OnThisDayExplorer />));
    await act(async () => undefined);
    const eventsTab = container.querySelector<HTMLButtonElement>(
      "#on-this-day-tab-events",
    )!;
    await act(async () => eventsTab.click());
    await act(async () => undefined);

    const sortButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Oldest first",
    ) as HTMLButtonElement;
    sortButton.focus();
    await act(async () => sortButton.click());
    await act(async () => undefined);

    expect(document.activeElement).toBe(sortButton);
    expect(sortButton.textContent).toBe("Newest first");
    expect(fetchMock.mock.calls.at(-1)?.[0]).toContain("order=oldest");
    expect(container.querySelector("ol.timeline-list time")?.textContent).toBe(
      "1900",
    );
  });

  it("preserves loaded items and offers a retry after a pagination failure", async () => {
    await act(async () => root.render(<OnThisDayExplorer />));
    await act(async () => undefined);
    const eventsTab = container.querySelector<HTMLButtonElement>(
      "#on-this-day-tab-events",
    )!;
    await act(async () => eventsTab.click());
    await act(async () => undefined);

    fetchMock.mockImplementationOnce(async () => ({
      ok: false,
      json: async () => ({ error: "Wikimedia took the scenic route." }),
    }));
    const showMore = container.querySelector<HTMLButtonElement>(
      ".on-this-day-show-more",
    )!;
    await act(async () => showMore.click());
    await act(async () => undefined);

    expect(container.querySelectorAll("ol.timeline-list > li")).toHaveLength(25);
    const retry = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Try loading these events again",
    ) as HTMLButtonElement;
    expect(retry).toBeTruthy();

    await act(async () => retry.click());
    await act(async () => undefined);
    expect(container.querySelectorAll("ol.timeline-list > li")).toHaveLength(30);
  });

  it("aborts an obsolete category request when returning to cached results", async () => {
    await act(async () => root.render(<OnThisDayExplorer />));
    await act(async () => undefined);
    let aborted = false;
    fetchMock.mockImplementationOnce(
      async (_input: string | URL | Request, init?: RequestInit) =>
        await new Promise((_, reject) => {
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

  it("exposes selected-only fallback categories as unavailable native tabs", async () => {
    fetchMock.mockImplementationOnce(async (input: string | URL | Request) => ({
      ok: true,
      json: async () => ({
        ...responseFor(String(input)),
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
    }));
    await act(async () => root.render(<OnThisDayExplorer />));
    await act(async () => undefined);

    const tabs = Array.from(
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    expect(tabs[0].disabled).toBe(false);
    expect(tabs.slice(1).every((tab) => tab.disabled)).toBe(true);
    expect(tabs[1].getAttribute("aria-label")).toBe("Events, 0 items");

    tabs[0].focus();
    await act(async () =>
      tabs[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(tabs[0]);
  });
});
