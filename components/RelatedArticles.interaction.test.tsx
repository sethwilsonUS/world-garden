// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataContext,
  type DataContextValue,
  type WikipediaRevisionIdentity,
} from "@/lib/data-context";
import { RelatedArticles } from "./RelatedArticles";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("@/components/PlaylistActionButton", () => ({
  PlaylistActionButton: ({ slug, title }: { slug: string; title: string }) => (
    <button
      type="button"
      data-playlist-slug={slug}
      aria-label={`Add ${title} to playlist`}
    >
      Add to playlist
    </button>
  ),
}));

const sampleIdentity: WikipediaRevisionIdentity = {
  wikiPageId: "974",
  revisionId: "4200",
  title: "Ada Lovelace",
  language: "en",
};

const createDataValue = (
  overrides: Partial<DataContextValue> = {},
): DataContextValue => ({
  search: async () => [],
  fetchArticle: async () => {
    throw new Error("not used");
  },
  getSectionLinkCounts: async () => [],
  getCitationCounts: async () => [],
  getSectionLinks: vi.fn(async () => []),
  getSectionCitations: async () => [],
  getArticleImages: async () => [],
  getRelatedArticles: vi.fn(async () => []),
  ...overrides,
});

describe("RelatedArticles (Listen next)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders morelike recommendations in CirrusSearch relevance order with accessible links, descriptions, and playlist actions", async () => {
    const getSectionLinks = vi.fn(async () => []);
    const getRelatedArticles = vi.fn(async () => [
      {
        wikiPageId: "70923477",
        title: "Note G",
        description: "Computer algorithm",
      },
      {
        wikiPageId: "974",
        title: "Ada Lovelace",
        description: "Self entry filtered defensively",
      },
      {
        wikiPageId: "1271",
        title: "Analytical engine",
        description: "19th century proposed mechanical computer",
      },
      {
        wikiPageId: "5698",
        title: "Charles Babbage",
        description: "English mathematician and inventor",
      },
    ]);

    const dataValue = createDataValue({
      getSectionLinks,
      getRelatedArticles,
    });

    await act(async () => {
      root.render(
        <DataContext.Provider value={dataValue}>
          <RelatedArticles identity={sampleIdentity} />
        </DataContext.Provider>,
      );
    });

    await vi.waitFor(() => {
      expect(container.querySelector("h2#related-heading")?.textContent).toContain(
        "Listen next",
      );
    });

    expect(getRelatedArticles).toHaveBeenCalledTimes(1);
    expect(getSectionLinks).not.toHaveBeenCalled();

    const section = container.querySelector("section[aria-labelledby='related-heading']");
    expect(section).not.toBeNull();

    const items = [...container.querySelectorAll("ul[role='list'] > li")];
    expect(items).toHaveLength(3);

    // Relevance order preserved (Note G -> Analytical engine -> Charles Babbage, NOT alphabetical)
    const links = items.map((item) => item.querySelector("a"));
    expect(links.map((link) => link?.getAttribute("href"))).toEqual([
      "/article/Note_G",
      "/article/Analytical_engine",
      "/article/Charles_Babbage",
    ]);
    expect(items[0]?.textContent).toContain("Note G");
    expect(items[0]?.textContent).toContain("Computer algorithm");
    expect(
      items[0]?.querySelector("button[aria-label='Add Note G to playlist']"),
    ).not.toBeNull();
  });

  it("hides the Listen next section cleanly when related-article fetching fails", async () => {
    const getRelatedArticles = vi.fn(async () => {
      throw new Error("Wikimedia 503");
    });
    const dataValue = createDataValue({ getRelatedArticles });

    await act(async () => {
      root.render(
        <DataContext.Provider value={dataValue}>
          <RelatedArticles identity={sampleIdentity} />
        </DataContext.Provider>,
      );
    });

    await vi.waitFor(() => {
      expect(getRelatedArticles).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector("section")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
