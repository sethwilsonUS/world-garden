import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESUME_CURSOR_LIMITS } from "@curio-garden/domain";

import { createAccountDeletionQueryChain } from "../test-utils/account-deletion-stubs";
import {
  getNativeViewerArticleResumeForCtx,
  sumEstimatedProgressDurationSeconds,
  writeNativeViewerArticleResumeForCtx,
} from "./listeningProgress";

type StoredResumeCursor = {
  revisionId: string;
  narrationVersion: number;
  mode: "all" | "single";
  sectionKey: string;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: number;
};

type ProgressDoc = {
  _id: string;
  viewerTokenIdentifier: string;
  articleId: string;
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
  resumeCursorVersion?: number;
  resumeCursor?: StoredResumeCursor;
  createdAt: number;
  updatedAt: number;
};

type ArticleDoc = {
  _id: string;
  wikiPageId: string;
  revisionId: string;
  narrationVersion: number;
  slug?: string;
  title: string;
  summary?: string;
  sections?: Array<{
    wikiSectionIndex?: string;
    title: string;
    level: number;
    content: string;
    narration?: {
      mode: "verbatim" | "structured" | "transition" | "none";
      text: string;
      sourceFormat: "prose" | "table" | "list" | "mixed" | "heading";
      adapted: boolean;
      usedRawFallback: boolean;
      sourceHash: string;
    };
  }>;
};

const tokenIdentifierForSubject = (subject: string): string =>
  `https://issuer.example|${subject}`;

const getField = (doc: object, field: string): unknown =>
  (doc as Record<string, unknown>)[field];

