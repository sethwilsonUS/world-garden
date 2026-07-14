// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataContext,
  type ArticleImage,
  type DataContextValue,
} from "@/lib/data-context";
import { useArticleGalleryImages } from "./useArticleGalleryImages";

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
  getArticleImages: DataContextValue["getArticleImages"],
): DataContextValue => ({
  search: async () => [],
  fetchArticle: async () => {
    throw new Error("not used");
  },
  getSectionLinkCounts: async () => [],
  getCitationCounts: async () => [],
  getSectionLinks: async () => [],
  getSectionCitations: async () => [],
  getArticleImages,
});

const Probe = ({ wikiPageId }: { wikiPageId: string }) => {
  const { images, loading } = useArticleGalleryImages(wikiPageId);
  return (
    <output data-loading={String(loading)}>
      {images.map((image) => image.alt).join(",")}
    </output>
  );
};

const image = (alt: string): ArticleImage => ({
  src: `https://upload.wikimedia.org/${alt}.jpg`,
  alt,
  caption: alt,
});

describe("useArticleGalleryImages", () => {
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

  it("clears old images on key change and ignores the late old response", async () => {
    const oldImages = deferred<ArticleImage[]>();
    const newImages = deferred<ArticleImage[]>();
    const getArticleImages = vi.fn(({ wikiPageId }) =>
      wikiPageId === "old" ? oldImages.promise : newImages.promise,
    );
    const value = dataValue(getArticleImages);

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <Probe wikiPageId="old" />
        </DataContext.Provider>,
      );
    });
    await waitForExpectation(() =>
      expect(getArticleImages).toHaveBeenCalledWith({ wikiPageId: "old" }),
    );

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <Probe wikiPageId="new" />
        </DataContext.Provider>,
      );
    });
    const output = container.querySelector("output")!;
    expect(output.dataset.loading).toBe("true");
    expect(output.textContent).toBe("");

    await act(async () => oldImages.resolve([image("Old image")]));
    expect(output.dataset.loading).toBe("true");
    expect(output.textContent).toBe("");

    await act(async () => newImages.resolve([image("New image")]));
    await waitForExpectation(() => {
      expect(output.dataset.loading).toBe("false");
      expect(output.textContent).toBe("New image");
    });
  });

  it("settles a new-key failure to an empty supplemental gallery", async () => {
    const first = deferred<ArticleImage[]>();
    const second = deferred<ArticleImage[]>();
    const getArticleImages = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const value = dataValue(getArticleImages);

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <Probe wikiPageId="first" />
        </DataContext.Provider>,
      );
    });
    await act(async () => first.resolve([image("First image")]));
    await waitForExpectation(() =>
      expect(container.textContent).toBe("First image"),
    );

    await act(async () => {
      root.render(
        <DataContext.Provider value={value}>
          <Probe wikiPageId="second" />
        </DataContext.Provider>,
      );
    });
    expect(container.textContent).toBe("");
    await act(async () => second.reject(new Error("supplemental failure")));
    await waitForExpectation(() => {
      expect(container.querySelector("output")?.dataset.loading).toBe("false");
      expect(container.textContent).toBe("");
    });
  });
});
