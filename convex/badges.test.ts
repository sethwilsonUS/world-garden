import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { Id } from "./_generated/dataModel";
import {
  calculateListeningLedgerUpdate,
  cleanupExpiredMeaningfulUseSessionsForCtx,
  getViewerBadgeCreditsByKeyForCtx,
  getViewerBadgeProgressForCtx,
  recordViewerArticleListenProgressForCtx,
} from "./badges";
import { createAccountDeletionQueryChain } from "../test-utils/account-deletion-stubs";

type ArticleDoc = {
  _id: Id<"articles">;
  wikiPageId: string;
  title: string;
  slug: string;
  summary?: string;
  sections?: Array<{
    wikiSectionIndex?: string;
    title: string;
    level: number;
    content: string;
  }>;
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
  meaningfulUseSession?: {
    startedAt: number;
    sections: Array<{
      sectionKey: string;
      durationSeconds: number;
      heardRanges: Array<{ startSecond: number; endSecond: number }>;
    }>;
  };
  meaningfulUseSessionExpiresAt?: number;
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
  runAfter?: ReturnType<typeof vi.fn>;
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
            | "badgeArticleCredits"
            | "accountDeletionRequests",
        ) => {
          if (tableName === "accountDeletionRequests") {
            return createAccountDeletionQueryChain();
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
          };
        },
        get: async (id: string) =>
          articles.find((article) => article._id === id) ?? null,
        insert: async (
          tableName: "viewerArticleListenProgress" | "badgeArticleCredits",
          value: Omit<ListenProgressDoc, "_id"> | Omit<BadgeCreditDoc, "_id">,
        ) => {
          idCounter += 1;
          const id = `${tableName}-${idCounter}` as never;
          if (tableName === "viewerArticleListenProgress") {
            progressDocs.push({
              _id: id,
              ...(value as Omit<ListenProgressDoc, "_id">),
            });
          } else {
            creditDocs.push({
              _id: id,
              ...(value as Omit<BadgeCreditDoc, "_id">),
            });
          }
          return id;
        },
        patch: async (id: string, value: Partial<ListenProgressDoc>) => {
          progressDocs = progressDocs.map((doc) =>
            doc._id === id ? { ...doc, ...value } : doc,
          );
        },
      },
      scheduler: {
        runAfter: seed?.runAfter ?? vi.fn().mockResolvedValue("scheduled"),
      },
    },
    getProgressDocs: () => progressDocs,
    getCredits: () => creditDocs,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("calculateListeningLedgerUpdate", () => {
  it("counts only newly covered ranges for canonical progress tracks", () => {
    expect(
      calculateListeningLedgerUpdate({
        existingSections: [
          {
            sectionKey: "summary",
            durationSeconds: 20,
            heardRanges: [{ startSecond: 0, endSecond: 5 }],
          },
        ],
        mergedSections: [
          {
            sectionKey: "summary",
            durationSeconds: 20,
            heardRanges: [{ startSecond: 0, endSecond: 8 }],
          },
        ],
        updatedSectionKey: "summary",
        progressSectionKeys: ["summary"],
      }),
    ).toMatchObject({
      newUniqueSeconds: 3,
      meaningfulUse: false,
      heardProgressSectionKeys: ["summary"],
    });
  });

  it("excludes heading tracks from useful seconds and meaningful use", () => {
    expect(
      calculateListeningLedgerUpdate({
        existingSections: [],
        mergedSections: [
          {
            sectionKey: "section-0",
            durationSeconds: 20,
            heardRanges: [{ startSecond: 0, endSecond: 20 }],
          },
        ],
        updatedSectionKey: "section-0",
        progressSectionKeys: [],
      }),
    ).toEqual({
      newUniqueSeconds: 0,
      meaningfulUse: false,
      newlyMeaningfulUse: false,
      heardProgressSectionKeys: [],
    });
  });

  it("attributes meaningful use only when the current session crosses a threshold", () => {
    expect(
      calculateListeningLedgerUpdate({
        existingSections: [
          {
            sectionKey: "summary",
            durationSeconds: 20,
            heardRanges: [{ startSecond: 0, endSecond: 16 }],
          },
        ],
        mergedSections: [
          {
            sectionKey: "summary",
            durationSeconds: 20,
            heardRanges: [{ startSecond: 0, endSecond: 17 }],
          },
        ],
        updatedSectionKey: "summary",
        progressSectionKeys: ["summary"],
        existingSessionSections: [
          {
            sectionKey: "summary",
            durationSeconds: 20,
            heardRanges: [{ startSecond: 0, endSecond: 15 }],
          },
        ],
        mergedSessionSections: [
          {
            sectionKey: "summary",
            durationSeconds: 20,
            heardRanges: [{ startSecond: 0, endSecond: 17 }],
          },
        ],
      }),
    ).toMatchObject({
      newUniqueSeconds: 1,
      meaningfulUse: true,
      newlyMeaningfulUse: true,
      heardProgressSectionKeys: ["summary"],
    });
  });
});

