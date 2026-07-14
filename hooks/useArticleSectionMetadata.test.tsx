// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataContext,
  type Citation,
  type DataContextValue,
  type LinkedArticle,
  type LinkCount,
} from "@/lib/data-context";
import {
  useArticleSectionCounts,
  useArticleSectionDetails,
} from "./useArticleSectionMetadata";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
};

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

const dataValue = (
  overrides: Partial<DataContextValue>,
): DataContextValue => ({
  search: async () => [],
  fetchArticle: async () => {
    throw new Error("not used");
  },
  getSectionLinkCounts: async () => [],
  getCitationCounts: async () => [],
  getSectionLinks: async () => [],
  getSectionCitations: async () => [],
  getArticleImages: async () => [],
  ...overrides,
});

const CountsProbe = ({ wikiPageId }: { wikiPageId: string }) => {
  const { linkCounts, citationCounts } =
    useArticleSectionCounts(wikiPageId);
  return (
    <output
      data-links={JSON.stringify(linkCounts)}
      data-citations={JSON.stringify(citationCounts)}
    />
  );
};

const DetailsProbe = ({
  wikiPageId,
  sectionTitle,
  hasLinks = true,
  hasCitations = true,
}: {
  wikiPageId: string;
  sectionTitle: string | null;
  hasLinks?: boolean;
  hasCitations?: boolean;
}) => {
  const state = useArticleSectionDetails({
    wikiPageId,
    sectionTitle,
    hasLinks,
    hasCitations,
  });
  return (
    <output
      data-links={JSON.stringify(state.links)}
      data-citations={JSON.stringify(state.citations)}
      data-links-loading={String(state.linksLoading)}
      data-citations-loading={String(state.citationsLoading)}
    />
  );
};

describe("article section metadata hooks", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("resets counts for a new article and ignores late old responses", async () => {
    const oldLinks = deferred<LinkCount[]>();
    const oldCitations = deferred<LinkCount[]>();
    const newLinks = deferred<LinkCount[]>();
    const newCitations = deferred<LinkCount[]>();
    const value = dataValue({
      getSectionLinkCounts: vi.fn(({ wikiPageId }) =>
        wikiPageId === "old" ? oldLinks.promise : newLinks.promise,
      ),
      getCitationCounts: vi.fn(({ wikiPageId }) =>
        wikiPageId === "old" ? oldCitations.promise : newCitations.promise,
      ),
    });

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <CountsProbe wikiPageId="old" />
        </DataContext.Provider>,
      );
    });
    await waitForExpectation(() =>
      expect(value.getSectionLinkCounts).toHaveBeenCalledWith({
        wikiPageId: "old",
      }),
    );

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <CountsProbe wikiPageId="new" />
        </DataContext.Provider>,
      );
    });
    const output = container.querySelector("output")!;
    expect(output.dataset.links).toBe("null");
    expect(output.dataset.citations).toBe("null");

    await act(async () => {
      oldLinks.resolve([{ title: "Old section", count: 9 }]);
      oldCitations.resolve([{ title: "Old section", count: 8 }]);
    });
    expect(output.dataset.links).toBe("null");
    expect(output.dataset.citations).toBe("null");

    await act(async () => {
      newLinks.resolve([{ title: "New section", count: 2 }]);
      newCitations.resolve([{ title: "New section", count: 3 }]);
    });
    await waitForExpectation(() => {
      expect(output.dataset.links).toBe('{"New section":2}');
      expect(output.dataset.citations).toBe('{"New section":3}');
    });
  });

  it("resets details by compound key and keeps partial failures graceful", async () => {
    const oldLinks = deferred<LinkedArticle[]>();
    const oldCitations = deferred<Citation[]>();
    const newLinks = deferred<LinkedArticle[]>();
    const newCitations = deferred<Citation[]>();
    const value = dataValue({
      getSectionLinks: vi.fn(({ sectionTitle }) =>
        sectionTitle === "Old" ? oldLinks.promise : newLinks.promise,
      ),
      getSectionCitations: vi.fn(({ sectionTitle }) =>
        sectionTitle === "Old" ? oldCitations.promise : newCitations.promise,
      ),
    });

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <DetailsProbe wikiPageId="1" sectionTitle="Old" />
        </DataContext.Provider>,
      );
    });
    await waitForExpectation(() =>
      expect(value.getSectionLinks).toHaveBeenCalledTimes(1),
    );

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <DetailsProbe wikiPageId="2" sectionTitle="New" />
        </DataContext.Provider>,
      );
    });
    const output = container.querySelector("output")!;
    expect(output.dataset.links).toBe("null");
    expect(output.dataset.citations).toBe("null");
    expect(output.dataset.linksLoading).toBe("true");
    expect(output.dataset.citationsLoading).toBe("true");

    await act(async () => {
      oldLinks.resolve([{ wikiPageId: "old", title: "Old article" }]);
      oldCitations.resolve([{ id: "old", index: 1, text: "Old citation" }]);
    });
    expect(output.dataset.links).toBe("null");
    expect(output.dataset.citations).toBe("null");

    await act(async () => {
      newLinks.reject(new Error("supplemental links failed"));
      newCitations.resolve([
        { id: "new", index: 1, text: "New citation" },
      ]);
    });
    await waitForExpectation(() => {
      expect(output.dataset.links).toBe("[]");
      expect(output.dataset.citations).toContain("New citation");
      expect(output.dataset.linksLoading).toBe("false");
      expect(output.dataset.citationsLoading).toBe("false");
    });
  });

  it("does not publish late details after unmount", async () => {
    const links = deferred<LinkedArticle[]>();
    const citations = deferred<Citation[]>();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const value = dataValue({
      getSectionLinks: () => links.promise,
      getSectionCitations: () => citations.promise,
    });

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <DetailsProbe wikiPageId="1" sectionTitle="History" />
        </DataContext.Provider>,
      );
    });
    act(() => root.unmount());
    mounted = false;
    await act(async () => {
      links.resolve([{ wikiPageId: "late", title: "Late article" }]);
      citations.resolve([{ id: "late", index: 1, text: "Late citation" }]);
    });

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
