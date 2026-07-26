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
  type WikipediaRevisionIdentity,
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

const dataValue = (overrides: Partial<DataContextValue>): DataContextValue => ({
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

const identity = (
  wikiPageId: string,
  revisionId = `revision-${wikiPageId}`,
): WikipediaRevisionIdentity => ({
  wikiPageId,
  revisionId,
  title: `Article ${wikiPageId}`,
  language: "en",
});

const CountsProbe = ({
  wikiPageId,
  revisionId,
}: {
  wikiPageId: string;
  revisionId?: string;
}) => {
  const { linkCounts, citationCounts } = useArticleSectionCounts(
    identity(wikiPageId, revisionId),
  );
  return (
    <output
      data-links={JSON.stringify(linkCounts)}
      data-citations={JSON.stringify(citationCounts)}
    />
  );
};

const DetailsProbe = ({
  wikiPageId,
  revisionId,
  sectionTitle,
  sectionIndex,
  hasLinks = true,
  hasCitations = true,
}: {
  wikiPageId: string;
  revisionId?: string;
  sectionTitle: string | null;
  sectionIndex?: string;
  hasLinks?: boolean;
  hasCitations?: boolean;
}) => {
  const state = useArticleSectionDetails({
    identity: identity(wikiPageId, revisionId),
    sectionTitle,
    sectionIndex,
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

  it("keeps duplicate heading counts distinct by MediaWiki section index", async () => {
    const value = dataValue({
      getSectionLinkCounts: async () => [
        { index: "3", title: "History", count: 1 },
        { index: "8", title: "History", count: 2 },
      ],
      getCitationCounts: async () => [
        { index: "3", title: "History", count: 4 },
        { index: "8", title: "History", count: 5 },
      ],
    });

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <CountsProbe wikiPageId="1" />
        </DataContext.Provider>,
      );
    });

    await waitForExpectation(() => {
      const output = container.querySelector("output")!;
      expect(output.dataset.links).toBe('{"3":1,"8":2}');
      expect(output.dataset.citations).toBe('{"3":4,"8":5}');
    });
  });

  it("passes MediaWiki section identity to duplicate-heading citation lookup", async () => {
    const getSectionCitations = vi.fn(async () => [
      { id: "second", index: 2, text: "Second History source" },
    ]);
    const value = dataValue({ getSectionCitations });

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <DetailsProbe
            wikiPageId="1"
            sectionTitle="History"
            sectionIndex="8"
            hasLinks={false}
          />
        </DataContext.Provider>,
      );
    });

    await waitForExpectation(() =>
      expect(getSectionCitations).toHaveBeenCalledWith({
        identity: identity("1"),
        sectionTitle: "History",
        sectionIndex: "8",
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("resets counts for a new article and ignores late old responses", async () => {
    const oldLinks = deferred<LinkCount[]>();
    const oldCitations = deferred<LinkCount[]>();
    const newLinks = deferred<LinkCount[]>();
    const newCitations = deferred<LinkCount[]>();
    const value = dataValue({
      getSectionLinkCounts: vi.fn(({ identity: requestIdentity }) =>
        requestIdentity.wikiPageId === "old"
          ? oldLinks.promise
          : newLinks.promise,
      ),
      getCitationCounts: vi.fn(({ identity: requestIdentity }) =>
        requestIdentity.wikiPageId === "old"
          ? oldCitations.promise
          : newCitations.promise,
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
        identity: identity("old"),
        signal: expect.any(AbortSignal),
      }),
    );
    const oldLinkSignal = vi.mocked(value.getSectionLinkCounts).mock.calls[0][0]
      .signal!;
    const oldCitationSignal = vi.mocked(value.getCitationCounts).mock
      .calls[0][0].signal!;
    expect(oldLinkSignal).toBe(oldCitationSignal);
    expect(oldLinkSignal.aborted).toBe(false);

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <CountsProbe wikiPageId="new" />
        </DataContext.Provider>,
      );
    });
    expect(oldLinkSignal.aborted).toBe(true);
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

  it("resets counts when the revision changes on the same page", async () => {
    const oldLinks = deferred<LinkCount[]>();
    const currentLinks = deferred<LinkCount[]>();
    const getSectionLinkCounts = vi.fn(({ identity: requestIdentity }) =>
      requestIdentity.revisionId === "100"
        ? oldLinks.promise
        : currentLinks.promise,
    );
    const value = dataValue({
      getSectionLinkCounts,
      getCitationCounts: async () => [],
    });

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <CountsProbe wikiPageId="same" revisionId="100" />
        </DataContext.Provider>,
      );
    });
    const oldSignal = vi.mocked(getSectionLinkCounts).mock.calls[0][0].signal!;

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <CountsProbe wikiPageId="same" revisionId="101" />
        </DataContext.Provider>,
      );
    });

    expect(oldSignal.aborted).toBe(true);
    expect(getSectionLinkCounts).toHaveBeenLastCalledWith({
      identity: identity("same", "101"),
      signal: expect.any(AbortSignal),
    });
    expect(container.querySelector("output")?.dataset.links).toBe("null");

    await act(async () => {
      oldLinks.resolve([{ title: "Stale", count: 1 }]);
      currentLinks.resolve([{ title: "Current", count: 2 }]);
    });
    await waitForExpectation(() =>
      expect(container.querySelector("output")?.dataset.links).toBe(
        '{"Current":2}',
      ),
    );
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
    const oldLinkSignal = vi.mocked(value.getSectionLinks).mock.calls[0][0]
      .signal!;
    const oldCitationSignal = vi.mocked(value.getSectionCitations).mock
      .calls[0][0].signal!;
    expect(oldLinkSignal).toBe(oldCitationSignal);
    expect(oldLinkSignal.aborted).toBe(false);

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <DetailsProbe wikiPageId="2" sectionTitle="New" />
        </DataContext.Provider>,
      );
    });
    expect(oldLinkSignal.aborted).toBe(true);
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
      newCitations.resolve([{ id: "new", index: 1, text: "New citation" }]);
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