describe("cleanupExpiredMeaningfulUseSessionsForCtx", () => {
  it("clears expired and legacy sessions in a bounded ledger-independent page", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "off");
    const paginate = vi.fn().mockResolvedValue({
      page: [
        {
          _id: "legacy-session",
          meaningfulUseSession: { startedAt: 1, sections: [] },
        },
        {
          _id: "expired-session",
          meaningfulUseSession: { startedAt: 2, sections: [] },
          meaningfulUseSessionExpiresAt: 10_000,
        },
        {
          _id: "live-session",
          meaningfulUseSession: { startedAt: 3, sections: [] },
          meaningfulUseSessionExpiresAt: 10_001,
        },
      ],
      continueCursor: "next-page",
      isDone: false,
    });
    const patch = vi.fn().mockResolvedValue(undefined);
    const runAfter = vi.fn().mockResolvedValue("scheduled");
    const ctx = {
      db: {
        query: vi.fn(() => ({ paginate })),
        patch,
      },
      scheduler: { runAfter },
    };

    await expect(
      cleanupExpiredMeaningfulUseSessionsForCtx(ctx as never, {
        now: 10_000,
        limit: 3,
        cursor: "current-page",
      }),
    ).resolves.toEqual({
      cleared: 2,
      continueCursor: "next-page",
      isDone: false,
    });

    expect(paginate).toHaveBeenCalledWith({
      cursor: "current-page",
      numItems: 3,
    });
    expect(patch).toHaveBeenCalledTimes(2);
    expect(patch).toHaveBeenCalledWith("legacy-session", {
      meaningfulUseSession: undefined,
      meaningfulUseSessionExpiresAt: undefined,
    });
    expect(patch).toHaveBeenCalledWith("expired-session", {
      meaningfulUseSession: undefined,
      meaningfulUseSessionExpiresAt: undefined,
    });
    expect(patch).not.toHaveBeenCalledWith("live-session", expect.anything());
    expect(runAfter).toHaveBeenCalledOnce();
    expect(getFunctionName(runAfter.mock.calls[0][1])).toBe(
      "badges:cleanupExpiredMeaningfulUseSessions",
    );
    expect(runAfter.mock.calls[0][2]).toEqual({ cursor: "next-page" });
  });
});

