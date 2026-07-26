import { describe, expect, it, vi } from "vitest";
import {
  evaluateArticleAudioExportAllowance,
  canAccessArticleAudioExport,
  findReusableArticleAudioExport,
  getArticleAudioExportDownloadIdentity,
  getRecentArticleAudioExports,
  isArticleAudioExportCompatible,
  isArticleAudioExportReusable,
  isRequestedTtsMetadataValid,
  MAX_RECENT_EXPORT_CANDIDATES,
  normalizeRecentArticleAudioExportLimit,
  resolveRequestedArticleExportTtsMetadata,
  getArticleAudioExportQueueKey,
  getArticleAudioExportQuotaConfig,
  getArticleAudioExportProvider,
  getArticleExportSections,
  resolveArticleAudioExportBaseUrl,
  selectAccessibleArticleAudioExportCandidates,
} from "./articleExports";
import { buildTtsCacheKey, type TtsMetadata } from "../lib/tts-profile";
import { TTS_NORM_VERSION } from "../lib/tts-normalize";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  buildArticleNarrationHash,
  buildArticleNarrationTracks,
} from "../lib/section-narration";
import { createTestSection } from "../lib/test-section-narration";

const STALE_TTS_NORM_VERSION = `${TTS_NORM_VERSION}:stale`;