const createListeningProgressTestCtx = ({
  articles = [],
  deletingViewers = [],
  progress = [],
  subject = "user-a",
}: {
  articles?: ArticleDoc[];
  deletingViewers?: string[];
  progress?: ProgressDoc[];
  subject?: string;
} = {}) => {
  let progressDocs = progress.map((doc) => structuredClone(doc));
  let nextId = progressDocs.length;
  const insert = vi.fn(
    async (_tableName: string, value: Omit<ProgressDoc, "_id">) => {
      nextId += 1;
      const _id = `progress-${nextId}`;
      progressDocs.push({ _id, ...structuredClone(value) });
      return _id;
    },
  );
  const patch = vi.fn(async (id: string, value: Partial<ProgressDoc>) => {
    progressDocs = progressDocs.map((doc) => {
      if (doc._id !== id) return doc;
      const next = { ...doc } as Record<string, unknown>;
      for (const [key, fieldValue] of Object.entries(structuredClone(value))) {
        if (fieldValue === undefined) delete next[key];
        else next[key] = fieldValue;
      }
      return next as ProgressDoc;
    });
  });

  const queryImplementation = (tableName: string) => {
    if (tableName === "accountDeletionRequests") {
      return createAccountDeletionQueryChain(deletingViewers);
    }
    const source: object[] =
      tableName === "articles"
        ? articles
        : tableName === "viewerArticleListenProgress"
          ? progressDocs
          : [];
    return {
      withIndex: (
        _indexName: string,
        apply: (builder: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown,
      ) => {
        const filters = new Map<string, unknown>();
        const builder = {
          eq: (field: string, value: unknown) => {
            filters.set(field, value);
            return builder;
          },
        };
        apply(builder);
        const matches = () =>
          source.filter((doc) =>
            [...filters].every(
              ([field, value]) => getField(doc, field) === value,
            ),
          );
        return {
          first: async () => matches()[0] ?? null,
          unique: async () => matches()[0] ?? null,
        };
      },
    };
  };
  const query = vi.fn(queryImplementation);

  return {
    ctx: {
      auth: {
        getUserIdentity: vi.fn().mockResolvedValue({
          subject,
          tokenIdentifier: tokenIdentifierForSubject(subject),
        }),
      },
      db: { insert, patch, query },
    },
    getProgress: () => structuredClone(progressDocs),
    insert,
    patch,
    query,
  };
};

const legacyProgress = (subject = "user-a"): ProgressDoc => ({
  _id: `progress-${subject}`,
  viewerTokenIdentifier: tokenIdentifierForSubject(subject),
  articleId: "article-42",
  wikiPageId: "42",
  slug: "Pumpkin",
  title: "Pumpkin",
  totalDurationSeconds: 180,
  heardSeconds: 12,
  sections: [],
  createdAt: 10,
  updatedAt: 20,
});

const article42 = (): ArticleDoc => ({
  _id: "article-42",
  wikiPageId: "42",
  revisionId: "99",
  narrationVersion: 2,
  slug: "Pumpkin",
  title: "Pumpkin",
  summary: "Pumpkins are cultivated winter squash.",
  sections: [
    {
      wikiSectionIndex: "1",
      title: "Description",
      level: 2,
      content: "A pumpkin has a hard rind and distinctive ribs.",
      narration: {
        mode: "verbatim",
        text: "A pumpkin has a hard rind and distinctive ribs.",
        sourceFormat: "prose",
        adapted: false,
        usedRawFallback: false,
        sourceHash: "description-hash",
      },
    },
    {
      wikiSectionIndex: "2",
      title: "Uses",
      level: 2,
      content: "Pumpkins are food.",
      narration: {
        mode: "verbatim",
        text: "Pumpkins are food.",
        sourceFormat: "prose",
        adapted: false,
        usedRawFallback: false,
        sourceHash: "uses-hash",
      },
    },
  ],
});

describe("server-derived article progress duration", () => {
  it("uses one second for an article with no progress-counting tracks", () => {
    expect(sumEstimatedProgressDurationSeconds([])).toBe(1);
  });

  it("fails closed when the aggregate exceeds the resume duration bound", () => {
    expect(
      sumEstimatedProgressDurationSeconds([
        RESUME_CURSOR_LIMITS.maxDurationSeconds,
        1,
      ]),
    ).toBeNull();
  });
});

const liveProgress = (subject = "user-a"): ProgressDoc => ({
  ...legacyProgress(subject),
  resumeCursorVersion: 3,
  resumeCursor: {
    revisionId: "99",
    narrationVersion: 2,
    mode: "all",
    sectionKey: "section-0",
    positionSeconds: 14,
    durationSeconds: 90,
    updatedAt: 1_786_467_600_000,
  },
});

const qualifiedLiveProgress = (): ProgressDoc => ({
  ...liveProgress(),
  qualifiedAt: 777,
  sections: [
    {
      sectionKey: "section-0",
      durationSeconds: 90,
      heardRanges: [{ startSecond: 0, endSecond: 12 }],
    },
  ],
});

describe("native viewer article resume reads", () => {
  it("echoes the epoch and treats a legacy progress row as version-zero with no cursor", async () => {
    const { ctx } = createListeningProgressTestCtx({
      progress: [legacyProgress()],
    });

    await expect(
      getNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
      }),
    ).resolves.toEqual({
      sessionEpochKey: "epoch-a",
      cursorVersion: 0,
      cursor: null,
    });
  });

  it("returns only the bound account's live cursor with server-owned metadata", async () => {
    const { ctx } = createListeningProgressTestCtx({
      articles: [article42()],
      progress: [liveProgress("user-a"), liveProgress("user-b")],
      subject: "user-a",
    });

    await expect(
      getNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
      }),
    ).resolves.toEqual({
      sessionEpochKey: "epoch-a",
      cursorVersion: 3,
      cursor: {
        wikiPageId: "42",
        revisionId: "99",
        narrationVersion: 2,
        mode: "all",
        sectionKey: "section-0",
        positionSeconds: 14,
        durationSeconds: 90,
        cursorVersion: 3,
        updatedAt: 1_786_467_600_000,
      },
    });
  });

  it("rejects wrong-account read args before returning another viewer's cursor", async () => {
    const { ctx } = createListeningProgressTestCtx({
      articles: [article42()],
      progress: [liveProgress("user-a")],
      subject: "user-b",
    });

    await expect(
      getNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
      }),
    ).rejects.toThrow("Account changed");
  });

  it("does not offer a cursor for a stale article revision", async () => {
    const staleArticle = { ...article42(), revisionId: "100" };
    const { ctx } = createListeningProgressTestCtx({
      articles: [staleArticle],
      progress: [liveProgress()],
    });

    await expect(
      getNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
      }),
    ).resolves.toEqual({
      sessionEpochKey: "epoch-a",
      cursorVersion: 3,
      cursor: null,
    });
  });

  it("fails closed on a corrupt stored optimistic version", async () => {
    const corrupt = { ...legacyProgress(), resumeCursorVersion: -1 };
    const { ctx } = createListeningProgressTestCtx({ progress: [corrupt] });

    await expect(
      getNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
      }),
    ).rejects.toThrow("Invalid listening progress request.");
  });

  it("fails closed when a stored live cursor has no optimistic version", async () => {
    const malformed = liveProgress();
    delete malformed.resumeCursorVersion;
    const { ctx } = createListeningProgressTestCtx({
      articles: [article42()],
      progress: [malformed],
    });

    await expect(
      getNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
      }),
    ).rejects.toThrow("Invalid listening progress request.");
  });

  it("checks account deletion before reading progress", async () => {
    const viewerTokenIdentifier = tokenIdentifierForSubject("user-a");
    const { ctx, query } = createListeningProgressTestCtx({
      deletingViewers: [viewerTokenIdentifier],
      progress: [liveProgress()],
    });

    await expect(
      getNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
      }),
    ).rejects.toThrow("ACCOUNT_DELETION_IN_PROGRESS");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("accountDeletionRequests");
  });
});

