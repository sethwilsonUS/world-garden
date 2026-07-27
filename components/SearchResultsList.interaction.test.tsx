// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataContext,
  type DataContextValue,
  type SearchResult,
} from "@/lib/data-context";
import { SearchResultsList } from "./SearchResultsList";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const analytics = vi.hoisted(() => ({
  searchResultsLoaded: vi.fn(),
  searchResultClicked: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({ analytics }));

vi.mock("@/components/PlaylistActionButton", () => ({
  PlaylistActionButton: ({ title }: { title: string }) => (
    <button type="button">Add {title} to Playlist</button>
  ),
}));

const result = (
  wikiPageId: string,
  title: string,
  description = `${title} description`,
): SearchResult => ({
  wikiPageId,
  title,
  description,
  url: `https://en.wikipedia.org/wiki/${title.replaceAll(" ", "_")}`,
});

const deferred = <Value,>() => {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const dataValue = (
  search: DataContextValue["search"],
): DataContextValue => ({
  search,
  fetchArticle: async () => {
    throw new Error("not used");
  },
  getSectionLinkCounts: async () => [],
  getCitationCounts: async () => [],
  getSectionLinks: async () => [],
  getSectionCitations: async () => [],
  getArticleImages: async () => [],
});

const waitForExpectation = async (assertion: () => void) => {
  await vi.waitFor(
    async () => {
      await act(async () => {
        await Promise.resolve();
      });
      assertion();
    },
    { interval: 1, timeout: 1_000 },
  );
};

describe("SearchResultsList interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("announces results without taking focus from a reader refining the search", async () => {
    const request = deferred<SearchResult[]>();
    const search = vi.fn(() => request.promise);

    await act(async () => {
      root.render(
        <DataContext.Provider value={dataValue(search)}>
          <label>
            Refine your search
            <input type="search" />
          </label>
          <SearchResultsList term="Moria" />
        </DataContext.Provider>,
      );
      await Promise.resolve();
    });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.getAttribute("aria-live")).toBe("polite");
    expect(status?.getAttribute("aria-atomic")).toBe("true");
    expect(status?.textContent).toContain("Searching Wikipedia for Moria.");

    const refineInput = container.querySelector("input");
    refineInput?.focus();
    expect(document.activeElement).toBe(refineInput);

    await act(async () => {
      request.resolve([
        result("1", "Moria"),
        result("2", "Mines of Moria"),
      ]);
      await request.promise;
    });
    await waitForExpectation(() => {
      expect(container.querySelectorAll("ol li")).toHaveLength(2);
    });

    expect(container.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toContain(
      "2 search results found for Moria.",
    );
    expect(document.activeElement).toBe(refineInput);
    expect(container.textContent).not.toContain("number key");
    expect(container.textContent).not.toContain("arrow keys");
  });

  it("leaves digit and arrow keys to the browser and assistive technology", async () => {
    const search = vi.fn(async () => [
      result("1", "Moria"),
      result("2", "Mines of Moria"),
    ]);

    await act(async () => {
      root.render(
        <DataContext.Provider value={dataValue(search)}>
          <SearchResultsList term="Moria" />
        </DataContext.Provider>,
      );
      await Promise.resolve();
    });
    await waitForExpectation(() => {
      expect(container.querySelectorAll("ol li")).toHaveLength(2);
    });

    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>("ol li a"),
    );
    const firstLink = links[0];
    expect(firstLink).toBeInstanceOf(HTMLAnchorElement);
    firstLink?.focus();
    const click = vi.fn();
    links.forEach((link) => link.addEventListener("click", click));

    for (const event of [
      new KeyboardEvent("keydown", { key: "1", bubbles: true }),
      new KeyboardEvent("keydown", {
        key: "2",
        ctrlKey: true,
        bubbles: true,
      }),
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    ]) {
      firstLink?.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(click).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(firstLink);

    const playlistButton = Array.from(
      container.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Mines of Moria"));
    expect(playlistButton).toBeInstanceOf(HTMLButtonElement);
    playlistButton?.focus();
    const digitFromButton = new KeyboardEvent("keydown", {
      key: "2",
      bubbles: true,
    });
    playlistButton?.dispatchEvent(digitFromButton);

    expect(digitFromButton.defaultPrevented).toBe(false);
    expect(click).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(playlistButton);
  });

  it("uses the same live region for an empty result and lets alerts own failures", async () => {
    const emptySearch = vi.fn(async () => []);

    await act(async () => {
      root.render(
        <DataContext.Provider value={dataValue(emptySearch)}>
          <SearchResultsList term="Entwives" />
        </DataContext.Provider>,
      );
      await Promise.resolve();
    });

    const status = container.querySelector('[role="status"]');
    await waitForExpectation(() => {
      expect(container.textContent).toContain("No seeds found");
    });
    expect(container.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toContain(
      "No search results found for Entwives.",
    );

    const failedSearch = vi.fn(async () => {
      throw new Error("The garden gate is stuck.");
    });
    await act(async () => {
      root.render(
        <DataContext.Provider value={dataValue(failedSearch)}>
          <SearchResultsList key="failure" term="Silmarils" />
        </DataContext.Provider>,
      );
      await Promise.resolve();
    });
    await waitForExpectation(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        "The garden gate is stuck.",
      );
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("discards a stale request when the search term changes", async () => {
    const firstRequest = deferred<SearchResult[]>();
    const secondRequest = deferred<SearchResult[]>();
    const search = vi.fn(({ term }: { term: string }) =>
      term === "Moria" ? firstRequest.promise : secondRequest.promise,
    );
    const value = dataValue(search);

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <SearchResultsList term="Moria" />
        </DataContext.Provider>,
      );
      await Promise.resolve();
    });
    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <SearchResultsList term="The Shire" />
        </DataContext.Provider>,
      );
      await Promise.resolve();
    });

    await act(async () => {
      firstRequest.resolve([result("1", "Moria")]);
      await firstRequest.promise;
    });
    expect(container.textContent).not.toContain("Moria description");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "Searching Wikipedia for The Shire.",
    );

    await act(async () => {
      secondRequest.resolve([result("2", "The Shire")]);
      await secondRequest.promise;
    });
    await waitForExpectation(() => {
      expect(container.textContent).toContain("The Shire description");
    });
    expect(container.textContent).not.toContain("Moria description");
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "1 search result found for The Shire.",
    );
  });
});