describe("getArticleExportSections", () => {
  it("includes every narrated section", () => {
    const article = {
      _id: "article-1" as never,
      title: "Example article",
      revisionId: "100",
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
      summary: "Lead summary with enough content to speak aloud.",
      sections: [
        createTestSection({
          title: "History",
          level: 2,
          content:
            "The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
        }),
        createTestSection({
          title: "Election results",
          level: 2,
          content: [
            "Year  Candidate  Vote",
            "2020  Rivera     51.2%",
            "2022  Patel      49.8%",
          ].join("\n"),
          narration: {
            mode: "structured",
            sourceFormat: "table",
            adapted: true,
            text: "Election results. Table. Columns: Year; Candidate; Vote. Row 1: Year: 2020; Candidate: Rivera; Vote: 51.2%. Row 2: Year: 2022; Candidate: Patel; Vote: 49.8%.",
          },
        }),
      ],
    };
    const result = getArticleExportSections(article);
    const sourceHashes = new Map(
      buildArticleNarrationTracks(article).map((track) => [
        track.sectionKey,
        track.sourceHash,
      ]),
    );

    expect(result).toEqual([
      {
        sectionKey: "summary",
        text: "Lead summary with enough content to speak aloud.",
        sourceHash: sourceHashes.get("summary"),
      },
      {
        sectionKey: "section-0",
        text: "History. The city rebuilt its harbor after the storm. Officials later expanded the rail connection to the capital.",
        sourceHash: sourceHashes.get("section-0"),
      },
      {
        sectionKey: "section-1",
        text: "Election results. Table. Columns: Year; Candidate; Vote. Row 1: Year: 2020; Candidate: Rivera; Vote: 51.2%. Row 2: Year: 2022; Candidate: Patel; Vote: 49.8%.",
        sourceHash: sourceHashes.get("section-1"),
      },
    ]);
  });

  it("keeps visual captions and descriptions out of packaged article audio", () => {
    const articleWithVisualContext = {
      _id: "article-1" as never,
      title: "Example article",
      revisionId: "100",
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
      summary: "Lead summary with enough content to speak aloud.",
      sections: [],
      contextBlocks: [
        {
          id: "timeline-context",
          title: "A short chronology",
          caption: "The milestone happened in 1969.",
          longDescription: "The chronology contains one milestone in 1969.",
        },
      ],
    };

    const result = getArticleExportSections(articleWithVisualContext);
    const summarySourceHash = buildArticleNarrationTracks(
      articleWithVisualContext,
    )[0].sourceHash;

    expect(result).toEqual([
      {
        sectionKey: "summary",
        text: "Lead summary with enough content to speak aloud.",
        sourceHash: summarySourceHash,
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("milestone");
    expect(JSON.stringify(result)).not.toContain("context-");
  });
});

describe("findReusableArticleAudioExport", () => {
  it("does not reuse ready exports generated for a different TTS cache key", () => {
    const edgeTtsCacheKey = buildTtsCacheKey({
      provider: "edge",
      model: "edge-tts",
      voiceId: "en-US-AriaNeural",
      promptVersion: "edge-default",
      ttsNormVersion: TTS_NORM_VERSION,
    });
    const openAiTtsCacheKey = buildTtsCacheKey({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voiceId: "marin",
      promptVersion: "curio-warm-narrator-v1",
      ttsNormVersion: TTS_NORM_VERSION,
    });
    const reusable = findReusableArticleAudioExport(
      [
        {
          _id: "old-export",
          status: "ready",
          updatedAt: 1,
          narrationHash: "current-narration",
          ttsCacheKey: edgeTtsCacheKey,
        },
        {
          _id: "new-export",
          status: "ready",
          updatedAt: 2,
          narrationHash: "current-narration",
          ttsCacheKey: openAiTtsCacheKey,
        },
      ],
      openAiTtsCacheKey,
      "current-narration",
    );

    expect(reusable?._id).toBe("new-export");
  });

  it("does not reuse an export from older narration", () => {
    expect(
      findReusableArticleAudioExport(
        [
          {
            _id: "old-export",
            status: "ready",
            updatedAt: 1,
            narrationHash: "old-narration",
            ttsCacheKey: "current-tts",
          },
        ],
        "current-tts",
        "current-narration",
      ),
    ).toBeUndefined();
  });

  it("keeps a fallback export deliverable but does not reuse it as primary-profile audio", () => {
    const fallbackExport = {
      _id: "fallback-export",
      status: "ready",
      updatedAt: 1,
      narrationHash: "current-narration",
      ttsCacheKey: "requested-primary-profile",
      producedTtsCacheKey: "produced-fallback-profile",
    };

    expect(
      isArticleAudioExportCompatible(
        fallbackExport,
        "requested-primary-profile",
        "current-narration",
      ),
    ).toBe(true);
    expect(
      isArticleAudioExportReusable(
        fallbackExport,
        "requested-primary-profile",
        "current-narration",
      ),
    ).toBe(false);
    expect(
      findReusableArticleAudioExport(
        [fallbackExport],
        "requested-primary-profile",
        "current-narration",
      ),
    ).toBeUndefined();
  });
});

describe("isArticleAudioExportCompatible", () => {
  it("rejects exports from a different TTS profile even when narration matches", () => {
    expect(
      isArticleAudioExportCompatible(
        {
          narrationHash: "current-narration",
          ttsCacheKey: "previous-profile",
        },
        "current-profile",
        "current-narration",
      ),
    ).toBe(false);
  });

  it("accepts an export only when both TTS profile and narration match", () => {
    expect(
      isArticleAudioExportCompatible(
        {
          narrationHash: "current-narration",
          ttsCacheKey: "current-profile",
        },
        "current-profile",
        "current-narration",
      ),
    ).toBe(true);
  });
});

describe("isRequestedTtsMetadataValid", () => {
  const metadata = (() => {
    const profile = {
      provider: "edge" as const,
      model: "edge-tts",
      voiceId: "en-US-AriaNeural",
      promptVersion: "edge-default",
      ttsNormVersion: TTS_NORM_VERSION,
    };
    return {
      ...profile,
      ttsCacheKey: buildTtsCacheKey(profile),
    } satisfies TtsMetadata;
  })();

  it("accepts a complete profile supplied by the initiating server", () => {
    expect(isRequestedTtsMetadataValid(metadata)).toBe(true);
  });

  it("rejects a profile whose cache identity does not match its fields", () => {
    expect(
      isRequestedTtsMetadataValid({
        ...metadata,
        voiceId: "en-US-GuyNeural",
      }),
    ).toBe(false);
  });

  it("replaces a stale stored profile with the worker's current identity", () => {
    const resolved = resolveRequestedArticleExportTtsMetadata({
      ...metadata,
      ttsNormVersion: STALE_TTS_NORM_VERSION,
      ttsCacheKey: buildTtsCacheKey({
        ...metadata,
        ttsNormVersion: STALE_TTS_NORM_VERSION,
      }),
    });

    expect(isRequestedTtsMetadataValid(resolved)).toBe(true);
    expect(resolved.ttsNormVersion).toBe(TTS_NORM_VERSION);
    expect(resolved.ttsCacheKey).not.toContain(STALE_TTS_NORM_VERSION);
  });
});

describe("getRecentArticleAudioExports", () => {
  it.each([
    { input: undefined, expected: 4 },
    { input: 1.9, expected: 1 },
    { input: 4.9, expected: 4 },
    { input: 10.9, expected: 10 },
    { input: Number.NaN, expected: 4 },
    { input: Number.POSITIVE_INFINITY, expected: 4 },
    { input: Number.NEGATIVE_INFINITY, expected: 4 },
    { input: 0, expected: 1 },
    { input: -5, expected: 1 },
    { input: 11, expected: 10 },
  ])(
    "normalizes $input to an integer limit of $expected",
    ({ input, expected }) => {
      expect(normalizeRecentArticleAudioExportLimit(input)).toBe(expected);
    },
  );

  it("bounds candidates, skips dismissed reads, and stops once the compatible limit is filled", async () => {
    const currentArticle = {
      _id: "article-current",
      title: "Current article",
      summary: "Current narration source.",
      sections: [],
    };
    const currentNarrationHash = buildArticleNarrationHash(
      currentArticle as never,
    );
    const records = [
      {
        _id: "dismissed-export",
        articleId: "article-dismissed",
        clientId: "client-1",
        title: "Dismissed",
        status: "ready",
        sectionCount: 1,
        completedSectionCount: 1,
        narrationHash: currentNarrationHash,
        ttsCacheKey: "current-tts",
        dismissedAt: 10,
        createdAt: 1,
        updatedAt: 4,
      },
      {
        _id: "incompatible-export",
        articleId: "article-old",
        clientId: "client-1",
        title: "Old",
        status: "ready",
        sectionCount: 1,
        completedSectionCount: 1,
        narrationHash: "old-narration",
        ttsCacheKey: "current-tts",
        createdAt: 1,
        updatedAt: 3,
      },
      {
        _id: "current-export",
        articleId: "article-current",
        clientId: "client-1",
        title: "Current",
        status: "ready",
        sectionCount: 1,
        completedSectionCount: 1,
        narrationHash: currentNarrationHash,
        ttsCacheKey: "current-tts",
        createdAt: 1,
        updatedAt: 2,
      },
      {
        _id: "after-limit-export",
        articleId: "article-after-limit",
        clientId: "client-1",
        title: "After limit",
        status: "ready",
        sectionCount: 1,
        completedSectionCount: 1,
        narrationHash: currentNarrationHash,
        ttsCacheKey: "current-tts",
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    const take = vi.fn(async () => records);
    const query = vi.fn(() => {
      const chain = {
        withIndex: vi.fn(() => chain),
        filter: vi.fn(() => chain),
        order: vi.fn(() => chain),
        take,
      };
      return chain;
    });
    const get = vi.fn(async (id: string) => {
      if (id === "article-old") return currentArticle;
      if (id === "article-current") return currentArticle;
      throw new Error(`Unexpected article read: ${id}`);
    });
    const handler = (
      getRecentArticleAudioExports as unknown as {
        _handler: (
          ctx: unknown,
          args: unknown,
        ) => Promise<Array<{ _id: string }>>;
      }
    )._handler;

    const result = await handler(
      {
        db: { query, get },
        auth: {
          getUserIdentity: vi.fn(async () => ({
            tokenIdentifier: "https://clerk.example|user-a",
          })),
        },
        storage: { getUrl: vi.fn() },
      },
      { clientId: "client-1", limit: 1.5, ttsCacheKey: "current-tts" },
    );

    expect(result.map((record) => record._id)).toEqual(["current-export"]);
    expect(take).toHaveBeenCalledOnce();
    expect(take).toHaveBeenCalledWith(MAX_RECENT_EXPORT_CANDIDATES);
    expect(get).not.toHaveBeenCalledWith("article-dismissed");
    expect(get).not.toHaveBeenCalledWith("article-after-limit");
  });
});

describe("getArticleAudioExportDownloadIdentity", () => {
  it("returns null for a malformed Convex ID without reading the database", async () => {
    const normalizeId = vi.fn(() => null);
    const get = vi.fn();
    const handler = (
      getArticleAudioExportDownloadIdentity as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(
        { db: { normalizeId, get } },
        { exportId: "definitely-not-a-convex-id" },
      ),
    ).resolves.toBeNull();

    expect(normalizeId).toHaveBeenCalledWith(
      "articleAudioExports",
      "definitely-not-a-convex-id",
    );
    expect(get).not.toHaveBeenCalled();
  });
});

describe("article audio export voice entitlement", () => {
  it("selects Edge for guests and OpenAI for authenticated viewers", () => {
    expect(getArticleAudioExportProvider(false)).toBe("edge");
    expect(getArticleAudioExportProvider(true)).toBe("openai");
  });

  it("keeps guest Edge exports public", () => {
    expect(
      canAccessArticleAudioExport(
        { ttsProvider: "edge", ttsCacheKey: "tts:edge:profile" },
        null,
      ),
    ).toBe(true);
  });

  it("requires the owning identity for new OpenAI exports", () => {
    const record = {
      ttsProvider: "openai",
      ttsCacheKey: "tts:openai:profile",
      ownerTokenIdentifier: "https://clerk.example|user-a",
    };

    expect(canAccessArticleAudioExport(record, null)).toBe(false);
    expect(
      canAccessArticleAudioExport(record, "https://clerk.example|user-b"),
    ).toBe(false);
    expect(
      canAccessArticleAudioExport(record, "https://clerk.example|user-a"),
    ).toBe(true);
  });

  it("keeps legacy exports available only to signed-in viewers", () => {
    const legacyRecord = {
      ttsCacheKey:
        "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
    };

    expect(canAccessArticleAudioExport(legacyRecord, null)).toBe(false);
    expect(
      canAccessArticleAudioExport(
        legacyRecord,
        "https://clerk.example|signed-in-user",
      ),
    ).toBe(true);
  });

  it("filters ownership before capping recent jobs after an account switch", () => {
    const previousAccountJobs = Array.from({ length: 50 }, (_, index) => ({
      _id: `previous-${index}`,
      ttsProvider: "openai",
      ownerTokenIdentifier: "https://clerk.example|previous-user",
      updatedAt: 1_000 - index,
    }));
    const currentAccountJob = {
      _id: "current-user-job",
      ttsProvider: "openai",
      ownerTokenIdentifier: "https://clerk.example|current-user",
      updatedAt: 1,
    };

    expect(
      selectAccessibleArticleAudioExportCandidates(
        [...previousAccountJobs, currentAccountJob],
        "https://clerk.example|current-user",
        50,
      ).map((record) => record._id),
    ).toEqual(["current-user-job"]);
  });
});

describe("article audio export queue isolation", () => {
  it("serializes authenticated OpenAI exports by owner across client IDs", () => {
    expect(
      getArticleAudioExportQueueKey({
        clientId: "browser-a",
        ttsProvider: "openai",
        ownerTokenIdentifier: "https://clerk.example|user-a",
      }),
    ).toBe("owner:https://clerk.example|user-a");
    expect(
      getArticleAudioExportQueueKey({
        clientId: "browser-b",
        ttsProvider: "openai",
        ownerTokenIdentifier: "https://clerk.example|user-a",
      }),
    ).toBe("owner:https://clerk.example|user-a");
  });

  it("keeps guest and legacy exports isolated by client ID", () => {
    expect(
      getArticleAudioExportQueueKey({
        clientId: "guest-a",
        ttsProvider: "edge",
      }),
    ).toBe("client:guest-a");
    expect(
      getArticleAudioExportQueueKey({
        clientId: "legacy-a",
      }),
    ).toBe("client:legacy-a");
  });

  it("does not treat an ownerless OpenAI legacy row as a shared owner queue", () => {
    expect(
      getArticleAudioExportQueueKey({
        clientId: "legacy-openai",
        ttsProvider: "openai",
      }),
    ).toBe("client:legacy-openai");
  });

  it("ignores a legacy caller-provided generation origin", () => {
    expect(
      resolveArticleAudioExportBaseUrl(
        "https://trusted.example",
        "https://attacker.example",
      ),
    ).toBe("https://trusted.example");
  });
});

describe("article audio export OpenAI allowance", () => {
  const dayMs = 24 * 60 * 60 * 1000;

  it("starts a fresh 24-hour allowance window", () => {
    expect(
      evaluateArticleAudioExportAllowance({
        existing: null,
        now: 1_000,
        limit: 5,
        windowMs: dayMs,
      }),
    ).toEqual({
      allowed: true,
      nextCount: 1,
      windowStart: 1_000,
      expiresAt: 1_000 + dayMs,
      remaining: 4,
    });
  });

  it("allows work below the limit without shifting the existing window", () => {
    expect(
      evaluateArticleAudioExportAllowance({
        existing: {
          count: 3,
          windowStart: 500,
          expiresAt: 500 + dayMs,
        },
        now: 2_000,
        limit: 5,
        windowMs: dayMs,
      }),
    ).toEqual({
      allowed: true,
      nextCount: 4,
      windowStart: 500,
      expiresAt: 500 + dayMs,
      remaining: 1,
    });
  });

  it("rejects work at the limit without incrementing it", () => {
    expect(
      evaluateArticleAudioExportAllowance({
        existing: {
          count: 5,
          windowStart: 500,
          expiresAt: 500 + dayMs,
        },
        now: 2_000,
        limit: 5,
        windowMs: dayMs,
      }),
    ).toEqual({
      allowed: false,
      nextCount: 5,
      windowStart: 500,
      expiresAt: 500 + dayMs,
      remaining: 0,
    });
  });

  it("resets an expired allowance window", () => {
    expect(
      evaluateArticleAudioExportAllowance({
        existing: {
          count: 5,
          windowStart: 500,
          expiresAt: 1_500,
        },
        now: 2_000,
        limit: 5,
        windowMs: dayMs,
      }),
    ).toEqual({
      allowed: true,
      nextCount: 1,
      windowStart: 2_000,
      expiresAt: 2_000 + dayMs,
      remaining: 4,
    });
  });

  it("uses conservative defaults and accepts positive configuration", () => {
    expect(getArticleAudioExportQuotaConfig({})).toEqual({
      dailyLimit: 5,
      dailyWindowMs: dayMs,
    });
    expect(
      getArticleAudioExportQuotaConfig({
        ARTICLE_AUDIO_EXPORT_OPENAI_DAILY_LIMIT: "9",
        ARTICLE_AUDIO_EXPORT_OPENAI_DAILY_WINDOW_MS: "7200000",
      }),
    ).toEqual({
      dailyLimit: 9,
      dailyWindowMs: 7_200_000,
    });
    expect(
      getArticleAudioExportQuotaConfig({
        ARTICLE_AUDIO_EXPORT_OPENAI_DAILY_LIMIT: "0",
        ARTICLE_AUDIO_EXPORT_OPENAI_DAILY_WINDOW_MS: "not-a-number",
      }),
    ).toEqual({
      dailyLimit: 5,
      dailyWindowMs: dayMs,
    });
  });
});