describe("native viewer article resume writes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T21:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a versioned cursor row from current server-owned article metadata", async () => {
    const { ctx, getProgress } = createListeningProgressTestCtx({
      articles: [article42()],
    });
    const cursor = {
      wikiPageId: "42",
      revisionId: "99",
      narrationVersion: 2,
      mode: "all" as const,
      sectionKey: "section-0" as const,
      positionSeconds: 14,
      durationSeconds: 90,
    };

    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
        expectedCursorVersion: 0,
        cursor,
      }),
    ).resolves.toEqual({
      sessionEpochKey: "epoch-a",
      cursorVersion: 1,
      cursor: {
        ...cursor,
        cursorVersion: 1,
        updatedAt: Date.now(),
      },
      disposition: "applied",
    });
    expect(getProgress()).toEqual([
      expect.objectContaining({
        viewerTokenIdentifier: tokenIdentifierForSubject("user-a"),
        articleId: "article-42",
        wikiPageId: "42",
        slug: "Pumpkin",
        title: "Pumpkin",
        // 5-word summary -> 2s, 9-word Description -> 4s, 3-word Uses -> 1s.
        totalDurationSeconds: 7,
        heardSeconds: 0,
        sections: [],
        resumeCursorVersion: 1,
        resumeCursor: {
          revisionId: "99",
          narrationVersion: 2,
          mode: "all",
          sectionKey: "section-0",
          positionSeconds: 14,
          durationSeconds: 90,
          updatedAt: Date.now(),
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
    ]);
  });

  it("patches only cursor metadata on an established heard and qualified row", async () => {
    const initial = qualifiedLiveProgress();
    const { ctx, getProgress } = createListeningProgressTestCtx({
      articles: [article42()],
      progress: [initial],
    });

    await writeNativeViewerArticleResumeForCtx(ctx as never, {
      expectedAccountSubject: "user-a",
      sessionEpochKey: "epoch-a",
      wikiPageId: "42",
      expectedCursorVersion: 3,
      cursor: {
        wikiPageId: "42",
        revisionId: "99",
        narrationVersion: 2,
        mode: "all",
        sectionKey: "section-0",
        positionSeconds: 30,
        durationSeconds: 90,
      },
    });

    expect(getProgress()[0]).toMatchObject({
      heardSeconds: initial.heardSeconds,
      qualifiedAt: 777,
      sections: initial.sections,
      createdAt: initial.createdAt,
      resumeCursorVersion: 4,
      resumeCursor: expect.objectContaining({ positionSeconds: 30 }),
    });
    expect(getProgress()[0]?.totalDurationSeconds).toBe(
      initial.totalDurationSeconds,
    );
  });

  it("returns the current cursor without writing when compare-and-set is stale", async () => {
    const initial = liveProgress();
    const { ctx, getProgress, insert, patch } = createListeningProgressTestCtx({
      articles: [article42()],
      progress: [initial],
    });

    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
        expectedCursorVersion: 2,
        cursor: {
          wikiPageId: "42",
          revisionId: "99",
          narrationVersion: 2,
          mode: "all",
          sectionKey: "section-0",
          positionSeconds: 30,
          durationSeconds: 90,
        },
      }),
    ).resolves.toEqual({
      sessionEpochKey: "epoch-a",
      cursorVersion: 3,
      cursor: {
        wikiPageId: "42",
        revisionId: "99",
        narrationVersion: 2,
        mode: "all",
        sectionKey: "section-0",
        positionSeconds: 14,
        durationSeconds: 90,
        cursorVersion: 3,
        updatedAt: 1_786_467_600_000,
      },
      disposition: "stale",
    });
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(getProgress()).toEqual([initial]);
  });

  it("fails closed instead of overwriting a stored version-zero cursor", async () => {
    const malformed = { ...liveProgress(), resumeCursorVersion: 0 };
    const { ctx, getProgress, insert, patch } = createListeningProgressTestCtx({
      articles: [article42()],
      progress: [malformed],
    });

    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
        expectedCursorVersion: 0,
        cursor: {
          wikiPageId: "42",
          revisionId: "99",
          narrationVersion: 2,
          mode: "all",
          sectionKey: "section-0",
          positionSeconds: 30,
          durationSeconds: 90,
        },
      }),
    ).rejects.toThrow("Invalid listening progress request.");
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(getProgress()).toEqual([malformed]);
  });

  it("turns an identical retry into a stale converged response without a second write", async () => {
    const { ctx, insert, patch } = createListeningProgressTestCtx({
      articles: [article42()],
    });
    const args = {
      expectedAccountSubject: "user-a",
      sessionEpochKey: "epoch-a",
      wikiPageId: "42",
      expectedCursorVersion: 0,
      cursor: {
        wikiPageId: "42",
        revisionId: "99",
        narrationVersion: 2,
        mode: "all" as const,
        sectionKey: "section-0" as const,
        positionSeconds: 14,
        durationSeconds: 90,
      },
    };

    const first = await writeNativeViewerArticleResumeForCtx(
      ctx as never,
      args,
    );
    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, args),
    ).resolves.toEqual({ ...first, disposition: "stale" });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
  });

  it("persists a clear tombstone so a stale retry cannot resurrect playback", async () => {
    const { ctx, getProgress, patch } = createListeningProgressTestCtx({
      articles: [article42()],
      progress: [liveProgress()],
    });

    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
        expectedCursorVersion: 3,
        cursor: null,
      }),
    ).resolves.toEqual({
      sessionEpochKey: "epoch-a",
      cursorVersion: 4,
      cursor: null,
      disposition: "applied",
    });
    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
        expectedCursorVersion: 3,
        cursor: {
          wikiPageId: "42",
          revisionId: "99",
          narrationVersion: 2,
          mode: "all",
          sectionKey: "section-0",
          positionSeconds: 30,
          durationSeconds: 90,
        },
      }),
    ).resolves.toEqual({
      sessionEpochKey: "epoch-a",
      cursorVersion: 4,
      cursor: null,
      disposition: "stale",
    });

    expect(patch).toHaveBeenCalledTimes(1);
    expect(getProgress()[0]).toMatchObject({ resumeCursorVersion: 4 });
    expect(getProgress()[0]).not.toHaveProperty("resumeCursor");
  });

  it("clears an existing row without requiring the current article cache", async () => {
    const { ctx, getProgress, query } = createListeningProgressTestCtx({
      progress: [liveProgress()],
    });

    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
        expectedCursorVersion: 3,
        cursor: null,
      }),
    ).resolves.toMatchObject({
      cursor: null,
      cursorVersion: 4,
      disposition: "applied",
    });
    expect(query).not.toHaveBeenCalledWith("articles");
    expect(getProgress()[0]).toMatchObject({
      articleId: "article-42",
      slug: "Pumpkin",
      title: "Pumpkin",
      resumeCursorVersion: 4,
    });
  });

  it("makes a first-ever clear a version-one tombstone that stale version zero cannot overwrite", async () => {
    const { ctx, getProgress, insert } = createListeningProgressTestCtx({
      articles: [article42()],
    });

    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
        expectedCursorVersion: 0,
        cursor: null,
      }),
    ).resolves.toMatchObject({
      cursor: null,
      cursorVersion: 1,
      disposition: "applied",
    });
    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
        expectedCursorVersion: 0,
        cursor: {
          wikiPageId: "42",
          revisionId: "99",
          narrationVersion: 2,
          mode: "all",
          sectionKey: "section-0",
          positionSeconds: 14,
          durationSeconds: 90,
        },
      }),
    ).resolves.toEqual({
      sessionEpochKey: "epoch-a",
      cursorVersion: 1,
      cursor: null,
      disposition: "stale",
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(getProgress()[0]).toMatchObject({
      resumeCursorVersion: 1,
      totalDurationSeconds: 7,
    });
    expect(getProgress()[0]).not.toHaveProperty("resumeCursor");
  });

  it("rejects a wrong account, stale article, and nonexistent audio section without writing", async () => {
    const article = article42();
    const { ctx, insert, patch, query } = createListeningProgressTestCtx({
      articles: [article],
      subject: "user-b",
    });
    const baseArgs = {
      expectedAccountSubject: "user-b",
      sessionEpochKey: "epoch-b",
      wikiPageId: "42",
      expectedCursorVersion: 0,
      cursor: {
        wikiPageId: "42",
        revisionId: "99",
        narrationVersion: 2,
        mode: "all" as const,
        sectionKey: "section-0" as const,
        positionSeconds: 14,
        durationSeconds: 90,
      },
    };

    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        ...baseArgs,
        expectedAccountSubject: "user-a",
      }),
    ).rejects.toThrow("Account changed");
    expect(query).not.toHaveBeenCalled();
    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        ...baseArgs,
        cursor: { ...baseArgs.cursor, revisionId: "100" },
      }),
    ).rejects.toThrow("Invalid listening progress request.");
    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        ...baseArgs,
        cursor: { ...baseArgs.cursor, sectionKey: "section-2" },
      }),
    ).rejects.toThrow("Invalid listening progress request.");
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects a write after account deletion starts", async () => {
    const viewerTokenIdentifier = tokenIdentifierForSubject("user-a");
    const { ctx, insert, patch, query } = createListeningProgressTestCtx({
      articles: [article42()],
      deletingViewers: [viewerTokenIdentifier],
    });

    await expect(
      writeNativeViewerArticleResumeForCtx(ctx as never, {
        expectedAccountSubject: "user-a",
        sessionEpochKey: "epoch-a",
        wikiPageId: "42",
        expectedCursorVersion: 0,
        cursor: null,
      }),
    ).rejects.toThrow("ACCOUNT_DELETION_IN_PROGRESS");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("accountDeletionRequests");
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([
    ["negative", -1],
    ["fractional", 0.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
  ])(
    "rejects a %s optimistic version without writing",
    async (_label, version) => {
      const { ctx, insert, patch } = createListeningProgressTestCtx({
        articles: [article42()],
      });

      await expect(
        writeNativeViewerArticleResumeForCtx(ctx as never, {
          expectedAccountSubject: "user-a",
          sessionEpochKey: "epoch-a",
          wikiPageId: "42",
          expectedCursorVersion: version,
          cursor: null,
        }),
      ).rejects.toThrow("Invalid listening progress request.");
      expect(insert).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );
});
