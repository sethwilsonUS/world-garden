import { describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  getViewerBadgeCreditsByKeyForCtx,
  getViewerBadgeProgressForCtx,
  recordViewerArticleListenProgressForCtx,
} from "./badges";

type ArticleDoc = {
  _id: Id<"articles">;
  wikiPageId: string;
  title: string;
  slug: string;
  badgeKeys?: string[];
};

type ListenProgressDoc = {
  _id: Id<"viewerArticleListenProgress">;
  viewerTokenIdentifier: string;
  articleId: Id<"articles">;
  wikiPageId: string;
  slug: string;
  title: string;
  totalDurationSeconds: number;
  heardSeconds: number;
  qualifiedAt?: number;
  sections: Array<{
    sectionKey: string;
    durationSeconds: number;
    heardRanges: Array<{ startSecond: number; endSecond: number }>;
  }>;
  createdAt: number;
  updatedAt: number;
};

type BadgeCreditDoc = {
  _id: Id<"badgeArticleCredits">;
  viewerTokenIdentifier: string;
  articleId: Id<"articles">;
  wikiPageId: string;
  slug: string;
  title: string;
  badgeKey:
    | "history"
    | "geography"
    | "biography"
    | "society_politics"
    | "arts_culture"
    | "science"
    | "technology"
    | "nature";
  earnedAt: number;
};

const matchesFilters = (
  doc: Record<string, unknown>,
  filters: Array<[string, unknown]>,
) => filters.every(([field, value]) => doc[field] === value);

const createCtx = (seed?: {
  articles?: ArticleDoc[];
  progress?: ListenProgressDoc[];
  credits?: BadgeCreditDoc[];
}) => {
  const articles = [...(seed?.articles ?? [])];
  let progressDocs = [...(seed?.progress ?? [])];
  const creditDocs = [...(seed?.credits ?? [])];
  let idCounter = articles.length + progressDocs.length + creditDocs.length;

  return {
    ctx: {
      auth: {
        getUserIdentity: vi.fn().mockResolvedValue({
          tokenIdentifier: "viewer-1",
        }),
      },
      db: {
        query: (
          tableName:
            | "viewerArticleListenProgress"
            | "badgeArticleCredits",
        ) => ({
          withIndex: (
            _indexName: string,
            apply: (builder: { eq: (field: string, value: unknown) => unknown }) => unknown,
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
              tableName === "viewerArticleListenProgress"
                ? progressDocs
                : creditDocs;
            const filtered = docs.filter((doc) =>
              matchesFilters(doc as Record<string, unknown>, filters),
            );

            return {
              unique: async () => filtered[0] ?? null,
              collect: async () => filtered,
            };
          },
        }),
        get: async (id: string) =>
          articles.find((article) => article._id === id) ?? null,
        insert: async (
          tableName: "viewerArticleListenProgress" | "badgeArticleCredits",
          value: Omit<ListenProgressDoc, "_id"> | Omit<BadgeCreditDoc, "_id">,
        ) => {
          idCounter += 1;
          const id = `${tableName}-${idCounter}` as never;
          if (tableName === "viewerArticleListenProgress") {
            progressDocs.push({ _id: id, ...(value as Omit<ListenProgressDoc, "_id">) });
          } else {
            creditDocs.push({ _id: id, ...(value as Omit<BadgeCreditDoc, "_id">) });
          }
          return id;
        },
        patch: async (
          id: string,
          value: Partial<ListenProgressDoc>,
        ) => {
          progressDocs = progressDocs.map((doc) =>
            doc._id === id ? { ...doc, ...value } : doc,
          );
        },
      },
    },
    getProgressDocs: () => progressDocs,
    getCredits: () => creditDocs,
  };
};

