// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/convex/_generated/api";
import { useArticleGalleryImages } from "@/hooks/useArticleGalleryImages";
import { useArticleSectionCounts } from "@/hooks/useArticleSectionMetadata";
import { useData, type WikipediaRevisionIdentity } from "./data-context";
import type { WikipediaParsedPageData } from "./wikipedia-contracts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { actionSpies, resetActionSpies } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  const spies = new Map<string, ReturnType<typeof vi.fn>>();
  return {
    actionSpies: spies,
    resetActionSpies: () => spies.clear(),
  };
});

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isSignedIn: false }),
}));

vi.mock("convex/react", () => ({
  ConvexReactClient: class MockConvexReactClient {
    url: string;
    constructor(url: string) {
      this.url = url;
    }
  },
  useAction: (actionRef: FunctionReference<"action">) => {
    const key = getFunctionName(actionRef);
    let spy = actionSpies.get(key);
    if (!spy) {
      spy = vi.fn();
      actionSpies.set(key, spy);
    }
    return spy;
  },
}));

vi.mock("convex/react-clerk", () => ({
  ConvexProviderWithClerk: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/lib/tts-audience", () => ({
  AuthAwareTtsProfileProvider: ({ children }: { children: ReactNode }) =>
    children,
}));

vi.mock("@/hooks/useBookmarks", () => ({
  HybridBookmarkProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/hooks/usePersonalPlaylist", () => ({
  PersonalPlaylistProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/ArticleAudioExportProvider", () => ({
  ArticleAudioExportProvider: ({ children }: { children: ReactNode }) =>
    children,
}));

vi.mock("@/components/BadgeProgressToastProvider", () => ({
  BadgeProgressToastProvider: ({ children }: { children: ReactNode }) =>
    children,
}));

import { ConvexDataProvider } from "./convex-data-provider";

const sampleIdentity: WikipediaRevisionIdentity = {
  wikiPageId: "974",
  revisionId: "12345",
  title: "Ada Lovelace",
  language: "en",
};

const sampleMetadata: WikipediaParsedPageData = {
  linkCounts: [
    { index: "__summary__", title: "__summary__", count: 2 },
    { index: "1", title: "Early life", count: 4 },
  ],
  citations: [{ id: "cite_note-1", index: 1, text: "Biographical note." }],
  sectionCitations: [
    {
      index: "__summary__",
      title: "__summary__",
      count: 0,
      citationIds: [],
    },
    {
      index: "1",
      title: "Early life",
      count: 1,
      citationIds: ["cite_note-1"],
    },
  ],
  sectionIndexMap: [{ title: "Early life", index: "1" }],
  images: [
    {
      src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada.jpg/330px-Ada.jpg",
      lightboxSrc:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada.jpg/1600px-Ada.jpg",
      lightboxWidth: 1600,
      lightboxHeight: 2000,
      alt: "Portrait of Ada Lovelace",
      caption: "Ada Lovelace",
    },
  ],
};

describe("ConvexDataProvider coalesced metadata", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://example.convex.cloud");
    resetActionSpies();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fires one coalesced getArticleMetadata Convex action when mounting counts and gallery hooks", async () => {
    let finishMetadata: ((data: WikipediaParsedPageData) => void) | undefined;
    const metadataSpy = vi.fn(
      () =>
        new Promise<WikipediaParsedPageData>((resolve) => {
          finishMetadata = resolve;
        }),
    );
    actionSpies.set(getFunctionName(api.articles.getArticleMetadata), metadataSpy);

    let latestCounts: ReturnType<typeof useArticleSectionCounts> | undefined;
    let latestGallery: ReturnType<typeof useArticleGalleryImages> | undefined;
    let dataApi: ReturnType<typeof useData> | undefined;

    const ArticleMountProbe = () => {
      dataApi = useData();
      latestCounts = useArticleSectionCounts(sampleIdentity);
      latestGallery = useArticleGalleryImages(sampleIdentity);
      return null;
    };

    await act(async () => {
      root.render(
        <ConvexDataProvider>
          <ArticleMountProbe />
        </ConvexDataProvider>,
      );
    });

    expect(metadataSpy).toHaveBeenCalledTimes(1);
    expect(metadataSpy).toHaveBeenCalledWith(sampleIdentity);
    expect(
      actionSpies.get(getFunctionName(api.articles.getSectionLinkCounts)),
    ).toBeUndefined();
    expect(
      actionSpies.get(getFunctionName(api.articles.getCitationCounts)),
    ).toBeUndefined();
    expect(
      actionSpies.get(getFunctionName(api.articles.getArticleImages)),
    ).toBeUndefined();
    expect(
      actionSpies.get(getFunctionName(api.articles.getSectionCitations)),
    ).toBeUndefined();

    await act(async () => {
      finishMetadata?.(sampleMetadata);
      await Promise.resolve();
    });

    await vi.waitFor(async () => {
      await act(async () => {
        await Promise.resolve();
      });
      expect(latestCounts?.linkCounts).toEqual({
        __summary__: 2,
        "1": 4,
      });
      expect(latestCounts?.citationCounts).toEqual({
        __summary__: 0,
        "1": 1,
      });
      expect(latestGallery?.loading).toBe(false);
      expect(latestGallery?.images).toEqual(sampleMetadata.images);
    });

    // Opening section citations reuses the client cache with zero extra Convex action calls.
    await expect(
      dataApi?.getSectionCitations({
        identity: sampleIdentity,
        sectionTitle: "Early life",
        sectionIndex: "1",
      }),
    ).resolves.toEqual(sampleMetadata.citations);
    expect(metadataSpy).toHaveBeenCalledTimes(1);
  });
});
