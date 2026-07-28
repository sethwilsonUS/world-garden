import { afterEach, describe, expect, it, vi } from "vitest";

const workerMocks = vi.hoisted(() => ({
  assembleArticleAudio: vi.fn(),
  uploadStreamToConvexStorage: vi.fn(),
}));

vi.mock("./lib/articleAudioPipeline", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/articleAudioPipeline")>()),
  assembleArticleAudio: workerMocks.assembleArticleAudio,
}));

vi.mock("./lib/storageUpload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./lib/storageUpload")>()),
  uploadStreamToConvexStorage: workerMocks.uploadStreamToConvexStorage,
}));

import {
  completeArticleAudioExport,
  discardArticleAudioExportUpload,
  dismissArticleAudioExport,
  evaluateArticleAudioExportAllowance,
  canAccessArticleAudioExport,
  failArticleAudioExport,
  findReusableArticleAudioExport,
  getArticleAudioExportById,
  getArticleAudioExportDownloadIdentity,
  getArticleAudioExportForServer,
  getNextQueuedArticleAudioExportForQueue,
  getRecentArticleAudioExports,
  isArticleAudioExportCompatible,
  isArticleAudioExportReusable,
  isRequestedTtsMetadataValid,
  markArticleAudioExportRunning,
  MAX_RECENT_EXPORT_CANDIDATES,
  normalizeRecentArticleAudioExportLimit,
  processArticleAudioExport,
  registerArticleAudioExportUpload,
  resolveRequestedArticleExportTtsMetadata,
  startArticleAudioExport,
  updateArticleAudioExportProgress,
  getArticleAudioExportQueueKey,
  getArticleAudioExportQuotaConfig,
  getArticleAudioExportProvider,
  getArticleExportSections,
  resolveArticleAudioExportBaseUrl,
  selectAccessibleArticleAudioExportCandidates,
} from "./articleExports";
import { ACCOUNT_DELETION_IN_PROGRESS } from "./lib/accountDeletionState";
import {
  buildTtsCacheKey,
  getTtsMetadata,
  getTtsProfile,
  type TtsMetadata,
} from "../lib/tts-profile";
import { TTS_NORM_VERSION } from "../lib/tts-normalize";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  buildArticleNarrationHash,
  buildArticleNarrationTracks,
} from "../lib/section-narration";
import { createTestSection } from "../lib/test-section-narration";
import { createArticleAudioExportReadAttestation } from "../lib/article-audio-export-attestation";

const STALE_TTS_NORM_VERSION = `${TTS_NORM_VERSION}:stale`;
const ARTICLE_EXPORT_LEASE_MS = 10 * 60 * 1000;
const ARTICLE_EXPORT_WATCHDOG_GRACE_MS = 1_000;

const createAccountDeletionQueryChain = (
  deletingViewerTokenIdentifiers: string[] = [],
) => ({
  withIndex: (
    _indexName: string,
    build: (query: {
      eq: (field: string, value: string) => unknown;
    }) => unknown,
  ) => {
    let viewerTokenIdentifier = "";
    const query = {
      eq: (_field: string, value: string) => {
        viewerTokenIdentifier = value;
        return query;
      },
    };
    build(query);
    return {
      first: async () =>
        deletingViewerTokenIdentifiers.includes(viewerTokenIdentifier)
          ? { _id: "deletion-1", viewerTokenIdentifier }
          : null,
    };
  },
});

const createOwnedStorageQueryChain = (
  ledgers: Array<Record<string, unknown>> = [],
) => ({
  withIndex: (
    _indexName: string,
    build: (query: {
      eq: (field: string, value: string) => unknown;
    }) => unknown,
  ) => {
    const query = {
      eq: (field: string, value: string) => {
        void field;
        void value;
        return query;
      },
    };
    build(query);
    return { collect: async () => ledgers };
  },
});

const createEmptyOwnedStorageQueryChain = () => createOwnedStorageQueryChain();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  workerMocks.assembleArticleAudio.mockReset();
  workerMocks.uploadStreamToConvexStorage.mockReset();
});

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

  it("retains valid stored metadata only when it matches the resolved provider", () => {
    const edgeMetadata = getTtsMetadata(getTtsProfile("edge"));

    expect(resolveRequestedArticleExportTtsMetadata(edgeMetadata, "edge")).toBe(
      edgeMetadata,
    );
    expect(
      resolveRequestedArticleExportTtsMetadata(edgeMetadata, "openai"),
    ).toEqual(getTtsMetadata(getTtsProfile("openai")));
  });
});