describe("recordViewerArticleListenProgressForCtx", () => {
  it("qualifies an article at 80 percent and awards each matching badge once", async () => {
    const { ctx, getCredits, getProgressDocs } = createCtx({
      articles: [
        {
          _id: "article-1" as Id<"articles">,
          wikiPageId: "wiki-1",
          title: "Roman roads",
          slug: "Roman_roads",
          badgeKeys: ["history", "technology"],
        },
      ],
    });

    await expect(
      recordViewerArticleListenProgressForCtx(ctx as never, {
        articleId: "article-1" as Id<"articles">,
        wikiPageId: "wiki-1",
        slug: "Roman_roads",
        title: "Roman roads",
        totalDurationSeconds: 10,
        sectionKey: "summary",
        sectionDurationSeconds: 10,
        heardRanges: [{ startSecond: 0, endSecond: 8 }],
      }),
    ).resolves.toMatchObject({
      heardSeconds: 8,
      totalDurationSeconds: 10,
      qualified: true,
      awardedBadgeKeys: ["history", "technology"],
      awardedBadges: [
        expect.objectContaining({
          key: "history",
          exp: 1,
          level: 0,
          leveledUp: false,
        }),
        expect.objectContaining({
          key: "technology",
          exp: 1,
          level: 0,
          leveledUp: false,
        }),
      ],
    });

    expect(getCredits()).toHaveLength(2);
    expect(getProgressDocs()[0]).toMatchObject({
      heardSeconds: 8,
      qualifiedAt: expect.any(Number),
    });
  });

  it("does not duplicate badge credit on repeat listens", async () => {
    const { ctx, getCredits } = createCtx({
      articles: [
        {
          _id: "article-1" as Id<"articles">,
          wikiPageId: "wiki-1",
          title: "Roman roads",
          slug: "Roman_roads",
          badgeKeys: ["history"],
        },
      ],
    });

    await recordViewerArticleListenProgressForCtx(ctx as never, {
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "Roman_roads",
      title: "Roman roads",
      totalDurationSeconds: 10,
      sectionKey: "summary",
      sectionDurationSeconds: 10,
      heardRanges: [{ startSecond: 0, endSecond: 8 }],
    });

    await recordViewerArticleListenProgressForCtx(ctx as never, {
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "Roman_roads",
      title: "Roman roads",
      totalDurationSeconds: 10,
      sectionKey: "summary",
      sectionDurationSeconds: 10,
      heardRanges: [{ startSecond: 8, endSecond: 10 }],
    });

    expect(getCredits()).toHaveLength(1);
  });

  it("reports a level-up when the awarded EXP reaches the next threshold", async () => {
    const { ctx } = createCtx({
      articles: [
        {
          _id: "article-5" as Id<"articles">,
          wikiPageId: "wiki-5",
          title: "Roman Empire",
          slug: "Roman_Empire",
          badgeKeys: ["history"],
        },
      ],
      credits: [
        {
          _id: "credit-1" as Id<"badgeArticleCredits">,
          viewerTokenIdentifier: "viewer-1",
          articleId: "article-old-1" as Id<"articles">,
          wikiPageId: "wiki-old-1",
          slug: "History_1",
          title: "History 1",
          badgeKey: "history",
          earnedAt: 1,
        },
        {
          _id: "credit-2" as Id<"badgeArticleCredits">,
          viewerTokenIdentifier: "viewer-1",
          articleId: "article-old-2" as Id<"articles">,
          wikiPageId: "wiki-old-2",
          slug: "History_2",
          title: "History 2",
          badgeKey: "history",
          earnedAt: 2,
        },
        {
          _id: "credit-3" as Id<"badgeArticleCredits">,
          viewerTokenIdentifier: "viewer-1",
          articleId: "article-old-3" as Id<"articles">,
          wikiPageId: "wiki-old-3",
          slug: "History_3",
          title: "History 3",
          badgeKey: "history",
          earnedAt: 3,
        },
        {
          _id: "credit-4" as Id<"badgeArticleCredits">,
          viewerTokenIdentifier: "viewer-1",
          articleId: "article-old-4" as Id<"articles">,
          wikiPageId: "wiki-old-4",
          slug: "History_4",
          title: "History 4",
          badgeKey: "history",
          earnedAt: 4,
        },
      ],
    });

    await expect(
      recordViewerArticleListenProgressForCtx(ctx as never, {
        articleId: "article-5" as Id<"articles">,
        wikiPageId: "wiki-5",
        slug: "Roman_Empire",
        title: "Roman Empire",
        totalDurationSeconds: 10,
        sectionKey: "summary",
        sectionDurationSeconds: 10,
        heardRanges: [{ startSecond: 0, endSecond: 8 }],
      }),
    ).resolves.toMatchObject({
      awardedBadges: [
        expect.objectContaining({
          key: "history",
          exp: 5,
          level: 1,
          previousLevel: 0,
          leveledUp: true,
        }),
      ],
    });
  });

  it("keeps skipped gaps as gaps instead of filling them in", async () => {
    const { ctx, getProgressDocs } = createCtx({
      articles: [
        {
          _id: "article-1" as Id<"articles">,
          wikiPageId: "wiki-1",
          title: "Roman roads",
          slug: "Roman_roads",
          badgeKeys: ["history"],
        },
      ],
    });

    await recordViewerArticleListenProgressForCtx(ctx as never, {
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "Roman_roads",
      title: "Roman roads",
      totalDurationSeconds: 10,
      sectionKey: "summary",
      sectionDurationSeconds: 10,
      heardRanges: [
        { startSecond: 0, endSecond: 2 },
        { startSecond: 7, endSecond: 9 },
      ],
    });

    expect(getProgressDocs()[0].heardSeconds).toBe(4);
    expect(getProgressDocs()[0].qualifiedAt).toBeUndefined();
  });
});