describe("recordViewerArticleListenProgressForCtx", () => {
  it("keeps listen progress successful when its idempotent ledger enqueue fails", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
    const runAfter = vi
      .fn()
      .mockRejectedValue(new Error("scheduler unavailable"));
    const articleId = "article-scheduled" as Id<"articles">;
    const { ctx, getProgressDocs } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-scheduled",
          title: "The Two Towers",
          slug: "The_Two_Towers",
          summary: "A sufficiently long canonical summary for narration.",
        },
      ],
      runAfter,
    });

    await expect(
      recordViewerArticleListenProgressForCtx(ctx as never, {
        articleId,
        wikiPageId: "wiki-scheduled",
        slug: "The_Two_Towers",
        title: "The Two Towers",
        totalDurationSeconds: 20,
        sectionKey: "summary",
        sectionDurationSeconds: 20,
        heardRanges: [{ startSecond: 0, endSecond: 3 }],
      }),
    ).resolves.toMatchObject({
      heardSeconds: 3,
      qualified: false,
    });

    expect(getProgressDocs()).toHaveLength(1);
    expect(runAfter).toHaveBeenCalledOnce();
    expect(getFunctionName(runAfter.mock.calls[0][1])).toBe(
      "aiCostLedger:recordListeningContributionInternal",
    );
    expect(runAfter.mock.calls[0][2]).toMatchObject({
      eventKey: "00000000-0000-4000-8000-000000000001",
      articleId,
      sectionKeys: ["summary"],
      newUniqueSeconds: 3,
      meaningfulUse: false,
    });
  });

  it("does not schedule listening ledger work while the ledger is off", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "off");
    const runAfter = vi.fn().mockResolvedValue("scheduled");
    const articleId = "article-off" as Id<"articles">;
    const { ctx } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-off",
          title: "A Long-expected Party",
          slug: "A_Long-expected_Party",
          summary: "A sufficiently long canonical summary for narration.",
        },
      ],
      runAfter,
    });

    await recordViewerArticleListenProgressForCtx(ctx as never, {
      articleId,
      wikiPageId: "wiki-off",
      slug: "A_Long-expected_Party",
      title: "A Long-expected Party",
      totalDurationSeconds: 20,
      sectionKey: "summary",
      sectionDurationSeconds: 20,
      heardRanges: [{ startSecond: 0, endSecond: 3 }],
    });

    expect(runAfter).not.toHaveBeenCalled();
  });

  it("clears an inactive meaningful-use session on an empty write even while the ledger is off", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "off");
    const now = 1_780_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const runAfter = vi.fn().mockResolvedValue("scheduled");
    const articleId = "article-expired-session" as Id<"articles">;
    const { ctx, getProgressDocs } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-expired-session",
          title: "The Last Debate",
          slug: "The_Last_Debate",
          summary: "A sufficiently long canonical summary for narration.",
        },
      ],
      progress: [
        {
          _id: "progress-expired-session" as Id<"viewerArticleListenProgress">,
          viewerTokenIdentifier: "viewer-1",
          articleId,
          wikiPageId: "wiki-expired-session",
          slug: "The_Last_Debate",
          title: "The Last Debate",
          totalDurationSeconds: 100,
          heardSeconds: 20,
          sections: [
            {
              sectionKey: "summary",
              durationSeconds: 100,
              heardRanges: [{ startSecond: 0, endSecond: 20 }],
            },
          ],
          meaningfulUseSession: {
            startedAt: now - 3_600_000,
            sections: [
              {
                sectionKey: "summary",
                durationSeconds: 100,
                heardRanges: [{ startSecond: 0, endSecond: 20 }],
              },
            ],
          },
          meaningfulUseSessionExpiresAt: now - 1,
          createdAt: now - 3_600_000,
          updatedAt: now - 1_000,
        },
      ],
      runAfter,
    });

    await recordViewerArticleListenProgressForCtx(ctx as never, {
      articleId,
      wikiPageId: "wiki-expired-session",
      slug: "The_Last_Debate",
      title: "The Last Debate",
      totalDurationSeconds: 100,
      sectionKey: "summary",
      sectionDurationSeconds: 100,
      heardRanges: [],
    });

    expect(getProgressDocs()[0]?.meaningfulUseSession).toBeUndefined();
    expect(getProgressDocs()[0]?.meaningfulUseSessionExpiresAt).toBeUndefined();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("records only the newly covered signed-in seconds with an idempotent internal key", async () => {
    const articleId = "article-1" as Id<"articles">;
    const recordListeningContribution = vi.fn().mockResolvedValue({
      created: true,
      disposition: "inserted",
    });
    const { ctx } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-1",
          title: "Roman roads",
          slug: "Roman_roads",
          summary: "A sufficiently long canonical summary for narration.",
        },
      ],
      progress: [
        {
          _id: "progress-1" as Id<"viewerArticleListenProgress">,
          viewerTokenIdentifier: "viewer-1",
          articleId,
          wikiPageId: "wiki-1",
          slug: "Roman_roads",
          title: "Roman roads",
          totalDurationSeconds: 20,
          heardSeconds: 5,
          sections: [
            {
              sectionKey: "summary",
              durationSeconds: 20,
              heardRanges: [{ startSecond: 0, endSecond: 5 }],
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await recordViewerArticleListenProgressForCtx(
      ctx as never,
      {
        articleId,
        wikiPageId: "wiki-1",
        slug: "Roman_roads",
        title: "Roman roads",
        totalDurationSeconds: 20,
        sectionKey: "summary",
        sectionDurationSeconds: 20,
        heardRanges: [{ startSecond: 4, endSecond: 8 }],
      },
      { recordListeningContribution },
    );

    expect(recordListeningContribution).toHaveBeenCalledOnce();
    const contribution = recordListeningContribution.mock.calls[0]?.[1];
    expect(contribution).toMatchObject({
      eventKey: expect.any(String),
      articleId,
      sectionKeys: ["summary"],
      newUniqueSeconds: 3,
      meaningfulUse: false,
      observedAt: expect.any(Number),
    });
    expect(contribution.eventKey).not.toContain("progress-1");
    expect(contribution.eventKey).not.toContain("summary");
    expect(contribution.eventKey).not.toContain("viewer-1");
    expect(contribution.eventKey).not.toContain("Roman");
  });

  it("does not let lifetime progress qualify a new listening session after one second", async () => {
    const articleId = "article-meaningful-window" as Id<"articles">;
    const oldProgressCreatedAt = 1_700_000_000_000;
    const generationGeneratedAt = 1_779_999_999_000;
    const currentSessionStartedAt = 1_780_000_000_000;
    const recordListeningContribution = vi.fn().mockResolvedValue({
      created: true,
      disposition: "inserted",
    });
    const { ctx } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-meaningful-window",
          title: "The Long Defeat",
          slug: "The_Long_Defeat",
          summary: "A sufficiently long canonical summary for narration.",
          sections: [
            {
              wikiSectionIndex: "1",
              title: "Renewal",
              level: 2,
              content: "A sufficiently long current section for narration.",
            },
          ],
        },
      ],
      progress: [
        {
          _id: "progress-meaningful-window" as Id<"viewerArticleListenProgress">,
          viewerTokenIdentifier: "viewer-1",
          articleId,
          wikiPageId: "wiki-meaningful-window",
          slug: "The_Long_Defeat",
          title: "The Long Defeat",
          totalDurationSeconds: 100,
          heardSeconds: 59,
          sections: [
            {
              sectionKey: "summary",
              durationSeconds: 100,
              heardRanges: [{ startSecond: 0, endSecond: 59 }],
            },
          ],
          createdAt: oldProgressCreatedAt,
          updatedAt: oldProgressCreatedAt,
        },
      ],
    });

    await recordViewerArticleListenProgressForCtx(
      ctx as never,
      {
        articleId,
        wikiPageId: "wiki-meaningful-window",
        slug: "The_Long_Defeat",
        title: "The Long Defeat",
        totalDurationSeconds: 100,
        sectionKey: "section-0",
        sectionDurationSeconds: 100,
        heardRanges: [{ startSecond: 0, endSecond: 1 }],
        listeningSessionStartedAt: currentSessionStartedAt,
        progressStartedAt: currentSessionStartedAt,
      },
      { recordListeningContribution },
    );

    expect(recordListeningContribution).toHaveBeenCalledOnce();
    expect(recordListeningContribution.mock.calls[0]?.[1]).toMatchObject({
      articleId,
      sectionKeys: ["section-0"],
      newUniqueSeconds: 1,
      meaningfulUse: false,
      progressStartedAt: currentSessionStartedAt,
      observedAt: expect.any(Number),
    });
    expect(generationGeneratedAt).toBeGreaterThan(oldProgressCreatedAt);
    expect(
      recordListeningContribution.mock.calls[0]?.[1].progressStartedAt,
    ).toBeGreaterThanOrEqual(generationGeneratedAt);
  });

  it("extends session retention only when that listening session is active", async () => {
    const articleId = "article-session-inactivity" as Id<"articles">;
    const initialObservedAt = 1_780_000_000_000;
    const listeningSessionStartedAt = initialObservedAt - 1_000;
    let observedAt = initialObservedAt;
    vi.spyOn(Date, "now").mockImplementation(() => observedAt);
    const recordListeningContribution = vi.fn().mockResolvedValue({
      created: true,
      disposition: "inserted",
    });
    const { ctx, getProgressDocs } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-session-inactivity",
          title: "The Steward and the King",
          slug: "The_Steward_and_the_King",
          summary: "A sufficiently long canonical summary for narration.",
        },
      ],
      progress: [
        {
          _id: "progress-session-inactivity" as Id<"viewerArticleListenProgress">,
          viewerTokenIdentifier: "viewer-1",
          articleId,
          wikiPageId: "wiki-session-inactivity",
          slug: "The_Steward_and_the_King",
          title: "The Steward and the King",
          totalDurationSeconds: 100,
          heardSeconds: 1,
          sections: [
            {
              sectionKey: "summary",
              durationSeconds: 100,
              heardRanges: [{ startSecond: 0, endSecond: 1 }],
            },
          ],
          meaningfulUseSession: {
            startedAt: listeningSessionStartedAt,
            sections: [
              {
                sectionKey: "summary",
                durationSeconds: 100,
                heardRanges: [{ startSecond: 0, endSecond: 1 }],
              },
            ],
          },
          meaningfulUseSessionExpiresAt: initialObservedAt + 1,
          createdAt: listeningSessionStartedAt,
          updatedAt: listeningSessionStartedAt,
        },
      ],
    });

    await recordViewerArticleListenProgressForCtx(
      ctx as never,
      {
        articleId,
        wikiPageId: "wiki-session-inactivity",
        slug: "The_Steward_and_the_King",
        title: "The Steward and the King",
        totalDurationSeconds: 100,
        sectionKey: "summary",
        sectionDurationSeconds: 100,
        heardRanges: [{ startSecond: 1, endSecond: 2 }],
        listeningSessionStartedAt,
        progressStartedAt: initialObservedAt,
      },
      { recordListeningContribution },
    );
    const activeExpiry = initialObservedAt + 2 * 60 * 60 * 1_000;
    expect(getProgressDocs()[0]?.meaningfulUseSessionExpiresAt).toBe(
      activeExpiry,
    );

    observedAt += 60_000;
    await recordViewerArticleListenProgressForCtx(
      ctx as never,
      {
        articleId,
        wikiPageId: "wiki-session-inactivity",
        slug: "The_Steward_and_the_King",
        title: "The Steward and the King",
        totalDurationSeconds: 100,
        sectionKey: "summary",
        sectionDurationSeconds: 100,
        heardRanges: [{ startSecond: 2, endSecond: 3 }],
      },
      { recordListeningContribution },
    );

    expect(getProgressDocs()[0]?.meaningfulUseSessionExpiresAt).toBe(
      activeExpiry,
    );
  });

  it("does not reuse a prior lifetime qualification for a new session", async () => {
    const articleId = "article-returning-listener" as Id<"articles">;
    const currentSessionStartedAt = 1_780_000_000_000;
    const recordListeningContribution = vi.fn().mockResolvedValue({
      created: true,
      disposition: "inserted",
    });
    const { ctx } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-returning-listener",
          title: "Many Meetings",
          slug: "Many_Meetings",
          summary: "A sufficiently long canonical summary for narration.",
        },
      ],
      progress: [
        {
          _id: "progress-returning-listener" as Id<"viewerArticleListenProgress">,
          viewerTokenIdentifier: "viewer-1",
          articleId,
          wikiPageId: "wiki-returning-listener",
          slug: "Many_Meetings",
          title: "Many Meetings",
          totalDurationSeconds: 100,
          heardSeconds: 60,
          qualifiedAt: 1_700_000_060_000,
          sections: [
            {
              sectionKey: "summary",
              durationSeconds: 100,
              heardRanges: [{ startSecond: 0, endSecond: 60 }],
            },
          ],
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_060_000,
        },
      ],
    });

    await recordViewerArticleListenProgressForCtx(
      ctx as never,
      {
        articleId,
        wikiPageId: "wiki-returning-listener",
        slug: "Many_Meetings",
        title: "Many Meetings",
        totalDurationSeconds: 100,
        sectionKey: "summary",
        sectionDurationSeconds: 100,
        heardRanges: [{ startSecond: 60, endSecond: 61 }],
        listeningSessionStartedAt: currentSessionStartedAt,
        progressStartedAt: currentSessionStartedAt,
      },
      { recordListeningContribution },
    );

    expect(recordListeningContribution).toHaveBeenCalledOnce();
    expect(recordListeningContribution.mock.calls[0]?.[1]).toMatchObject({
      articleId,
      sectionKeys: ["summary"],
      newUniqueSeconds: 1,
      meaningfulUse: false,
      progressStartedAt: currentSessionStartedAt,
      observedAt: expect.any(Number),
    });
  });

  it("attributes meaningful use once after twelve five-second session flushes", async () => {
    const articleId = "article-periodic-session" as Id<"articles">;
    const listeningSessionStartedAt = Date.now() - 1_000;
    const recordListeningContribution = vi.fn().mockResolvedValue({
      created: true,
      disposition: "inserted",
    });
    const { ctx, getProgressDocs } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-periodic-session",
          title: "The Road Goes Ever On",
          slug: "The_Road_Goes_Ever_On",
          summary: "A sufficiently long canonical summary for narration.",
        },
      ],
    });

    for (let flush = 0; flush < 12; flush += 1) {
      await recordViewerArticleListenProgressForCtx(
        ctx as never,
        {
          articleId,
          wikiPageId: "wiki-periodic-session",
          slug: "The_Road_Goes_Ever_On",
          title: "The Road Goes Ever On",
          totalDurationSeconds: 100,
          sectionKey: "summary",
          sectionDurationSeconds: 100,
          heardRanges: [{ startSecond: flush * 5, endSecond: (flush + 1) * 5 }],
          listeningSessionStartedAt,
          progressStartedAt: listeningSessionStartedAt,
        },
        { recordListeningContribution },
      );
    }

    expect(
      recordListeningContribution.mock.calls.map(
        (call) => call[1].meaningfulUse,
      ),
    ).toEqual([...Array.from({ length: 11 }, () => false), true]);
    expect(getProgressDocs()[0]?.meaningfulUseSession).toEqual({
      startedAt: listeningSessionStartedAt,
      sections: [
        {
          sectionKey: "summary",
          durationSeconds: 100,
          heardRanges: [{ startSecond: 0, endSecond: 60 }],
        },
      ],
    });
  });

  it("attributes a cross-section session to every heard section from the session start", async () => {
    const articleId = "article-cross-section-session" as Id<"articles">;
    const listeningSessionStartedAt = Date.now() - 120_000;
    const laterSummaryGenerationAt = listeningSessionStartedAt + 60_000;
    const finalSectionStartedAt = listeningSessionStartedAt + 90_000;
    const recordListeningContribution = vi.fn().mockResolvedValue({
      created: true,
      disposition: "inserted",
    });
    const { ctx } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-cross-section-session",
          title: "The Council of Elrond",
          slug: "The_Council_of_Elrond",
          summary: "A sufficiently long canonical summary for narration.",
          sections: [
            {
              wikiSectionIndex: "1",
              title: "The Ring Goes South",
              level: 2,
              content: "A sufficiently long canonical section for narration.",
            },
          ],
        },
      ],
    });

    await recordViewerArticleListenProgressForCtx(
      ctx as never,
      {
        articleId,
        wikiPageId: "wiki-cross-section-session",
        slug: "The_Council_of_Elrond",
        title: "The Council of Elrond",
        totalDurationSeconds: 200,
        sectionKey: "summary",
        sectionDurationSeconds: 100,
        heardRanges: [{ startSecond: 0, endSecond: 30 }],
        listeningSessionStartedAt,
        progressStartedAt: listeningSessionStartedAt,
      },
      { recordListeningContribution },
    );
    await recordViewerArticleListenProgressForCtx(
      ctx as never,
      {
        articleId,
        wikiPageId: "wiki-cross-section-session",
        slug: "The_Council_of_Elrond",
        title: "The Council of Elrond",
        totalDurationSeconds: 200,
        sectionKey: "section-0",
        sectionDurationSeconds: 100,
        heardRanges: [{ startSecond: 0, endSecond: 30 }],
        listeningSessionStartedAt,
        progressStartedAt: finalSectionStartedAt,
      },
      { recordListeningContribution },
    );

    expect(recordListeningContribution).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({
        sectionKeys: ["summary"],
        newUniqueSeconds: 30,
        meaningfulUse: false,
        progressStartedAt: listeningSessionStartedAt,
      }),
    );
    expect(recordListeningContribution).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({
        sectionKeys: ["summary", "section-0"],
        newUniqueSeconds: 30,
        meaningfulUse: true,
        progressStartedAt: listeningSessionStartedAt,
      }),
    );
    expect(
      recordListeningContribution.mock.calls[1]?.[1].progressStartedAt,
    ).toBeLessThan(laterSummaryGenerationAt);
  });

  it("records a replay session qualification even when it adds no lifetime seconds", async () => {
    const articleId = "article-replay-session" as Id<"articles">;
    const listeningSessionStartedAt = Date.now() - 1_000;
    const recordListeningContribution = vi.fn().mockResolvedValue({
      created: true,
      disposition: "inserted",
    });
    const { ctx } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-replay-session",
          title: "The Shadow of the Past",
          slug: "The_Shadow_of_the_Past",
          summary: "A sufficiently long canonical summary for narration.",
        },
      ],
      progress: [
        {
          _id: "progress-replay-session" as Id<"viewerArticleListenProgress">,
          viewerTokenIdentifier: "viewer-1",
          articleId,
          wikiPageId: "wiki-replay-session",
          slug: "The_Shadow_of_the_Past",
          title: "The Shadow of the Past",
          totalDurationSeconds: 100,
          heardSeconds: 100,
          qualifiedAt: 1,
          sections: [
            {
              sectionKey: "summary",
              durationSeconds: 100,
              heardRanges: [{ startSecond: 0, endSecond: 100 }],
            },
          ],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await recordViewerArticleListenProgressForCtx(
      ctx as never,
      {
        articleId,
        wikiPageId: "wiki-replay-session",
        slug: "The_Shadow_of_the_Past",
        title: "The Shadow of the Past",
        totalDurationSeconds: 100,
        sectionKey: "summary",
        sectionDurationSeconds: 100,
        heardRanges: [{ startSecond: 0, endSecond: 60 }],
        listeningSessionStartedAt,
        progressStartedAt: listeningSessionStartedAt,
      },
      { recordListeningContribution },
    );

    expect(recordListeningContribution).toHaveBeenCalledOnce();
    expect(recordListeningContribution.mock.calls[0]?.[1]).toMatchObject({
      newUniqueSeconds: 0,
      meaningfulUse: true,
    });
  });

  it("does not let a stale flush replace a newer listening session", async () => {
    const articleId = "article-stale-session" as Id<"articles">;
    const newerSessionStartedAt = Date.now() - 1_000;
    const recordListeningContribution = vi.fn().mockResolvedValue({
      created: true,
      disposition: "inserted",
    });
    const { ctx, getProgressDocs } = createCtx({
      articles: [
        {
          _id: articleId,
          wikiPageId: "wiki-stale-session",
          title: "Flotsam and Jetsam",
          slug: "Flotsam_and_Jetsam",
          summary: "A sufficiently long canonical summary for narration.",
        },
      ],
      progress: [
        {
          _id: "progress-stale-session" as Id<"viewerArticleListenProgress">,
          viewerTokenIdentifier: "viewer-1",
          articleId,
          wikiPageId: "wiki-stale-session",
          slug: "Flotsam_and_Jetsam",
          title: "Flotsam and Jetsam",
          totalDurationSeconds: 100,
          heardSeconds: 1,
          sections: [
            {
              sectionKey: "summary",
              durationSeconds: 100,
              heardRanges: [{ startSecond: 0, endSecond: 1 }],
            },
          ],
          meaningfulUseSession: {
            startedAt: newerSessionStartedAt,
            sections: [
              {
                sectionKey: "summary",
                durationSeconds: 100,
                heardRanges: [{ startSecond: 0, endSecond: 20 }],
              },
            ],
          },
          meaningfulUseSessionExpiresAt: newerSessionStartedAt + 60_000,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    await recordViewerArticleListenProgressForCtx(
      ctx as never,
      {
        articleId,
        wikiPageId: "wiki-stale-session",
        slug: "Flotsam_and_Jetsam",
        title: "Flotsam and Jetsam",
        totalDurationSeconds: 100,
        sectionKey: "summary",
        sectionDurationSeconds: 100,
        heardRanges: [{ startSecond: 20, endSecond: 21 }],
        listeningSessionStartedAt: newerSessionStartedAt - 1_000,
        progressStartedAt: newerSessionStartedAt - 1_000,
      },
      { recordListeningContribution },
    );

    expect(getProgressDocs()[0]?.meaningfulUseSession).toEqual({
      startedAt: newerSessionStartedAt,
      sections: [
        {
          sectionKey: "summary",
          durationSeconds: 100,
          heardRanges: [{ startSecond: 0, endSecond: 20 }],
        },
      ],
    });
    expect(recordListeningContribution.mock.calls[0]?.[1]).toMatchObject({
      newUniqueSeconds: 1,
      meaningfulUse: false,
    });
  });

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

    await expect(
      getViewerBadgeProgressForCtx(ctx as never),
    ).resolves.toMatchObject({
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
