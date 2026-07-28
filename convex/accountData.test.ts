import { describe, expect, it, vi } from "vitest";
import {
  getViewerAccountDataOverviewForCtx,
  getViewerAccountDataPageForCtx,
} from "./accountData";

type FeedDoc = {
  _id: string;
  viewerTokenIdentifier: string;
  feedToken: string;
  revokedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type QuotaDoc = {
  _id: string;
  key: string;
  count: number;
  windowStart: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};

const matchesFilters = (
  doc: Record<string, unknown>,
  filters: Array<[string, unknown]>,
): boolean => filters.every(([field, value]) => doc[field] === value);

const createOverviewCtx = (seed?: {
  viewerTokenIdentifier?: string | null;
  feeds?: FeedDoc[];
  quotas?: QuotaDoc[];
}) => {
  const feeds = seed?.feeds ?? [];
  const quotas = seed?.quotas ?? [];

  return {
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(
        seed?.viewerTokenIdentifier === null
          ? null
          : {
              tokenIdentifier:
                seed?.viewerTokenIdentifier ?? "https://clerk.example|viewer-1",
            },
      ),
    },
    db: {
      query: (
        tableName:
          | "personalPodcastFeeds"
          | "routeQuotas"
          | "accountDeletionRequests",
      ) => ({
        withIndex: (
          _indexName: string,
          apply: (builder: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          const filters: Array<[string, unknown]> = [];
          const builder = {
            eq: (field: string, value: unknown) => {
              filters.push([field, value]);
              return builder;
            },
          };
          apply(builder);
          const docs =
            tableName === "personalPodcastFeeds"
              ? feeds
              : tableName === "routeQuotas"
                ? quotas
                : [];
          const filtered = docs.filter((doc) =>
            matchesFilters(doc as unknown as Record<string, unknown>, filters),
          );
          return {
            first: async () => filtered[0] ?? null,
          };
        },
      }),
    },
  };
};

type PageTestDoc = Record<string, unknown> & {
  _id: string;
  viewerTokenIdentifier?: string;
  ownerTokenIdentifier?: string;
};

const createPageCtx = (seed: {
  tableName: string;
  docs: PageTestDoc[];
  viewerTokenIdentifier?: string | null;
}) => {
  let lastPaginationOpts: { numItems: number; cursor: string | null } | null =
    null;

  return {
    ctx: {
      auth: {
        getUserIdentity: vi.fn().mockResolvedValue(
          seed.viewerTokenIdentifier === null
            ? null
            : {
                tokenIdentifier:
                  seed.viewerTokenIdentifier ??
                  "https://clerk.example|viewer-1",
              },
        ),
      },
      db: {
        query: (tableName: string) => {
          if (tableName === "accountDeletionRequests") {
            return {
              withIndex: (
                _indexName: string,
                apply: (builder: {
                  eq: (field: string, value: unknown) => unknown;
                }) => unknown,
              ) => {
                const builder = {
                  eq: (field: string, value: unknown) => {
                    void field;
                    void value;
                    return builder;
                  },
                };
                apply(builder);
                return {
                  first: async () => null,
                };
              },
            };
          }
          if (tableName !== seed.tableName) {
            throw new Error(`Unexpected table ${tableName}`);
          }
          return {
            withIndex: (
              _indexName: string,
              apply: (builder: {
                eq: (field: string, value: unknown) => unknown;
              }) => unknown,
            ) => {
              const filters: Array<[string, unknown]> = [];
              const builder = {
                eq: (field: string, value: unknown) => {
                  filters.push([field, value]);
                  return builder;
                },
              };
              apply(builder);
              const filtered = seed.docs.filter((doc) =>
                matchesFilters(doc, filters),
              );
              return {
                paginate: async (paginationOpts: {
                  numItems: number;
                  cursor: string | null;
                }) => {
                  lastPaginationOpts = paginationOpts;
                  const start = paginationOpts.cursor
                    ? Number.parseInt(paginationOpts.cursor, 10)
                    : 0;
                  const end = Math.min(
                    filtered.length,
                    start + paginationOpts.numItems,
                  );
                  return {
                    page: filtered.slice(start, end),
                    continueCursor: String(end),
                    isDone: end >= filtered.length,
                  };
                },
              };
            },
          };
        },
      },
    },
    getLastPaginationOpts: () => lastPaginationOpts,
  };
};

describe("getViewerAccountDataOverviewForCtx", () => {
  it("returns the signed-in viewer's active feed and semantic quota windows", async () => {
    const viewerTokenIdentifier = "https://clerk.example|viewer-1";
    const ctx = createOverviewCtx({
      viewerTokenIdentifier,
      feeds: [
        {
          _id: "feed-other",
          viewerTokenIdentifier: "https://clerk.example|viewer-2",
          feedToken: "other-secret-token",
          createdAt: 1,
          updatedAt: 2,
        },
        {
          _id: "feed-viewer",
          viewerTokenIdentifier,
          feedToken: "viewer-secret-token",
          createdAt: 10,
          updatedAt: 20,
        },
      ],
      quotas: [
        {
          _id: "quota-playlist",
          key: `personal-playlist:openai:daily:${viewerTokenIdentifier}`,
          count: 3,
          windowStart: 100,
          expiresAt: 200,
          createdAt: 90,
          updatedAt: 110,
        },
        {
          _id: "quota-export",
          key: `article-audio-export:openai:daily:${viewerTokenIdentifier}`,
          count: 2,
          windowStart: 300,
          expiresAt: 400,
          createdAt: 290,
          updatedAt: 310,
        },
        {
          _id: "quota-unrelated",
          key: `route-quota:product-feedback:${viewerTokenIdentifier}`,
          count: 99,
          windowStart: 1,
          expiresAt: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await expect(
      getViewerAccountDataOverviewForCtx(ctx as never),
    ).resolves.toEqual({
      feed: {
        status: "active",
        feedToken: "viewer-secret-token",
        createdAt: 10,
        updatedAt: 20,
      },
      quotas: [
        {
          feature: "personalPlaylist",
          count: 3,
          windowStart: 100,
          expiresAt: 200,
          createdAt: 90,
          updatedAt: 110,
        },
        {
          feature: "articleAudioExport",
          count: 2,
          windowStart: 300,
          expiresAt: 400,
          createdAt: 290,
          updatedAt: 310,
        },
      ],
    });
  });

  it("returns revoked feed history without exposing its token tombstone", async () => {
    const viewerTokenIdentifier = "https://clerk.example|viewer-1";
    const ctx = createOverviewCtx({
      viewerTokenIdentifier,
      feeds: [
        {
          _id: "feed-revoked",
          viewerTokenIdentifier,
          feedToken: "random-revocation-tombstone",
          revokedAt: 250,
          createdAt: 100,
          updatedAt: 260,
        },
      ],
    });

    await expect(
      getViewerAccountDataOverviewForCtx(ctx as never),
    ).resolves.toEqual({
      feed: {
        status: "revoked",
        feedToken: null,
        createdAt: 100,
        updatedAt: 260,
        revokedAt: 250,
      },
      quotas: [],
    });
  });

  it("requires authentication before reading account data", async () => {
    const ctx = createOverviewCtx({ viewerTokenIdentifier: null });

    await expect(
      getViewerAccountDataOverviewForCtx(ctx as never),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("getViewerAccountDataPageForCtx", () => {
  it("pages only the signed-in viewer's bookmarks and caps oversized requests", async () => {
    const viewerTokenIdentifier = "https://clerk.example|viewer-1";
    const docs = Array.from({ length: 105 }, (_, index) => ({
      _id: `bookmark-${index}`,
      _creationTime: index,
      viewerTokenIdentifier,
      slug: `article-${index}`,
      title: `Article ${index}`,
      savedAt: 1_000 + index,
      updatedAt: 2_000 + index,
      serverOnlyField: "must-not-leak",
    }));
    docs.splice(1, 0, {
      _id: "bookmark-other",
      _creationTime: 1,
      viewerTokenIdentifier: "https://clerk.example|viewer-2",
      slug: "private-to-someone-else",
      title: "Someone else's bookmark",
      savedAt: 9_999,
      updatedAt: 9_999,
      serverOnlyField: "must-not-leak",
    });
    const { ctx, getLastPaginationOpts } = createPageCtx({
      tableName: "bookmarks",
      docs,
      viewerTokenIdentifier,
    });

    const result = await getViewerAccountDataPageForCtx(ctx as never, {
      collection: "bookmarks",
      paginationOpts: { cursor: null, numItems: 1_000 },
    });

    expect(getLastPaginationOpts()).toMatchObject({
      cursor: null,
      numItems: 100,
    });
    expect(result.page).toHaveLength(100);
    expect(result.page[0]).toEqual({
      slug: "article-0",
      title: "Article 0",
      savedAt: 1_000,
      updatedAt: 2_000,
    });
    expect(result).toMatchObject({
      continueCursor: "100",
      isDone: false,
    });
  });

  it("exports active and removed playlist episodes without worker or storage internals", async () => {
    const viewerTokenIdentifier = "https://clerk.example|viewer-1";
    const { ctx } = createPageCtx({
      tableName: "personalPlaylistEpisodes",
      viewerTokenIdentifier,
      docs: [
        {
          _id: "episode-active",
          viewerTokenIdentifier,
          articleId: "article-1",
          slug: "active-article",
          title: "Active article",
          description: "A useful summary",
          imageUrl: "https://images.example/active.jpg",
          position: 0,
          publishedAt: 100,
          status: "ready",
          sectionCount: 4,
          completedSectionCount: 4,
          durationSeconds: 120,
          byteLength: 4_096,
          provider: "openai",
          model: "gpt-4o-mini-tts",
          voiceId: "sage",
          createdAt: 90,
          updatedAt: 110,
          storageId: "storage-secret",
          ttsCacheKey: "cache-secret",
          narrationHash: "narration-secret",
          leaseOwner: "worker-secret",
          lastError: "raw upstream error",
        },
        {
          _id: "episode-removed",
          viewerTokenIdentifier,
          articleId: "article-2",
          slug: "removed-article",
          title: "Removed article",
          position: 1,
          publishedAt: 80,
          removedAt: 120,
          status: "failed",
          stage: "rendering_audio",
          sectionCount: 6,
          completedSectionCount: 2,
          createdAt: 70,
          updatedAt: 120,
          lastError: "secret stack trace",
        },
      ],
    });

    const result = await getViewerAccountDataPageForCtx(ctx as never, {
      collection: "playlistEpisodes",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page).toEqual([
      {
        slug: "active-article",
        title: "Active article",
        description: "A useful summary",
        imageUrl: "https://images.example/active.jpg",
        position: 0,
        publishedAt: 100,
        status: "ready",
        sectionCount: 4,
        completedSectionCount: 4,
        durationSeconds: 120,
        byteLength: 4_096,
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voiceId: "sage",
        createdAt: 90,
        updatedAt: 110,
      },
      {
        slug: "removed-article",
        title: "Removed article",
        position: 1,
        publishedAt: 80,
        removedAt: 120,
        status: "failed",
        stage: "rendering_audio",
        sectionCount: 6,
        completedSectionCount: 2,
        createdAt: 70,
        updatedAt: 120,
      },
    ]);
  });

  it("exports exact listening progress and heard ranges without account identifiers", async () => {
    const viewerTokenIdentifier = "https://clerk.example|viewer-1";
    const { ctx } = createPageCtx({
      tableName: "viewerArticleListenProgress",
      viewerTokenIdentifier,
      docs: [
        {
          _id: "progress-1",
          viewerTokenIdentifier,
          articleId: "article-1",
          wikiPageId: "wiki-1",
          slug: "Roman_roads",
          title: "Roman roads",
          totalDurationSeconds: 180,
          heardSeconds: 72.5,
          qualifiedAt: 1_500,
          sections: [
            {
              sectionKey: "summary",
              durationSeconds: 60,
              heardRanges: [
                { startSecond: 0, endSecond: 30.25 },
                { startSecond: 45, endSecond: 60 },
              ],
            },
            {
              sectionKey: "section-1",
              durationSeconds: 120,
              heardRanges: [{ startSecond: 10, endSecond: 37.25 }],
            },
          ],
          createdAt: 1_000,
          updatedAt: 2_000,
          internalMarker: "must-not-leak",
        },
      ],
    });

    const result = await getViewerAccountDataPageForCtx(ctx as never, {
      collection: "listeningProgress",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page).toEqual([
      {
        wikiPageId: "wiki-1",
        slug: "Roman_roads",
        title: "Roman roads",
        totalDurationSeconds: 180,
        heardSeconds: 72.5,
        qualifiedAt: 1_500,
        sections: [
          {
            sectionKey: "summary",
            durationSeconds: 60,
            heardRanges: [
              { startSecond: 0, endSecond: 30.25 },
              { startSecond: 45, endSecond: 60 },
            ],
          },
          {
            sectionKey: "section-1",
            durationSeconds: 120,
            heardRanges: [{ startSecond: 10, endSecond: 37.25 }],
          },
        ],
        createdAt: 1_000,
        updatedAt: 2_000,
      },
    ]);
  });

  it("exports earned badge credit as article context rather than database records", async () => {
    const viewerTokenIdentifier = "https://clerk.example|viewer-1";
    const { ctx } = createPageCtx({
      tableName: "badgeArticleCredits",
      viewerTokenIdentifier,
      docs: [
        {
          _id: "credit-1",
          viewerTokenIdentifier,
          articleId: "article-1",
          wikiPageId: "wiki-1",
          slug: "Ada_Lovelace",
          title: "Ada Lovelace",
          badgeKey: "biography",
          earnedAt: 2_000,
          internalMarker: "must-not-leak",
        },
      ],
    });

    const result = await getViewerAccountDataPageForCtx(ctx as never, {
      collection: "badgeCredits",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page).toEqual([
      {
        wikiPageId: "wiki-1",
        slug: "Ada_Lovelace",
        title: "Ada Lovelace",
        badgeKey: "biography",
        earnedAt: 2_000,
      },
    ]);
  });

  it("exports dismissed and failed article audio exports without operational internals", async () => {
    const viewerTokenIdentifier = "https://clerk.example|viewer-1";
    const { ctx } = createPageCtx({
      tableName: "articleAudioExports",
      viewerTokenIdentifier,
      docs: [
        {
          _id: "export-dismissed",
          ownerTokenIdentifier: viewerTokenIdentifier,
          clientId: "private-client-id",
          articleId: "article-1",
          slug: "Saturn",
          title: "Saturn",
          status: "ready",
          stage: "packaging",
          sectionCount: 8,
          completedSectionCount: 8,
          byteLength: 12_345,
          ttsProvider: "openai",
          requestedTtsMetadata: {
            provider: "openai",
            model: "gpt-4o-mini-tts",
            voiceId: "sage",
            promptVersion: "secret-prompt-version",
            ttsNormVersion: "secret-normalization-version",
            ttsCacheKey: "secret-cache-key",
          },
          dismissedAt: 2_500,
          createdAt: 1_000,
          updatedAt: 2_500,
          storageId: "storage-secret",
          queueKey: "queue-secret",
          leaseOwner: "worker-secret",
        },
        {
          _id: "export-failed",
          ownerTokenIdentifier: viewerTokenIdentifier,
          clientId: "private-client-id",
          articleId: "article-2",
          slug: "Neptune",
          title: "Neptune",
          status: "failed",
          stage: "rendering_audio",
          sectionCount: 6,
          completedSectionCount: 2,
          ttsProvider: "openai",
          createdAt: 3_000,
          updatedAt: 3_500,
          lastError: "raw upstream stack trace",
        },
        {
          _id: "export-other-viewer",
          ownerTokenIdentifier: "https://clerk.example|viewer-2",
          clientId: "other-client-id",
          articleId: "article-3",
          slug: "Private_elsewhere",
          title: "Private elsewhere",
          status: "ready",
          sectionCount: 1,
          completedSectionCount: 1,
          createdAt: 4_000,
          updatedAt: 4_000,
        },
      ],
    });

    const result = await getViewerAccountDataPageForCtx(ctx as never, {
      collection: "articleAudioExports",
      paginationOpts: { cursor: null, numItems: 25 },
    });

    expect(result.page).toEqual([
      {
        slug: "Saturn",
        title: "Saturn",
        status: "ready",
        stage: "packaging",
        sectionCount: 8,
        completedSectionCount: 8,
        byteLength: 12_345,
        ttsProvider: "openai",
        model: "gpt-4o-mini-tts",
        voiceId: "sage",
        dismissedAt: 2_500,
        createdAt: 1_000,
        updatedAt: 2_500,
      },
      {
        slug: "Neptune",
        title: "Neptune",
        status: "failed",
        stage: "rendering_audio",
        sectionCount: 6,
        completedSectionCount: 2,
        ttsProvider: "openai",
        createdAt: 3_000,
        updatedAt: 3_500,
      },
    ]);
  });

  it("requires authentication before selecting a collection", async () => {
    const { ctx } = createPageCtx({
      tableName: "bookmarks",
      docs: [],
      viewerTokenIdentifier: null,
    });

    await expect(
      getViewerAccountDataPageForCtx(ctx as never, {
        collection: "bookmarks",
        paginationOpts: { cursor: null, numItems: 25 },
      }),
    ).rejects.toThrow("Unauthorized");
  });
});