describe("getViewerBadgeProgressForCtx", () => {
  it("returns all launch badges, including empty ones", async () => {
    const { ctx } = createCtx({
      credits: [
        {
          _id: "badgeArticleCredits-1" as Id<"badgeArticleCredits">,
          viewerTokenIdentifier: "viewer-1",
          articleId: "article-1" as Id<"articles">,
          wikiPageId: "wiki-1",
          slug: "Roman_roads",
          title: "Roman roads",
          badgeKey: "history",
          earnedAt: 1,
        },
        {
          _id: "badgeArticleCredits-2" as Id<"badgeArticleCredits">,
          viewerTokenIdentifier: "viewer-1",
          articleId: "article-2" as Id<"articles">,
          wikiPageId: "wiki-2",
          slug: "Canals",
          title: "Canals",
          badgeKey: "history",
          earnedAt: 2,
        },
      ],
    });

    await expect(getViewerBadgeProgressForCtx(ctx as never)).resolves.toMatchObject({
      totalExp: 2,
      unlockedBadgeCount: 0,
      badgeCredits: expect.arrayContaining([
        expect.objectContaining({
          badgeKey: "history",
          credits: expect.arrayContaining([
            expect.objectContaining({
              title: "Canals",
              slug: "Canals",
            }),
            expect.objectContaining({
              title: "Roman roads",
              slug: "Roman_roads",
            }),
          ]),
        }),
      ]),
      badges: expect.arrayContaining([
        expect.objectContaining({
          key: "history",
          exp: 2,
        }),
        expect.objectContaining({
          key: "science",
          exp: 0,
        }),
      ]),
    });
  });
});

describe("getViewerBadgeCreditsByKey", () => {
  it("returns the credited articles for a selected badge in most-recent-first order", async () => {
    const { ctx } = createCtx({
      credits: [
        {
          _id: "badgeArticleCredits-1" as Id<"badgeArticleCredits">,
          viewerTokenIdentifier: "viewer-1",
          articleId: "article-1" as Id<"articles">,
          wikiPageId: "wiki-1",
          slug: "Roman_roads",
          title: "Roman roads",
          badgeKey: "history",
          earnedAt: 1,
        },
        {
          _id: "badgeArticleCredits-2" as Id<"badgeArticleCredits">,
          viewerTokenIdentifier: "viewer-1",
          articleId: "article-2" as Id<"articles">,
          wikiPageId: "wiki-2",
          slug: "Canals",
          title: "Canals",
          badgeKey: "history",
          earnedAt: 2,
        },
        {
          _id: "badgeArticleCredits-3" as Id<"badgeArticleCredits">,
          viewerTokenIdentifier: "viewer-1",
          articleId: "article-3" as Id<"articles">,
          wikiPageId: "wiki-3",
          slug: "Ada_Lovelace",
          title: "Ada Lovelace",
          badgeKey: "biography",
          earnedAt: 3,
        },
      ],
    });

    await expect(
      getViewerBadgeCreditsByKeyForCtx(ctx as never, { badgeKey: "history" }),
    ).resolves.toEqual([
      expect.objectContaining({
        title: "Canals",
        slug: "Canals",
      }),
      expect.objectContaining({
        title: "Roman roads",
        slug: "Roman_roads",
      }),
    ]);
  });
});