describe("startArticleAudioExport provider expectation", () => {
  it.each([
    {
      expectedTtsProvider: "openai" as const,
      identity: null,
    },
    {
      expectedTtsProvider: "edge" as const,
      identity: { tokenIdentifier: "https://clerk.example|user-a" },
    },
  ])(
    "rejects an $expectedTtsProvider request when current auth resolves differently",
    async ({ expectedTtsProvider, identity }) => {
      const collect = vi.fn(async () => []);
      const query = vi.fn((tableName: string) => {
        if (tableName === "accountDeletionRequests") {
          return createAccountDeletionQueryChain();
        }
        const chain = {
          withIndex: vi.fn(() => chain),
          collect,
        };
        return chain;
      });
      const insert = vi.fn(async () => "export-1");
      const handler = (
        startArticleAudioExport as unknown as {
          _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
        }
      )._handler;

      await expect(
        handler(
          {
            db: {
              get: vi.fn(async () => ({
                _id: "article-1",
                title: "A quiet article",
                slug: "a-quiet-article",
                sections: [],
              })),
              query,
              insert,
            },
            auth: { getUserIdentity: vi.fn(async () => identity) },
            scheduler: { runAfter: vi.fn() },
          },
          {
            clientId: "client-1",
            articleId: "article-1",
            expectedTtsProvider,
          },
        ),
      ).rejects.toThrow(/voice access changed/i);

      if (identity) {
        expect(query).toHaveBeenCalledOnce();
        expect(query).toHaveBeenCalledWith("accountDeletionRequests");
      } else {
        expect(query).not.toHaveBeenCalled();
      }
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it.each([
    { status: "queued", leaseExpiresAt: undefined },
    { status: "running", leaseExpiresAt: undefined },
    { status: "running", leaseExpiresAt: 9_999 },
  ])(
    "reschedules a reusable $status export when its lease is absent or stale",
    async ({ status, leaseExpiresAt }) => {
      vi.spyOn(Date, "now").mockReturnValue(10_000);
      const article = {
        _id: "article-1",
        title: "A quiet article",
        slug: "a-quiet-article",
        summary: "Enough narration to make this export reusable.",
        sections: [],
      };
      const metadata = getTtsMetadata(getTtsProfile("edge"));
      const existing = {
        _id: "export-1",
        clientId: "client-1",
        articleId: article._id,
        title: article.title,
        slug: article.slug,
        status,
        sectionCount: 1,
        completedSectionCount: 0,
        narrationHash: buildArticleNarrationHash(article as never),
        requestedTtsMetadata: metadata,
        ttsCacheKey: metadata.ttsCacheKey,
        ttsProvider: "edge",
        queueKey: "client:client-1",
        leaseExpiresAt,
        createdAt: 1,
        updatedAt: 2,
      };
      const collect = vi.fn(async () => [existing]);
      const query = vi.fn(() => {
        const chain = {
          withIndex: vi.fn(() => chain),
          collect,
        };
        return chain;
      });
      const insert = vi.fn();
      const runAfter = vi.fn();
      const handler = (
        startArticleAudioExport as unknown as {
          _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
        }
      )._handler;

      await expect(
        handler(
          {
            db: {
              get: vi.fn(async () => article),
              query,
              insert,
            },
            auth: { getUserIdentity: vi.fn(async () => null) },
            scheduler: { runAfter },
          },
          {
            clientId: "client-1",
            articleId: article._id,
            expectedTtsProvider: "edge",
          },
        ),
      ).resolves.toEqual({
        exportId: "export-1",
        status,
        ttsProvider: "edge",
        reused: true,
      });

      expect(runAfter).toHaveBeenCalledOnce();
      expect(runAfter.mock.calls[0]?.[0]).toBe(0);
      expect(runAfter.mock.calls[0]?.[2]).toEqual({ exportId: "export-1" });
      expect(insert).not.toHaveBeenCalled();
    },
  );
});

describe("article audio export account deletion barriers", () => {
  const viewerTokenIdentifier = "https://clerk.example|deleting-user";

  const createDeletingContext = () => {
    const get = vi.fn();
    const patch = vi.fn();
    const query = vi.fn((tableName: string) => {
      expect(tableName).toBe("accountDeletionRequests");
      return createAccountDeletionQueryChain([viewerTokenIdentifier]);
    });
    return {
      ctx: {
        db: { get, patch, query },
        auth: {
          getUserIdentity: vi.fn(async () => ({
            tokenIdentifier: viewerTokenIdentifier,
          })),
        },
        storage: { getUrl: vi.fn() },
      },
      get,
      patch,
      query,
    };
  };

  it("blocks signed-in reads before touching export data", async () => {
    const { ctx, get, query } = createDeletingContext();
    const handler = (
      getArticleAudioExportById as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, {
        exportId: "export-1",
        ttsCacheKey: "tts:openai:profile",
      }),
    ).rejects.toThrow(ACCOUNT_DELETION_IN_PROGRESS);

    expect(query).toHaveBeenCalledOnce();
    expect(get).not.toHaveBeenCalled();
  });

  it("blocks signed-in public mutations before touching export data", async () => {
    const { ctx, get, patch } = createDeletingContext();
    const handler = (
      dismissArticleAudioExport as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(ctx, { exportId: "export-1", clientId: "client-1" }),
    ).rejects.toThrow(ACCOUNT_DELETION_IN_PROGRESS);

    expect(get).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("keeps the guest Edge dismissal path usable without a tombstone read", async () => {
    const patch = vi.fn();
    const query = vi.fn();
    const handler = (
      dismissArticleAudioExport as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(
        {
          db: {
            get: vi.fn(async () => ({
              _id: "export-1",
              clientId: "client-1",
              ttsProvider: "edge",
            })),
            patch,
            query,
          },
          auth: { getUserIdentity: vi.fn(async () => null) },
        },
        { exportId: "export-1", clientId: "client-1" },
      ),
    ).resolves.toEqual({ dismissed: true });

    expect(query).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledOnce();
  });
});

describe("article audio export worker leases", () => {
  const now = 1_000_000;
  const edgeMetadata = getTtsMetadata(getTtsProfile("edge"));

  const getHandler = (registeredFunction: unknown) =>
    (
      registeredFunction as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

  const createClaimContext = ({
    record,
    queueRecords = [],
    legacyRecords = [],
  }: {
    record: Record<string, unknown>;
    queueRecords?: Array<Record<string, unknown>>;
    legacyRecords?: Array<Record<string, unknown>>;
  }) => {
    const collections = [queueRecords, legacyRecords];
    const query = vi.fn(() => {
      const records = collections.shift() ?? [];
      const chain = {
        withIndex: vi.fn(() => chain),
        filter: vi.fn(() => chain),
        order: vi.fn(() => chain),
        take: vi.fn(async () => records),
      };
      return chain;
    });
    const patch = vi.fn();
    const runAfter = vi.fn();
    return {
      ctx: {
        db: {
          get: vi.fn(async () => record),
          query,
          patch,
        },
        scheduler: { runAfter },
      },
      patch,
      query,
      runAfter,
    };
  };

  const queuedRecord = {
    _id: "export-1",
    clientId: "client-1",
    queueKey: "client:client-1",
    ttsProvider: "edge",
    status: "queued",
    sectionCount: 1,
    completedSectionCount: 0,
    createdAt: 1,
    updatedAt: 1,
  };

  const runCombinedUploadLifecycle = async ({
    registration = "registered",
    completion,
  }: {
    registration?: "registered" | "rejected" | "throw";
    completion: "false" | "throw" | "commit-then-throw";
  }) => {
    const viewerTokenIdentifier = "https://clerk.example|upload-owner";
    const metadata = getTtsMetadata(getTtsProfile("openai"));
    let currentRecord: Record<string, unknown> = {
      ...queuedRecord,
      articleId: "article-1",
      slug: "upload-lifecycle",
      status: "queued",
      ttsProvider: "openai",
      ownerTokenIdentifier: viewerTokenIdentifier,
      queueKey: `owner:${viewerTokenIdentifier}`,
      requestedTtsMetadata: metadata,
    };
    const article = {
      _id: "article-1",
      title: "Upload lifecycle",
      slug: "upload-lifecycle",
      summary: "A narrated summary for the upload lifecycle test.",
      sections: [],
    };
    const deleteStorage = vi.fn();
    const db = {
      get: vi.fn(async () => currentRecord),
      query: vi.fn((tableName: string) => {
        if (tableName === "accountOwnedStorage") {
          return createEmptyOwnedStorageQueryChain();
        }
        if (tableName === "accountDeletionRequests") {
          return createAccountDeletionQueryChain();
        }
        throw new Error(`Unexpected table: ${tableName}`);
      }),
      delete: vi.fn(),
    };
    const discardArgs: Array<Record<string, unknown>> = [];
    const failureArgs: Array<Record<string, unknown>> = [];
    let nextQueueLookups = 0;
    const discardHandler = getHandler(discardArticleAudioExportUpload);
    const runQuery = vi.fn(async (_reference: unknown, args: object) => {
      if ("articleId" in args) return article;
      if ("queueKey" in args) {
        nextQueueLookups += 1;
        return null;
      }
      if ("exportId" in args) return currentRecord;
      throw new Error("Unexpected article export worker query.");
    });
    const runMutation = vi.fn(
      async (_reference: unknown, args: Record<string, unknown>) => {
        if ("sectionCount" in args) {
          currentRecord = {
            ...currentRecord,
            status: "running",
            leaseOwner: args.owner,
            leaseExpiresAt: now + ARTICLE_EXPORT_LEASE_MS,
          };
          return { claimed: true };
        }
        if (Object.keys(args).length === 0) return "upload-url";
        if ("lastError" in args) {
          failureArgs.push(args);
          return { failed: false };
        }
        if ("byteLength" in args) {
          if (completion === "false") return { completed: false };
          if (completion === "commit-then-throw") {
            currentRecord = {
              ...currentRecord,
              status: "ready",
              storageId: args.storageId,
              leaseOwner: undefined,
              leaseExpiresAt: undefined,
            };
          }
          throw new Error("Completion response was unavailable.");
        }
        if ("owner" in args) {
          if (registration === "throw") {
            throw new Error("Registration response was unavailable.");
          }
          if (registration === "rejected") {
            return { registered: false };
          }
          return { registered: true };
        }
        if ("storageId" in args) {
          discardArgs.push(args);
          return await discardHandler(
            {
              db,
              storage: { delete: deleteStorage },
            },
            args,
          );
        }
        throw new Error("Unexpected article export worker mutation.");
      },
    );

    workerMocks.uploadStreamToConvexStorage.mockResolvedValue({
      storageId: "combined-storage",
      byteLength: 123,
    });
    workerMocks.assembleArticleAudio.mockImplementation(
      async (options: {
        saveCombinedAudio(args: {
          stream: ReadableStream<Uint8Array>;
          contentType: string;
        }): Promise<{ storageId: string; byteLength: number }>;
      }) => {
        const upload = await options.saveCombinedAudio({
          stream: new ReadableStream<Uint8Array>(),
          contentType: "audio/mpeg",
        });
        return {
          ...upload,
          metadata,
          narrationHash: "narration-1",
        };
      },
    );

    await getHandler(processArticleAudioExport)(
      {
        runQuery,
        runMutation,
        scheduler: { runAfter: vi.fn() },
        storage: { getUrl: vi.fn() },
      },
      { exportId: "export-1" },
    );

    return {
      deleteStorage,
      discardArgs,
      failureArgs,
      getCurrentRecord: () => currentRecord,
      getNextQueueLookups: () => nextQueueLookups,
    };
  };

  it("reclaims the same running export after its worker lease expires", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { ctx, patch, runAfter } = createClaimContext({
      record: {
        ...queuedRecord,
        status: "running",
        leaseOwner: "dead-worker",
        leaseExpiresAt: now - 1,
      },
    });

    await expect(
      getHandler(markArticleAudioExportRunning)(ctx, {
        exportId: "export-1",
        owner: "replacement-worker",
        sectionCount: 2,
        ttsMetadata: edgeMetadata,
      }),
    ).resolves.toEqual({ claimed: true });

    expect(patch).toHaveBeenCalledWith(
      "export-1",
      expect.objectContaining({
        status: "running",
        leaseOwner: "replacement-worker",
        leaseExpiresAt: now + ARTICLE_EXPORT_LEASE_MS,
      }),
    );
    expect(runAfter).toHaveBeenCalledWith(
      ARTICLE_EXPORT_LEASE_MS + ARTICLE_EXPORT_WATCHDOG_GRACE_MS,
      expect.anything(),
      { exportId: "export-1" },
    );
  });

  it("leaves an active worker alone and schedules a retry at lease expiry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const leaseExpiresAt = now + 5_000;
    const { ctx, patch, query, runAfter } = createClaimContext({
      record: {
        ...queuedRecord,
        status: "running",
        leaseOwner: "active-worker",
        leaseExpiresAt,
      },
    });

    await expect(
      getHandler(markArticleAudioExportRunning)(ctx, {
        exportId: "export-1",
        owner: "second-worker",
        sectionCount: 2,
        ttsMetadata: edgeMetadata,
      }),
    ).resolves.toEqual({ claimed: false });

    expect(patch).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledWith(
      5_000 + ARTICLE_EXPORT_WATCHDOG_GRACE_MS,
      expect.anything(),
      { exportId: "export-1" },
    );
  });

  it("ignores an expired sibling lease when claiming queued work", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const { ctx, patch } = createClaimContext({
      record: queuedRecord,
      queueRecords: [
        {
          ...queuedRecord,
          _id: "stale-sibling",
          status: "running",
          leaseOwner: "dead-worker",
          leaseExpiresAt: now - 1,
        },
      ],
    });

    await expect(
      getHandler(markArticleAudioExportRunning)(ctx, {
        exportId: "export-1",
        owner: "new-worker",
        sectionCount: 2,
        ttsMetadata: edgeMetadata,
      }),
    ).resolves.toEqual({ claimed: true });

    expect(patch).toHaveBeenCalledWith(
      "export-1",
      expect.objectContaining({ leaseOwner: "new-worker" }),
    );
  });

  it("honors an active sibling lease and retries when that lease expires", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const leaseExpiresAt = now + 5_000;
    const { ctx, patch, runAfter } = createClaimContext({
      record: queuedRecord,
      queueRecords: [
        {
          ...queuedRecord,
          _id: "active-sibling",
          status: "running",
          leaseOwner: "active-worker",
          leaseExpiresAt,
        },
      ],
    });

    await expect(
      getHandler(markArticleAudioExportRunning)(ctx, {
        exportId: "export-1",
        owner: "new-worker",
        sectionCount: 2,
        ttsMetadata: edgeMetadata,
      }),
    ).resolves.toEqual({ claimed: false });

    expect(patch).not.toHaveBeenCalled();
    expect(runAfter).toHaveBeenCalledWith(
      5_000 + ARTICLE_EXPORT_WATCHDOG_GRACE_MS,
      expect.anything(),
      { exportId: "export-1" },
    );
  });

  it("takes one indexed running sibling and bounds the legacy lock fallback", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const activeSibling = {
      ...queuedRecord,
      _id: "active-sibling",
      status: "running",
      leaseOwner: "active-worker",
      leaseExpiresAt: now + 5_000,
    };
    const indexedTake = vi.fn(async () => [activeSibling]);
    const legacyTake = vi.fn(async () => []);
    const indexedWithIndex = vi.fn();
    const legacyWithIndex = vi.fn();
    const query = vi
      .fn()
      .mockImplementationOnce(() => {
        const chain = {
          withIndex: indexedWithIndex,
          filter: vi.fn(() => chain),
          order: vi.fn(() => chain),
          take: indexedTake,
        };
        indexedWithIndex.mockReturnValue(chain);
        return chain;
      })
      .mockImplementationOnce(() => {
        const chain = {
          withIndex: legacyWithIndex,
          filter: vi.fn(() => chain),
          order: vi.fn(() => chain),
          take: legacyTake,
        };
        legacyWithIndex.mockReturnValue(chain);
        return chain;
      });
    const runAfter = vi.fn();

    await expect(
      getHandler(markArticleAudioExportRunning)(
        {
          db: {
            get: vi.fn(async () => queuedRecord),
            query,
            patch: vi.fn(),
          },
          scheduler: { runAfter },
        },
        {
          exportId: "export-1",
          owner: "new-worker",
          sectionCount: 2,
          ttsMetadata: edgeMetadata,
        },
      ),
    ).resolves.toEqual({ claimed: false });

    expect(indexedWithIndex).toHaveBeenCalledWith(
      "by_queueKey_status",
      expect.any(Function),
    );
    expect(indexedTake).toHaveBeenCalledWith(1);
    expect(legacyWithIndex).toHaveBeenCalledWith(
      "by_clientId",
      expect.any(Function),
    );
    expect(legacyTake).toHaveBeenCalledWith(MAX_RECENT_EXPORT_CANDIDATES);
  });

  it("renews progress only for the current lease owner", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const patch = vi.fn();
    const handler = getHandler(updateArticleAudioExportProgress);

    await expect(
      handler(
        {
          db: {
            get: vi.fn(async () => ({
              ...queuedRecord,
              status: "running",
              leaseOwner: "current-worker",
              leaseExpiresAt: now + 1,
            })),
            patch,
          },
        },
        {
          exportId: "export-1",
          owner: "current-worker",
          completedSectionCount: 1,
          stage: "packaging",
        },
      ),
    ).resolves.toEqual({ updated: true });

    expect(patch).toHaveBeenCalledWith(
      "export-1",
      expect.objectContaining({
        completedSectionCount: 1,
        leaseExpiresAt: now + ARTICLE_EXPORT_LEASE_MS,
      }),
    );
  });

  it("refuses owned claim, progress, and failure work after deletion begins", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const viewerTokenIdentifier = "https://clerk.example|deleting-user";
    const record = {
      ...queuedRecord,
      ttsProvider: "openai",
      ownerTokenIdentifier: viewerTokenIdentifier,
      queueKey: `owner:${viewerTokenIdentifier}`,
      status: "running",
      leaseOwner: "current-worker",
      leaseExpiresAt: now + ARTICLE_EXPORT_LEASE_MS,
    };
    const patch = vi.fn();
    const runAfter = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => record),
        query: vi.fn(() =>
          createAccountDeletionQueryChain([viewerTokenIdentifier]),
        ),
        patch,
      },
      scheduler: { runAfter },
    };

    await expect(
      getHandler(markArticleAudioExportRunning)(ctx, {
        exportId: "export-1",
        owner: "current-worker",
        sectionCount: 1,
        ttsMetadata: getTtsMetadata(getTtsProfile("openai")),
      }),
    ).resolves.toEqual({ claimed: false });
    await expect(
      getHandler(updateArticleAudioExportProgress)(ctx, {
        exportId: "export-1",
        owner: "current-worker",
        completedSectionCount: 1,
        stage: "packaging",
      }),
    ).resolves.toEqual({ updated: false });
    await expect(
      getHandler(failArticleAudioExport)(ctx, {
        exportId: "export-1",
        owner: "current-worker",
        lastError: "Worker woke after deletion began.",
      }),
    ).resolves.toEqual({ failed: false });

    expect(patch).not.toHaveBeenCalled();
    expect(runAfter).not.toHaveBeenCalled();
  });

  it("rejects progress, completion, and failure from a superseded worker", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const record = {
      ...queuedRecord,
      status: "running",
      leaseOwner: "replacement-worker",
      leaseExpiresAt: now + ARTICLE_EXPORT_LEASE_MS,
    };
    const patch = vi.fn();
    const deleteStorage = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => record),
        query: vi.fn(() => createEmptyOwnedStorageQueryChain()),
        patch,
        delete: vi.fn(),
      },
      storage: { delete: deleteStorage },
    };

    await expect(
      getHandler(updateArticleAudioExportProgress)(ctx, {
        exportId: "export-1",
        owner: "superseded-worker",
        completedSectionCount: 1,
        stage: "rendering_audio",
      }),
    ).resolves.toEqual({ updated: false });
    await expect(
      getHandler(completeArticleAudioExport)(ctx, {
        exportId: "export-1",
        owner: "superseded-worker",
        storageId: "storage-1",
        byteLength: 10,
        producedTtsCacheKey: edgeMetadata.ttsCacheKey,
        narrationHash: "narration-1",
      }),
    ).resolves.toEqual({ completed: false });
    await expect(
      getHandler(failArticleAudioExport)(ctx, {
        exportId: "export-1",
        owner: "superseded-worker",
        lastError: "Old worker failed late.",
      }),
    ).resolves.toEqual({ failed: false });

    expect(patch).not.toHaveBeenCalled();
    expect(deleteStorage).toHaveBeenCalledOnce();
    expect(deleteStorage).toHaveBeenCalledWith("storage-1");
  });

  it("deletes a late completion upload when its account is tombstoned", async () => {
    const viewerTokenIdentifier = "https://clerk.example|deleting-user";
    const patch = vi.fn();
    const insert = vi.fn();
    const deleteLedger = vi.fn();
    const deleteStorage = vi.fn();
    const query = vi.fn((tableName: string) => {
      if (tableName === "accountDeletionRequests") {
        return createAccountDeletionQueryChain([viewerTokenIdentifier]);
      }
      if (tableName === "accountOwnedStorage") {
        return createOwnedStorageQueryChain([
          {
            _id: "late-ledger",
            viewerTokenIdentifier,
            storageId: "late-storage",
          },
        ]);
      }
      throw new Error(`Unexpected table: ${tableName}`);
    });

    await expect(
      getHandler(completeArticleAudioExport)(
        {
          db: {
            get: vi.fn(async () => ({
              ...queuedRecord,
              status: "running",
              ttsProvider: "openai",
              ownerTokenIdentifier: viewerTokenIdentifier,
              leaseOwner: "current-worker",
            })),
            query,
            patch,
            insert,
            delete: deleteLedger,
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "export-1",
          owner: "current-worker",
          storageId: "late-storage",
          byteLength: 10,
          producedTtsCacheKey: "tts-openai",
          narrationHash: "narration-1",
        },
      ),
    ).resolves.toEqual({ completed: false });

    expect(deleteStorage).toHaveBeenCalledOnce();
    expect(deleteStorage).toHaveBeenCalledWith("late-storage");
    expect(deleteLedger).toHaveBeenCalledWith("late-ledger");
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("registers owned combined audio before publishing the export as ready", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const viewerTokenIdentifier = "https://clerk.example|active-user";
    const patch = vi.fn();
    const insert = vi.fn(async () => "ledger-1");
    const deleteStorage = vi.fn();
    const query = vi.fn((tableName: string) => {
      if (tableName === "accountDeletionRequests") {
        return createAccountDeletionQueryChain();
      }
      if (tableName === "accountOwnedStorage") {
        return createEmptyOwnedStorageQueryChain();
      }
      throw new Error(`Unexpected table: ${tableName}`);
    });

    await expect(
      getHandler(completeArticleAudioExport)(
        {
          db: {
            get: vi.fn(async () => ({
              ...queuedRecord,
              status: "running",
              ttsProvider: "openai",
              ownerTokenIdentifier: viewerTokenIdentifier,
              leaseOwner: "current-worker",
              leaseExpiresAt: now + ARTICLE_EXPORT_LEASE_MS,
            })),
            query,
            patch,
            insert,
            delete: vi.fn(),
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "export-1",
          owner: "current-worker",
          storageId: "owned-storage",
          byteLength: 10,
          producedTtsCacheKey: "tts-openai",
          narrationHash: "narration-1",
        },
      ),
    ).resolves.toEqual({ completed: true });

    expect(insert).toHaveBeenCalledWith(
      "accountOwnedStorage",
      expect.objectContaining({
        viewerTokenIdentifier,
        storageId: "owned-storage",
        kind: "article_audio_export",
        parentId: "export-1",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "export-1",
      expect.objectContaining({
        status: "ready",
        storageId: "owned-storage",
      }),
    );
    expect(insert.mock.invocationCallOrder[0]).toBeLessThan(
      patch.mock.invocationCallOrder[0]!,
    );
    expect(deleteStorage).not.toHaveBeenCalled();
  });

  it("deletes an uploaded blob when its export row disappeared", async () => {
    const deleteStorage = vi.fn();
    const patch = vi.fn();

    await expect(
      getHandler(completeArticleAudioExport)(
        {
          db: {
            get: vi.fn(async () => null),
            query: vi.fn(() => createEmptyOwnedStorageQueryChain()),
            patch,
            delete: vi.fn(),
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "missing-export",
          owner: "late-worker",
          storageId: "late-storage",
          byteLength: 10,
          producedTtsCacheKey: "tts-edge",
          narrationHash: "narration-1",
        },
      ),
    ).resolves.toEqual({ completed: false });

    expect(deleteStorage).toHaveBeenCalledWith("late-storage");
    expect(patch).not.toHaveBeenCalled();
  });

  it("uses the expected account owner to remove a registered upload after its export disappeared", async () => {
    const viewerTokenIdentifier = "https://clerk.example|upload-owner";
    const deleteStorage = vi.fn();
    const deleteLedger = vi.fn();

    await expect(
      getHandler(completeArticleAudioExport)(
        {
          db: {
            get: vi.fn(async () => null),
            query: vi.fn(() =>
              createOwnedStorageQueryChain([
                {
                  _id: "late-ledger",
                  viewerTokenIdentifier,
                  storageId: "late-storage",
                },
              ]),
            ),
            patch: vi.fn(),
            delete: deleteLedger,
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "missing-export",
          owner: "late-worker",
          storageId: "late-storage",
          expectedViewerTokenIdentifier: viewerTokenIdentifier,
          byteLength: 10,
          producedTtsCacheKey: "tts-openai",
          narrationHash: "narration-1",
        },
      ),
    ).resolves.toEqual({ completed: false });

    expect(deleteStorage).toHaveBeenCalledWith("late-storage");
    expect(deleteLedger).toHaveBeenCalledWith("late-ledger");
  });

  it("preserves a foreign account upload when the export row disappeared", async () => {
    const deleteStorage = vi.fn();
    const deleteLedger = vi.fn();

    await expect(
      getHandler(completeArticleAudioExport)(
        {
          db: {
            get: vi.fn(async () => null),
            query: vi.fn(() =>
              createOwnedStorageQueryChain([
                {
                  _id: "foreign-ledger",
                  viewerTokenIdentifier:
                    "https://clerk.example|different-account",
                  storageId: "foreign-storage",
                },
              ]),
            ),
            patch: vi.fn(),
            delete: deleteLedger,
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "missing-export",
          owner: "late-worker",
          storageId: "foreign-storage",
          expectedViewerTokenIdentifier:
            "https://clerk.example|original-account",
          byteLength: 10,
          producedTtsCacheKey: "tts-openai",
          narrationHash: "narration-1",
        },
      ),
    ).rejects.toThrow("Storage is owned by another account");

    expect(deleteStorage).not.toHaveBeenCalled();
    expect(deleteLedger).not.toHaveBeenCalled();
  });

  it("treats an exact duplicate completion as idempotent", async () => {
    const patch = vi.fn();
    const storage = { delete: vi.fn() };
    const readyRecord = {
      ...queuedRecord,
      status: "ready",
      storageId: "storage-1",
      byteLength: 10,
      producedTtsCacheKey: edgeMetadata.ttsCacheKey,
      narrationHash: "narration-1",
      completedSectionCount: queuedRecord.sectionCount,
    };

    await expect(
      getHandler(completeArticleAudioExport)(
        {
          db: { get: vi.fn(async () => readyRecord), patch },
          storage,
        },
        {
          exportId: "export-1",
          owner: "original-worker",
          storageId: "storage-1",
          byteLength: 10,
          producedTtsCacheKey: edgeMetadata.ttsCacheKey,
          narrationHash: "narration-1",
        },
      ),
    ).resolves.toEqual({ completed: true });

    expect(patch).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("deletes an immediately registered upload if deletion wins the race", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const viewerTokenIdentifier = "https://clerk.example|deleting-user";
    const deleteStorage = vi.fn();
    const insert = vi.fn();
    const query = vi.fn((tableName: string) => {
      if (tableName === "accountDeletionRequests") {
        return createAccountDeletionQueryChain([viewerTokenIdentifier]);
      }
      if (tableName === "accountOwnedStorage") {
        return createEmptyOwnedStorageQueryChain();
      }
      throw new Error(`Unexpected table: ${tableName}`);
    });

    await expect(
      getHandler(registerArticleAudioExportUpload)(
        {
          db: {
            get: vi.fn(async () => ({
              ...queuedRecord,
              status: "running",
              ownerTokenIdentifier: viewerTokenIdentifier,
              leaseOwner: "current-worker",
              leaseExpiresAt: now + ARTICLE_EXPORT_LEASE_MS,
            })),
            query,
            insert,
            patch: vi.fn(),
            delete: vi.fn(),
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "export-1",
          owner: "current-worker",
          storageId: "late-storage",
        },
      ),
    ).resolves.toEqual({ registered: false });

    expect(deleteStorage).toHaveBeenCalledWith("late-storage");
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects and removes an upload registered after its worker lease expired", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const viewerTokenIdentifier = "https://clerk.example|expired-owner";
    const deleteStorage = vi.fn();
    const deleteLedger = vi.fn();

    await expect(
      getHandler(registerArticleAudioExportUpload)(
        {
          db: {
            get: vi.fn(async () => ({
              ...queuedRecord,
              status: "running",
              leaseOwner: "late-worker",
              leaseExpiresAt: now,
              ownerTokenIdentifier: viewerTokenIdentifier,
            })),
            query: vi.fn(() =>
              createOwnedStorageQueryChain([
                {
                  _id: "expired-ledger",
                  viewerTokenIdentifier,
                  storageId: "expired-upload",
                },
              ]),
            ),
            delete: deleteLedger,
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "export-1",
          owner: "late-worker",
          storageId: "expired-upload",
        },
      ),
    ).resolves.toEqual({ registered: false });

    expect(deleteStorage).toHaveBeenCalledWith("expired-upload");
    expect(deleteLedger).toHaveBeenCalledWith("expired-ledger");
  });

  it("rejects and removes a completion after its matching worker lease expired", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const patch = vi.fn();
    const deleteStorage = vi.fn();

    await expect(
      getHandler(completeArticleAudioExport)(
        {
          db: {
            get: vi.fn(async () => ({
              ...queuedRecord,
              status: "running",
              leaseOwner: "late-worker",
              leaseExpiresAt: now,
            })),
            query: vi.fn(() => createEmptyOwnedStorageQueryChain()),
            patch,
            delete: vi.fn(),
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "export-1",
          owner: "late-worker",
          storageId: "expired-completion",
          byteLength: 10,
          producedTtsCacheKey: edgeMetadata.ttsCacheKey,
          narrationHash: "narration-1",
        },
      ),
    ).resolves.toEqual({ completed: false });

    expect(deleteStorage).toHaveBeenCalledWith("expired-completion");
    expect(patch).not.toHaveBeenCalled();
  });

  it("discards a fresh unattached upload with its expected account owner", async () => {
    const viewerTokenIdentifier = "https://clerk.example|upload-owner";
    const deleteStorage = vi.fn();

    await expect(
      getHandler(discardArticleAudioExportUpload)(
        {
          db: {
            get: vi.fn(async () => ({
              ...queuedRecord,
              ownerTokenIdentifier: viewerTokenIdentifier,
              storageId: "published-storage",
            })),
            query: vi.fn(() => createEmptyOwnedStorageQueryChain()),
            delete: vi.fn(),
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "export-1",
          storageId: "fresh-upload",
          expectedViewerTokenIdentifier: viewerTokenIdentifier,
        },
      ),
    ).resolves.toEqual({ discarded: true, referenced: false });

    expect(deleteStorage).toHaveBeenCalledWith("fresh-upload");
  });

  it("discards an unattached guest Edge upload without inventing an owner", async () => {
    const deleteStorage = vi.fn();

    await expect(
      getHandler(discardArticleAudioExportUpload)(
        {
          db: {
            get: vi.fn(async () => ({
              ...queuedRecord,
              ttsProvider: "edge",
              storageId: undefined,
            })),
            query: vi.fn(() => createEmptyOwnedStorageQueryChain()),
            delete: vi.fn(),
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "export-1",
          storageId: "guest-upload",
        },
      ),
    ).resolves.toEqual({ discarded: true, referenced: false });

    expect(deleteStorage).toHaveBeenCalledWith("guest-upload");
  });

  it("refuses to discard the storage currently published by the export", async () => {
    const deleteStorage = vi.fn();
    const query = vi.fn();

    await expect(
      getHandler(discardArticleAudioExportUpload)(
        {
          db: {
            get: vi.fn(async () => ({
              ...queuedRecord,
              status: "ready",
              storageId: "published-storage",
            })),
            query,
          },
          storage: { delete: deleteStorage },
        },
        {
          exportId: "export-1",
          storageId: "published-storage",
        },
      ),
    ).resolves.toEqual({ discarded: false, referenced: true });

    expect(query).not.toHaveBeenCalled();
    expect(deleteStorage).not.toHaveBeenCalled();
  });

  it("compensates an uploaded combined blob when registration throws", async () => {
    const result = await runCombinedUploadLifecycle({
      registration: "throw",
      completion: "throw",
    });

    expect(result.discardArgs).toEqual([
      {
        exportId: "export-1",
        storageId: "combined-storage",
        expectedViewerTokenIdentifier: "https://clerk.example|upload-owner",
      },
    ]);
    expect(result.deleteStorage).toHaveBeenCalledWith("combined-storage");
  });

  it("does not discard an upload twice when registration already rejected it", async () => {
    const result = await runCombinedUploadLifecycle({
      registration: "rejected",
      completion: "throw",
    });

    expect(result.discardArgs).toEqual([]);
    expect(result.failureArgs).toHaveLength(1);
  });

  it("discards combined audio when completion returns false", async () => {
    const result = await runCombinedUploadLifecycle({ completion: "false" });

    expect(result.discardArgs).toHaveLength(1);
    expect(result.deleteStorage).toHaveBeenCalledWith("combined-storage");
  });

  it("discards combined audio when completion throws", async () => {
    const result = await runCombinedUploadLifecycle({ completion: "throw" });

    expect(result.discardArgs).toHaveLength(1);
    expect(result.deleteStorage).toHaveBeenCalledWith("combined-storage");
  });

  it("preserves a published blob when completion committed but its response was lost", async () => {
    const result = await runCombinedUploadLifecycle({
      completion: "commit-then-throw",
    });

    expect(result.discardArgs).toHaveLength(1);
    expect(result.getCurrentRecord()).toMatchObject({
      status: "ready",
      storageId: "combined-storage",
    });
    expect(result.deleteStorage).not.toHaveBeenCalled();
    expect(result.failureArgs).toEqual([]);
    expect(result.getNextQueueLookups()).toBe(1);
  });

  it("allows a recovery worker to fail a running export after its old lease expires", async () => {
    vi.spyOn(Date, "now").mockReturnValue(now);
    const patch = vi.fn();

    await expect(
      getHandler(failArticleAudioExport)(
        {
          db: {
            get: vi.fn(async () => ({
              ...queuedRecord,
              status: "running",
              leaseOwner: "dead-worker",
              leaseExpiresAt: now - 1,
            })),
            patch,
          },
        },
        {
          exportId: "export-1",
          owner: "recovery-worker",
          lastError: "Article not found.",
        },
      ),
    ).resolves.toEqual({ failed: true });

    expect(patch).toHaveBeenCalledWith(
      "export-1",
      expect.objectContaining({
        status: "failed",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      }),
    );
  });

  it.each([undefined, "future-provider"])(
    "fails a %s provider row without treating it as Edge",
    async (ttsProvider) => {
      const record = {
        _id: "export-1",
        articleId: "article-1",
        clientId: "client-1",
        queueKey: "client:client-1",
        slug: "legacy-article",
        status: "queued",
        ttsProvider,
      };
      const runQuery = vi.fn(async (_reference: unknown, args: object) => {
        if ("exportId" in args) return record;
        if ("articleId" in args) {
          throw new Error("Unsupported providers must not read the article.");
        }
        if ("queueKey" in args) return null;
        throw new Error("Unexpected worker query.");
      });
      const runMutation = vi.fn(async () => ({ failed: true }));
      const handler = (
        processArticleAudioExport as unknown as {
          _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
        }
      )._handler;

      await expect(
        handler(
          {
            runQuery,
            runMutation,
            scheduler: { runAfter: vi.fn() },
          },
          { exportId: "export-1" },
        ),
      ).resolves.toBeUndefined();

      expect(runQuery).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ articleId: "article-1" }),
      );
      expect(runMutation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          exportId: "export-1",
          lastError: "Audio voice provider is missing or unsupported.",
        }),
      );
    },
  );
});

describe("getNextQueuedArticleAudioExportForQueue", () => {
  it("takes one indexed queue row and bounds the legacy client fallback", async () => {
    const queueRecord = {
      _id: "indexed-export",
      clientId: "client-1",
      queueKey: "client:client-1",
      status: "queued",
      createdAt: 20,
    };
    const legacyRecord = {
      _id: "legacy-export",
      clientId: "client-1",
      status: "queued",
      createdAt: 10,
    };
    const indexedTake = vi.fn(async () => [queueRecord]);
    const legacyTake = vi.fn(async () => [legacyRecord]);
    const indexedWithIndex = vi.fn();
    const legacyWithIndex = vi.fn();
    const query = vi
      .fn()
      .mockImplementationOnce(() => {
        const chain = {
          withIndex: indexedWithIndex,
          filter: vi.fn(() => chain),
          order: vi.fn(() => chain),
          take: indexedTake,
        };
        indexedWithIndex.mockReturnValue(chain);
        return chain;
      })
      .mockImplementationOnce(() => {
        const chain = {
          withIndex: legacyWithIndex,
          filter: vi.fn(() => chain),
          order: vi.fn(() => chain),
          take: legacyTake,
        };
        legacyWithIndex.mockReturnValue(chain);
        return chain;
      });
    const handler = (
      getNextQueuedArticleAudioExportForQueue as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(
        { db: { query } },
        {
          queueKey: "client:client-1",
          legacyClientId: "client-1",
        },
      ),
    ).resolves.toEqual(legacyRecord);

    expect(indexedWithIndex).toHaveBeenCalledWith(
      "by_queueKey_status",
      expect.any(Function),
    );
    expect(indexedTake).toHaveBeenCalledWith(1);
    expect(legacyWithIndex).toHaveBeenCalledWith(
      "by_clientId",
      expect.any(Function),
    );
    expect(legacyTake).toHaveBeenCalledWith(MAX_RECENT_EXPORT_CANDIDATES);
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
    ].map((record) => ({ ...record, ttsProvider: "edge" }));
    const take = vi.fn(async () => records);
    const query = vi.fn((tableName: string) => {
      if (tableName === "accountDeletionRequests") {
        return createAccountDeletionQueryChain();
      }
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

  it("returns raw storage only for exact Edge exports", async () => {
    const article = {
      _id: "article-1",
      title: "Mixed voice article",
      summary: "The same narration rendered with several voice providers.",
      sections: [],
    };
    const narrationHash = buildArticleNarrationHash(article as never);
    const baseRecord = {
      articleId: article._id,
      clientId: "client-1",
      title: article.title,
      status: "ready",
      sectionCount: 1,
      completedSectionCount: 1,
      narrationHash,
      createdAt: 1,
    };
    const records = [
      {
        ...baseRecord,
        _id: "openai-export",
        storageId: "storage-openai",
        ttsProvider: "openai",
        ownerTokenIdentifier: "https://clerk.example|user-a",
        updatedAt: 4,
      },
      {
        ...baseRecord,
        _id: "unknown-export",
        storageId: "storage-unknown",
        ttsProvider: "future-provider",
        ownerTokenIdentifier: "https://clerk.example|user-a",
        updatedAt: 3,
      },
      {
        ...baseRecord,
        _id: "legacy-export",
        storageId: "storage-legacy",
        updatedAt: 2,
      },
      {
        ...baseRecord,
        _id: "edge-export",
        storageId: "storage-edge",
        ttsProvider: "edge",
        updatedAt: 1,
      },
    ];
    const take = vi.fn(async () => records);
    const query = vi.fn((tableName: string) => {
      if (tableName === "accountDeletionRequests") {
        return createAccountDeletionQueryChain();
      }
      const chain = {
        withIndex: vi.fn(() => chain),
        filter: vi.fn(() => chain),
        order: vi.fn(() => chain),
        take,
      };
      return chain;
    });
    const getUrl = vi.fn(async (storageId: string) =>
      storageId === "storage-edge"
        ? "https://storage.example/edge.mp3"
        : `https://storage.example/${storageId}.mp3`,
    );
    const handler = (
      getRecentArticleAudioExports as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown[]>;
      }
    )._handler;

    const result = await handler(
      {
        db: { query, get: vi.fn(async () => article) },
        auth: {
          getUserIdentity: vi.fn(async () => ({
            tokenIdentifier: "https://clerk.example|user-a",
          })),
        },
        storage: { getUrl },
      },
      { clientId: "client-1", limit: 4 },
    );

    expect(result).toEqual([
      expect.objectContaining({ _id: "openai-export", audioUrl: null }),
      expect.objectContaining({
        _id: "edge-export",
        storageId: "storage-edge",
        audioUrl: "https://storage.example/edge.mp3",
      }),
    ]);
    expect(result[0]).not.toHaveProperty("storageId");
    expect(getUrl).toHaveBeenCalledOnce();
    expect(getUrl).toHaveBeenCalledWith("storage-edge");
  });
});

describe("getArticleAudioExportById", () => {
  it("redacts protected audio storage from an authenticated owner", async () => {
    const article = {
      _id: "article-1",
      title: "Protected article",
      summary: "A protected narration source.",
      sections: [],
    };
    const ttsCacheKey = "tts:openai:profile:ttsNorm:3";
    const record = {
      _id: "export-1",
      articleId: article._id,
      clientId: "client-1",
      title: article.title,
      status: "ready",
      storageId: "storage-openai",
      narrationHash: buildArticleNarrationHash(article as never),
      ttsCacheKey,
      ttsProvider: "openai",
      ownerTokenIdentifier: "https://clerk.example|user-a",
    };
    const getUrl = vi.fn(async () => "https://storage.example/openai.mp3");
    const handler = (
      getArticleAudioExportById as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    const result = await handler(
      {
        db: {
          get: vi.fn(async (id: string) =>
            id === record._id ? record : article,
          ),
          query: vi.fn(() => createAccountDeletionQueryChain()),
        },
        auth: {
          getUserIdentity: vi.fn(async () => ({
            tokenIdentifier: "https://clerk.example|user-a",
          })),
        },
        storage: { getUrl },
      },
      { exportId: record._id, ttsCacheKey },
    );

    expect(result).toMatchObject({ _id: "export-1", audioUrl: null });
    expect(result).not.toHaveProperty("storageId");
    expect(getUrl).not.toHaveBeenCalled();
  });
});

describe("getArticleAudioExportForServer", () => {
  it("returns a narrow protected URL response to the attested owner", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const article = {
      _id: "article-1",
      title: "Owner-only article",
      summary: "A narration source reserved for its owner.",
      sections: [],
    };
    const ttsCacheKey = "tts:openai:profile:ttsNorm:3";
    const record = {
      _id: "export-1",
      articleId: article._id,
      clientId: "client-1",
      title: article.title,
      status: "ready",
      storageId: "storage-openai",
      narrationHash: buildArticleNarrationHash(article as never),
      ttsCacheKey,
      ttsProvider: "openai",
      ownerTokenIdentifier: "https://clerk.example|user-a",
    };
    const attestation = await createArticleAudioExportReadAttestation({
      exportId: record._id,
      ttsCacheKey,
    });
    const handler = (
      getArticleAudioExportForServer as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(
        {
          db: {
            get: vi.fn(async (id: string) =>
              id === record._id ? record : article,
            ),
            query: vi.fn(() => createAccountDeletionQueryChain()),
          },
          auth: {
            getUserIdentity: vi.fn(async () => ({
              tokenIdentifier: "https://clerk.example|user-a",
            })),
          },
          storage: {
            getUrl: vi.fn(async () => "https://storage.example/protected.mp3"),
          },
        },
        { exportId: record._id, ttsCacheKey, attestation },
      ),
    ).resolves.toEqual({
      _id: "export-1",
      title: "Owner-only article",
      status: "ready",
      ttsProvider: "openai",
      audioUrl: "https://storage.example/protected.mp3",
    });
  });

  it("rejects an attestation whose cache-key payload was tampered with", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const attestation = await createArticleAudioExportReadAttestation({
      exportId: "export-1",
      ttsCacheKey: "tts:openai:profile:ttsNorm:3",
    });
    const get = vi.fn();
    const handler = (
      getArticleAudioExportForServer as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(
        {
          db: { get },
          auth: { getUserIdentity: vi.fn() },
          storage: { getUrl: vi.fn() },
        },
        {
          exportId: "export-1",
          ttsCacheKey: "tts:openai:tampered:ttsNorm:3",
          attestation,
        },
      ),
    ).rejects.toThrow("A valid server attestation is required");
    expect(get).not.toHaveBeenCalled();
  });

  it("withholds protected audio from an attested request without Convex auth", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const ttsCacheKey = "tts:openai:profile:ttsNorm:3";
    const attestation = await createArticleAudioExportReadAttestation({
      exportId: "export-1",
      ttsCacheKey,
    });
    const getUrl = vi.fn();
    const handler = (
      getArticleAudioExportForServer as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(
        {
          db: {
            get: vi.fn(async () => ({
              _id: "export-1",
              articleId: "article-1",
              title: "Protected article",
              status: "ready",
              storageId: "storage-openai",
              ttsCacheKey,
              ttsProvider: "openai",
              ownerTokenIdentifier: "https://clerk.example|user-a",
            })),
          },
          auth: { getUserIdentity: vi.fn(async () => null) },
          storage: { getUrl },
        },
        { exportId: "export-1", ttsCacheKey, attestation },
      ),
    ).resolves.toBeNull();
    expect(getUrl).not.toHaveBeenCalled();
  });

  it.each([
    { ttsProvider: undefined, ownerTokenIdentifier: undefined },
    { ttsProvider: "future-provider", ownerTokenIdentifier: "user-a" },
    { ttsProvider: "openai", ownerTokenIdentifier: undefined },
  ])(
    "fails closed for a $ttsProvider ownerless or unsupported provider",
    async ({ ttsProvider, ownerTokenIdentifier }) => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
      const ttsCacheKey = "tts:openai:profile:ttsNorm:3";
      const attestation = await createArticleAudioExportReadAttestation({
        exportId: "export-1",
        ttsCacheKey,
      });
      const getUrl = vi.fn();
      const handler = (
        getArticleAudioExportForServer as unknown as {
          _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
        }
      )._handler;

      await expect(
        handler(
          {
            db: {
              get: vi.fn(async () => ({
                _id: "export-1",
                articleId: "article-1",
                title: "Untrusted legacy article",
                status: "ready",
                storageId: "storage-protected",
                ttsCacheKey,
                ttsProvider,
                ownerTokenIdentifier,
              })),
              query: vi.fn(() => createAccountDeletionQueryChain()),
            },
            auth: {
              getUserIdentity: vi.fn(async () => ({
                tokenIdentifier: "user-a",
              })),
            },
            storage: { getUrl },
          },
          { exportId: "export-1", ttsCacheKey, attestation },
        ),
      ).resolves.toBeNull();
      expect(getUrl).not.toHaveBeenCalled();
    },
  );
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
        {
          db: { normalizeId, get },
          auth: { getUserIdentity: vi.fn(async () => null) },
        },
        { exportId: "definitely-not-a-convex-id" },
      ),
    ).resolves.toBeNull();

    expect(normalizeId).toHaveBeenCalledWith(
      "articleAudioExports",
      "definitely-not-a-convex-id",
    );
    expect(get).not.toHaveBeenCalled();
  });

  it("keeps a ready Edge export discoverable without authentication", async () => {
    const article = {
      _id: "article-1",
      title: "Public Edge article",
      summary: "A public narration source.",
      sections: [],
    };
    const record = {
      _id: "export-1",
      articleId: article._id,
      status: "ready",
      storageId: "storage-edge",
      ttsCacheKey: "tts:edge:profile:ttsNorm:3",
      ttsProvider: "edge",
      narrationHash: buildArticleNarrationHash(article as never),
    };
    const handler = (
      getArticleAudioExportDownloadIdentity as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(
        {
          db: {
            normalizeId: vi.fn(() => record._id),
            get: vi.fn(async (id: string) =>
              id === record._id ? record : article,
            ),
            query: vi.fn(() => createAccountDeletionQueryChain()),
          },
          auth: { getUserIdentity: vi.fn(async () => null) },
        },
        { exportId: record._id },
      ),
    ).resolves.toEqual({
      exportId: "export-1",
      ttsCacheKey: "tts:edge:profile:ttsNorm:3",
      ttsProvider: "edge",
    });
  });

  it("reveals a ready OpenAI export only to its exact owner", async () => {
    const article = {
      _id: "article-1",
      title: "Protected OpenAI article",
      summary: "An owner-only narration source.",
      sections: [],
    };
    const record = {
      _id: "export-1",
      articleId: article._id,
      status: "ready",
      storageId: "storage-openai",
      ttsCacheKey: "tts:openai:profile:ttsNorm:3",
      ttsProvider: "openai",
      ownerTokenIdentifier: "https://clerk.example|user-a",
      narrationHash: buildArticleNarrationHash(article as never),
    };
    const handler = (
      getArticleAudioExportDownloadIdentity as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;
    const readAs = async (tokenIdentifier: string | null) =>
      await handler(
        {
          db: {
            normalizeId: vi.fn(() => record._id),
            get: vi.fn(async (id: string) =>
              id === record._id ? record : article,
            ),
            query: vi.fn(() => createAccountDeletionQueryChain()),
          },
          auth: {
            getUserIdentity: vi.fn(async () =>
              tokenIdentifier ? { tokenIdentifier } : null,
            ),
          },
        },
        { exportId: record._id },
      );

    await expect(readAs(null)).resolves.toBeNull();
    await expect(readAs("https://clerk.example|user-b")).resolves.toBeNull();
    await expect(readAs("https://clerk.example|user-a")).resolves.toEqual({
      exportId: "export-1",
      ttsCacheKey: "tts:openai:profile:ttsNorm:3",
      ttsProvider: "openai",
    });
  });

  it.each([
    { ttsProvider: undefined, ownerTokenIdentifier: undefined },
    { ttsProvider: "future-provider", ownerTokenIdentifier: "user-a" },
    { ttsProvider: "openai", ownerTokenIdentifier: undefined },
  ])(
    "does not reveal identity for a $ttsProvider ownerless or unsupported row",
    async ({ ttsProvider, ownerTokenIdentifier }) => {
      const record = {
        _id: "export-1",
        articleId: "article-1",
        status: "ready",
        storageId: "storage-protected",
        ttsCacheKey: "tts:openai:legacy-profile:ttsNorm:3",
        ttsProvider,
        ownerTokenIdentifier,
        narrationHash: "current-narration",
      };
      const get = vi.fn(async () => record);
      const handler = (
        getArticleAudioExportDownloadIdentity as unknown as {
          _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
        }
      )._handler;

      await expect(
        handler(
          {
            db: {
              normalizeId: vi.fn(() => record._id),
              get,
              query: vi.fn(() => createAccountDeletionQueryChain()),
            },
            auth: {
              getUserIdentity: vi.fn(async () => ({
                tokenIdentifier: "user-a",
              })),
            },
          },
          { exportId: record._id },
        ),
      ).resolves.toBeNull();
      expect(get).toHaveBeenCalledOnce();
    },
  );
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

  it("fails closed for ownerless, missing, and unknown protected exports", () => {
    const signedInViewer = "https://clerk.example|signed-in-user";
    const legacyRecord = {
      ttsCacheKey:
        "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:2",
    };

    expect(canAccessArticleAudioExport(legacyRecord, null)).toBe(false);
    expect(canAccessArticleAudioExport(legacyRecord, signedInViewer)).toBe(
      false,
    );
    expect(
      canAccessArticleAudioExport({ ttsProvider: "openai" }, signedInViewer),
    ).toBe(false);
    expect(
      canAccessArticleAudioExport(
        {
          ttsProvider: "future-provider",
          ownerTokenIdentifier: signedInViewer,
        },
        signedInViewer,
      ),
    ).toBe(false);
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
