import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Id } from "./_generated/dataModel";
import { type TtsMetadata } from "../lib/tts-profile";
import {
  addViewerPlaylistEpisodeBySlug,
  discardViewerPlaylistEpisodeStorageInternal,
  getFeedEpisodesByToken,
  getEpisodeForPersonalFeedServer,
  getViewerFeedState,
  listViewerPlaylistEpisodesForCtx,
  moveViewerPlaylistEpisodeForCtx,
  removeViewerPlaylistEpisodeForCtx,
  registerViewerPlaylistEpisodeStorageInternal,
  revokeViewerFeedToken,
  retryViewerPlaylistEpisode,
  rotateViewerFeedToken,
  upsertViewerPlaylistEpisodeForCtx,
} from "./personalPlaylist";
import {
  PERSONAL_PLAYLIST_LEASE_MS,
  completeViewerPlaylistEpisodeForCtx,
  failViewerPlaylistEpisodeForCtx,
  getNextQueuedEpisodeForViewerForCtx,
  getPersonalPlaylistOpenAiQuotaConfig,
  markViewerPlaylistEpisodeRunningForCtx,
  retryViewerPlaylistEpisodeForCtx,
  updateViewerPlaylistEpisodeProgressForCtx,
  type PersonalPlaylistMutationCtx,
} from "./lib/personalPlaylistPersistence";
import { createPersonalFeedMediaReadAttestation } from "../lib/personal-feed-media-attestation";

type FeedDoc = {
  _id: Id<"personalPodcastFeeds">;
  viewerTokenIdentifier: string;
  feedToken: string;
  revokedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type EpisodeDoc = {
  _id: Id<"personalPlaylistEpisodes">;
  viewerTokenIdentifier: string;
  articleId: Id<"articles">;
  wikiPageId: string;
  slug: string;
  title: string;
  description?: string;
  imageUrl?: string;
  position: number;
  publishedAt: number;
  removedAt?: number;
  status: "queued" | "running" | "ready" | "failed";
  stage?: "queued" | "rendering_audio" | "packaging";
  sectionCount?: number;
  completedSectionCount?: number;
  storageId?: Id<"_storage">;
  durationSeconds?: number;
  byteLength?: number;
  narrationHash?: string;
  ttsCacheKey?: string;
  provider?: string;
  model?: string;
  voiceId?: string;
  promptVersion?: string;
  ttsNormVersion?: string;
  requestedTtsMetadata?: TtsMetadata;
  generationRetryCount?: number;
  audioVariants?: unknown;
  lastError?: string;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
};

type QuotaDoc = {
  _id: Id<"routeQuotas">;
  key: string;
  count: number;
  windowStart: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};

type AccountOwnedStorageDoc = {
  _id: Id<"accountOwnedStorage">;
  viewerTokenIdentifier: string;
  storageId: Id<"_storage">;
  kind: "personal_playlist_episode" | "article_audio_export";
  parentId: string;
  createdAt: number;
  updatedAt: number;
};

type ArticleDoc = {
  _id: Id<"articles">;
  revisionId: string;
};

const buildEpisode = (
  overrides: Partial<EpisodeDoc> &
    Pick<EpisodeDoc, "_id" | "articleId" | "slug" | "title">,
): EpisodeDoc => ({
  viewerTokenIdentifier: "user-1",
  wikiPageId: `wiki-${overrides.slug}`,
  position: 0,
  publishedAt: Date.now(),
  status: "queued",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
});

const createCtx = (seed?: {
  articles?: ArticleDoc[];
  feeds?: FeedDoc[];
  episodes?: EpisodeDoc[];
  quotas?: QuotaDoc[];
  ownedStorage?: AccountOwnedStorageDoc[];
  storageContentTypes?: Record<string, string | undefined>;
  viewerTokenIdentifier?: string | null;
  deletingViewerTokenIdentifiers?: string[];
}) => {
  const articles = [...(seed?.articles ?? [])];
  let feeds = [...(seed?.feeds ?? [])];
  let episodes = [...(seed?.episodes ?? [])];
  let quotas = [...(seed?.quotas ?? [])];
  let ownedStorage = [...(seed?.ownedStorage ?? [])];
  let idCounter =
    feeds.length + episodes.length + quotas.length + ownedStorage.length;
  const getStorageUrl = vi.fn(
    async (storageId: Id<"_storage">) =>
      `https://cdn.example.com/${storageId}.mp3`,
  );
  const deleteStorage = vi.fn(async (storageId: Id<"_storage">) => {
    void storageId;
  });

  const matchesFilters = (
    doc: Record<string, unknown>,
    filters: Array<[string, unknown]>,
  ) => filters.every(([field, value]) => doc[field] === value);

  const ctx = {
    auth: {
      getUserIdentity: async () =>
        seed?.viewerTokenIdentifier === null
          ? null
          : {
              tokenIdentifier: seed?.viewerTokenIdentifier ?? "user-1",
            },
    },
    db: {
      system: {
        get: async (_tableName: "_storage", storageId: Id<"_storage">) => ({
          _id: storageId,
          _creationTime: 1,
          sha256: "sha256",
          size: 1,
          contentType:
            seed?.storageContentTypes?.[String(storageId)] ??
            "application/vnd.curiogarden.account-audio",
        }),
      },
      query: (
        tableName:
          | "personalPodcastFeeds"
          | "personalPlaylistEpisodes"
          | "routeQuotas"
          | "accountDeletionRequests"
          | "accountOwnedStorage",
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
          if (tableName === "accountDeletionRequests") {
            const viewerTokenIdentifier = filters.find(
              ([field]) => field === "viewerTokenIdentifier",
            )?.[1];
            const deleting =
              typeof viewerTokenIdentifier === "string" &&
              (seed?.deletingViewerTokenIdentifiers ?? []).includes(
                viewerTokenIdentifier,
              );
            return {
              first: async () =>
                deleting
                  ? { _id: "account-deletion-1", viewerTokenIdentifier }
                  : null,
              collect: async () =>
                deleting
                  ? [{ _id: "account-deletion-1", viewerTokenIdentifier }]
                  : [],
            };
          }
          const docs =
            tableName === "personalPodcastFeeds"
              ? feeds
              : tableName === "personalPlaylistEpisodes"
                ? episodes
                : tableName === "routeQuotas"
                  ? quotas
                  : tableName === "accountOwnedStorage"
                    ? ownedStorage
                    : null;
          if (docs === null) {
            throw new Error(`Unexpected table: ${tableName}`);
          }
          const filtered = docs.filter((doc) =>
            matchesFilters(doc as Record<string, unknown>, filters),
          );
          return {
            first: async () => filtered[0] ?? null,
            collect: async () => filtered,
          };
        },
      }),
      insert: async (
        tableName:
          | "personalPodcastFeeds"
          | "personalPlaylistEpisodes"
          | "routeQuotas"
          | "accountOwnedStorage",
        value:
          | Omit<FeedDoc, "_id">
          | Omit<EpisodeDoc, "_id">
          | Omit<QuotaDoc, "_id">
          | Omit<AccountOwnedStorageDoc, "_id">,
      ) => {
        idCounter += 1;
        const id = `${tableName}-${idCounter}` as never;
        if (tableName === "personalPodcastFeeds") {
          feeds.push({ _id: id, ...(value as Omit<FeedDoc, "_id">) });
        } else if (tableName === "personalPlaylistEpisodes") {
          episodes.push({ _id: id, ...(value as Omit<EpisodeDoc, "_id">) });
        } else if (tableName === "routeQuotas") {
          quotas.push({ _id: id, ...(value as Omit<QuotaDoc, "_id">) });
        } else if (tableName === "accountOwnedStorage") {
          ownedStorage.push({
            _id: id,
            ...(value as Omit<AccountOwnedStorageDoc, "_id">),
          });
        } else {
          throw new Error(`Unexpected table: ${tableName}`);
        }
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        feeds = feeds.map((doc) =>
          doc._id === id ? ({ ...doc, ...value } as FeedDoc) : doc,
        );
        episodes = episodes.map((doc) =>
          doc._id === id ? ({ ...doc, ...value } as EpisodeDoc) : doc,
        );
        quotas = quotas.map((doc) =>
          doc._id === id ? ({ ...doc, ...value } as QuotaDoc) : doc,
        );
        ownedStorage = ownedStorage.map((doc) =>
          doc._id === id
            ? ({ ...doc, ...value } as AccountOwnedStorageDoc)
            : doc,
        );
      },
      delete: async (id: string) => {
        feeds = feeds.filter((doc) => doc._id !== id);
        episodes = episodes.filter((doc) => doc._id !== id);
        quotas = quotas.filter((doc) => doc._id !== id);
        ownedStorage = ownedStorage.filter((doc) => doc._id !== id);
      },
      get: async (id: string) => {
        return (
          episodes.find((doc) => doc._id === id) ??
          feeds.find((doc) => doc._id === id) ??
          quotas.find((doc) => doc._id === id) ??
          ownedStorage.find((doc) => doc._id === id) ??
          articles.find((doc) => doc._id === id) ??
          null
        );
      },
      normalizeId: (tableName: string, id: string) =>
        tableName === "personalPlaylistEpisodes" &&
        episodes.some((episode) => episode._id === id)
          ? (id as Id<"personalPlaylistEpisodes">)
          : null,
    },
    storage: {
      getUrl: getStorageUrl,
      delete: deleteStorage,
    },
  } as unknown as PersonalPlaylistMutationCtx;

  return {
    ctx,
    getFeeds: () => feeds,
    getEpisodes: () => episodes,
    getQuotas: () => quotas,
    getOwnedStorage: () => ownedStorage,
    getStorageUrl,
    deleteStorage,
  };
};

const invokeRegistered = async <TArgs, TResult>(
  registeredFunction: unknown,
  ctx: unknown,
  args: TArgs,
): Promise<TResult> =>
  await (
    registeredFunction as {
      _handler: (handlerCtx: unknown, handlerArgs: TArgs) => Promise<TResult>;
    }
  )._handler(ctx, args);

describe("personal playlist data helpers", () => {
  const narrationHash = "article-narration-current";
  const requestedTtsMetadata = {
    provider: "edge" as const,
    model: "edge-tts",
    voiceId: "en-US-AriaNeural",
    promptVersion: "edge-default",
    ttsNormVersion: "ttsNorm:2",
    ttsCacheKey: "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2",
  } satisfies TtsMetadata;
  const refreshedTtsMetadata = {
    provider: "openai" as const,
    model: "gpt-4o-mini-tts",
    voiceId: "cedar",
    promptVersion: "curio-warm-narrator-v2",
    ttsNormVersion: "ttsNorm:2",
    ttsCacheKey:
      "tts:openai:gpt-4o-mini-tts:cedar:curio-warm-narrator-v2:ttsNorm:2",
  } satisfies TtsMetadata;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T18:00:00Z"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("accepts the ignored legacy baseUrl on public add and retry calls", () => {
    const legacyBaseUrlValidator = {
      fieldType: { type: "string" },
      optional: true,
    };
    const exportArgs = (registeredFunction: unknown) =>
      (registeredFunction as { exportArgs(): string }).exportArgs();
    const addArgs = JSON.parse(exportArgs(addViewerPlaylistEpisodeBySlug)) as {
      value: Record<string, unknown>;
    };
    const retryArgs = JSON.parse(exportArgs(retryViewerPlaylistEpisode)) as {
      value: Record<string, unknown>;
    };

    expect(addArgs.value.baseUrl).toEqual(legacyBaseUrlValidator);
    expect(retryArgs.value.baseUrl).toEqual(legacyBaseUrlValidator);
  });

  it("checks the durable deletion barrier before fetching an article", async () => {
    const runAction = vi.fn(async () => {
      throw new Error("Article fetch should not run");
    });
    const runQuery = vi
      .fn()
      .mockRejectedValue(new Error("ACCOUNT_DELETION_IN_PROGRESS"));

    await expect(
      invokeRegistered(
        addViewerPlaylistEpisodeBySlug,
        {
          auth: {
            getUserIdentity: vi.fn().mockResolvedValue({
              tokenIdentifier: "user-1",
            }),
          },
          runQuery,
          runAction,
        },
        { slug: "mars" },
      ),
    ).rejects.toThrow("ACCOUNT_DELETION_IN_PROGRESS");

    expect(runQuery).toHaveBeenCalledWith(expect.anything(), {
      viewerTokenIdentifier: "user-1",
    });
    expect(runAction).not.toHaveBeenCalled();
  });

  it("creates a feed token and queued episode on first add", async () => {
    const { ctx, getFeeds, getEpisodes } = createCtx();

    const result = await upsertViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "mars",
      title: "Mars",
      description: "Planet article",
      imageUrl: "https://images.example.com/mars.jpg",
      sectionCount: 4,
      narrationHash,
      requestedTtsMetadata,
    });

    expect(result.added).toBe(true);
    expect(result.shouldSchedule).toBe(true);
    expect(result.status).toBe("queued");
    expect(getFeeds()).toHaveLength(1);
    expect(getFeeds()[0].feedToken).toHaveLength(64);
    expect(getEpisodes()).toEqual([
      expect.objectContaining({
        viewerTokenIdentifier: "user-1",
        slug: "mars",
        title: "Mars",
        position: 0,
        publishedAt: Date.now(),
        status: "queued",
        requestedTtsMetadata,
      }),
    ]);
  });

  it("rejects a late internal playlist upsert after deletion starts", async () => {
    const { ctx, getEpisodes, getFeeds } = createCtx({
      deletingViewerTokenIdentifiers: ["user-1"],
    });

    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, {
        viewerTokenIdentifier: "user-1",
        articleId: "article-1" as Id<"articles">,
        wikiPageId: "wiki-1",
        slug: "mars",
        title: "Mars",
        sectionCount: 4,
        narrationHash,
      }),
    ).rejects.toThrow("ACCOUNT_DELETION_IN_PROGRESS");
    expect(getEpisodes()).toEqual([]);
    expect(getFeeds()).toEqual([]);
  });

  it("rotates the signed-in viewer's feed token and invalidates the old URL", async () => {
    const oldFeedToken = "a".repeat(64);
    const otherFeedToken = "c".repeat(64);
    const { ctx, getFeeds } = createCtx({
      feeds: [
        {
          _id: "personalPodcastFeeds-1" as Id<"personalPodcastFeeds">,
          viewerTokenIdentifier: "user-1",
          feedToken: oldFeedToken,
          createdAt: Date.now() - 1_000,
          updatedAt: Date.now() - 1_000,
        },
        {
          _id: "personalPodcastFeeds-2" as Id<"personalPodcastFeeds">,
          viewerTokenIdentifier: "user-2",
          feedToken: otherFeedToken,
          createdAt: Date.now() - 1_000,
          updatedAt: Date.now() - 1_000,
        },
      ],
    });

    const rotated = await invokeRegistered<
      Record<string, never>,
      { status: string; feedToken: string | null }
    >(rotateViewerFeedToken, ctx, {});
    const activeState = await invokeRegistered<
      Record<string, never>,
      { status: string; feedToken: string | null }
    >(getViewerFeedState, ctx, {});
    const oldPublicFeed = await invokeRegistered<
      { feedToken: string },
      unknown
    >(getFeedEpisodesByToken, ctx, { feedToken: oldFeedToken });
    const newPublicFeed = await invokeRegistered<
      { feedToken: string },
      unknown
    >(getFeedEpisodesByToken, ctx, { feedToken: rotated.feedToken ?? "" });

    expect(rotated).toMatchObject({ status: "active" });
    expect(rotated.feedToken).toMatch(/^[a-f0-9]{64}$/);
    expect(rotated.feedToken).not.toBe(oldFeedToken);
    expect(activeState).toEqual(rotated);
    expect(oldPublicFeed).toBeNull();
    expect(newPublicFeed).not.toBeNull();
    expect(
      getFeeds().find(
        ({ viewerTokenIdentifier }) => viewerTokenIdentifier === "user-2",
      )?.feedToken,
    ).toBe(otherFeedToken);
  });

  it("rejects unauthenticated feed lifecycle mutations", async () => {
    const { ctx } = createCtx({ viewerTokenIdentifier: null });

    await expect(
      invokeRegistered(rotateViewerFeedToken, ctx, {}),
    ).rejects.toThrow("Unauthorized");
    await expect(
      invokeRegistered(revokeViewerFeedToken, ctx, {}),
    ).rejects.toThrow("Unauthorized");
  });

  it("revokes feed access idempotently without deleting the playlist and allows reactivation", async () => {
    const originalFeedToken = "b".repeat(64);
    const episode = buildEpisode({
      _id: "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">,
      articleId: "article-1" as Id<"articles">,
      slug: "mars",
      title: "Mars",
      status: "ready",
      storageId: "storage-1" as Id<"_storage">,
    });
    const { ctx, getEpisodes, getFeeds } = createCtx({
      feeds: [
        {
          _id: "personalPodcastFeeds-1" as Id<"personalPodcastFeeds">,
          viewerTokenIdentifier: "user-1",
          feedToken: originalFeedToken,
          createdAt: Date.now() - 1_000,
          updatedAt: Date.now() - 1_000,
        },
      ],
      episodes: [episode],
    });

    const revoked = await invokeRegistered<
      Record<string, never>,
      { status: string; feedToken: string | null; updatedAt: number | null }
    >(revokeViewerFeedToken, ctx, {});
    const repeated = await invokeRegistered<
      Record<string, never>,
      { status: string; feedToken: string | null; updatedAt: number | null }
    >(revokeViewerFeedToken, ctx, {});
    const viewerState = await invokeRegistered<
      Record<string, never>,
      { status: string; feedToken: string | null; updatedAt: number | null }
    >(getViewerFeedState, ctx, {});
    const publicFeed = await invokeRegistered<{ feedToken: string }, unknown>(
      getFeedEpisodesByToken,
      ctx,
      { feedToken: originalFeedToken },
    );

    expect(revoked).toEqual({
      status: "revoked",
      feedToken: null,
      updatedAt: Date.now(),
    });
    expect(repeated).toEqual(revoked);
    expect(viewerState).toEqual(revoked);
    expect(publicFeed).toBeNull();
    expect(getEpisodes()).toEqual([episode]);
    expect(getFeeds()[0]).toMatchObject({
      revokedAt: Date.now(),
    });
    const tombstoneToken = getFeeds()[0].feedToken;
    expect(tombstoneToken).toMatch(/^[a-f0-9]{64}$/);
    expect(tombstoneToken).not.toBe(originalFeedToken);

    const addedWhileRevoked = await upsertViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      articleId: "article-2" as Id<"articles">,
      wikiPageId: "wiki-2",
      slug: "venus",
      title: "Venus",
      sectionCount: 2,
      narrationHash: "venus-narration",
    });
    const stillRevoked = await invokeRegistered<
      Record<string, never>,
      { status: string; feedToken: string | null; updatedAt: number | null }
    >(getViewerFeedState, ctx, {});

    expect(addedWhileRevoked).not.toHaveProperty("feedToken");
    expect(stillRevoked.status).toBe("revoked");
    expect(getFeeds()[0].feedToken).toBe(tombstoneToken);

    vi.advanceTimersByTime(1_000);
    const reactivated = await invokeRegistered<
      Record<string, never>,
      { status: string; feedToken: string | null; updatedAt: number | null }
    >(rotateViewerFeedToken, ctx, {});

    expect(reactivated.status).toBe("active");
    expect(reactivated.feedToken).toMatch(/^[a-f0-9]{64}$/);
    expect(reactivated.feedToken).not.toBe(originalFeedToken);
    expect(getFeeds()[0].revokedAt).toBeUndefined();
    expect(getEpisodes().map(({ title }) => title)).toEqual(["Mars", "Venus"]);
  });

  it("returns only the RSS fields for ready episodes without creating storage URLs", async () => {
    const feedToken = "d".repeat(64);
    const readyEpisode = buildEpisode({
      _id: "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">,
      articleId: "article-1" as Id<"articles">,
      slug: "mars",
      title: "Mars",
      description: "The red planet.",
      imageUrl: "https://images.example.com/mars.jpg",
      status: "ready",
      storageId: "storage-1" as Id<"_storage">,
      durationSeconds: 120,
      byteLength: 12_345,
      ttsCacheKey: "private-cache-key",
      lastError: "internal worker detail",
      leaseOwner: "worker-secret",
      updatedAt: 2_000,
      publishedAt: 1_500,
    });
    const failedEpisode = buildEpisode({
      _id: "personalPlaylistEpisodes-2" as Id<"personalPlaylistEpisodes">,
      articleId: "article-2" as Id<"articles">,
      slug: "venus",
      title: "Venus",
      status: "failed",
      lastError: "private failure",
    });
    const { ctx, getStorageUrl } = createCtx({
      articles: [
        {
          _id: "article-1" as Id<"articles">,
          revisionId: "revision-42",
        },
      ],
      feeds: [
        {
          _id: "personalPodcastFeeds-1" as Id<"personalPodcastFeeds">,
          viewerTokenIdentifier: "user-1",
          feedToken,
          createdAt: 1_000,
          updatedAt: 2_500,
        },
      ],
      episodes: [readyEpisode, failedEpisode],
    });

    const payload = await invokeRegistered<{ feedToken: string }, unknown>(
      getFeedEpisodesByToken,
      ctx,
      { feedToken },
    );

    expect(payload).toEqual({
      feed: { updatedAt: 2_500 },
      episodes: [
        {
          _id: readyEpisode._id,
          wikiPageId: readyEpisode.wikiPageId,
          slug: "mars",
          title: "Mars",
          description: "The red planet.",
          imageUrl: "https://images.example.com/mars.jpg",
          publishedAt: 1_500,
          updatedAt: 2_000,
          durationSeconds: 120,
          byteLength: 12_345,
          sourceRevisionId: "revision-42",
        },
      ],
    });
    expect(getStorageUrl).not.toHaveBeenCalled();
  });

  it("invalidates an otherwise active private feed as soon as deletion starts", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "personal-media-server-secret");
    const feedToken = "f".repeat(64);
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const { ctx, getStorageUrl } = createCtx({
      deletingViewerTokenIdentifiers: ["user-1"],
      feeds: [
        {
          _id: "personalPodcastFeeds-1" as Id<"personalPodcastFeeds">,
          viewerTokenIdentifier: "user-1",
          feedToken,
          createdAt: 1_000,
          updatedAt: 2_000,
        },
      ],
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "ready",
          storageId: "storage-1" as Id<"_storage">,
        }),
      ],
    });

    await expect(
      invokeRegistered(getFeedEpisodesByToken, ctx, { feedToken }),
    ).resolves.toBeNull();

    const identity = { feedToken, episodeId };
    const attestation = await createPersonalFeedMediaReadAttestation(identity);
    await expect(
      invokeRegistered(getEpisodeForPersonalFeedServer, ctx, {
        ...identity,
        attestation,
      }),
    ).resolves.toBeNull();
    expect(getStorageUrl).not.toHaveBeenCalled();
  });

  it("resolves one ready episode's media only for a server-attested request", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "personal-media-server-secret");
    const feedToken = "e".repeat(64);
    const episode = buildEpisode({
      _id: "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">,
      articleId: "article-1" as Id<"articles">,
      slug: "mars",
      title: "Mars",
      status: "ready",
      storageId: "storage-1" as Id<"_storage">,
    });
    const { ctx, getStorageUrl } = createCtx({
      feeds: [
        {
          _id: "personalPodcastFeeds-1" as Id<"personalPodcastFeeds">,
          viewerTokenIdentifier: "user-1",
          feedToken,
          createdAt: 1_000,
          updatedAt: 2_000,
        },
      ],
      episodes: [episode],
    });
    const identity = { feedToken, episodeId: episode._id };
    const attestation = await createPersonalFeedMediaReadAttestation(identity);

    const resolved = await invokeRegistered<
      typeof identity & { attestation: typeof attestation },
      unknown
    >(getEpisodeForPersonalFeedServer, ctx, {
      ...identity,
      attestation,
    });

    expect(resolved).toEqual({
      title: "Mars",
      audioUrl: "https://cdn.example.com/storage-1.mp3",
    });
    expect(getStorageUrl).toHaveBeenCalledTimes(1);

    await expect(
      invokeRegistered(getEpisodeForPersonalFeedServer, ctx, {
        feedToken,
        episodeId: "personalPlaylistEpisodes-2",
        attestation,
      }),
    ).rejects.toThrow("valid server attestation");
    expect(getStorageUrl).toHaveBeenCalledTimes(1);
  });

  it("does not create duplicate active episodes for the same article", async () => {
    const { ctx, getEpisodes } = createCtx();
    const args = {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "mars",
      title: "Mars",
      description: "Planet article",
      imageUrl: "https://images.example.com/mars.jpg",
      sectionCount: 4,
      narrationHash,
    };

    const first = await upsertViewerPlaylistEpisodeForCtx(ctx, args);
    const second = await upsertViewerPlaylistEpisodeForCtx(ctx, args);

    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
    expect(getEpisodes()).toHaveLength(1);
  });

  it("caps active OpenAI generation without blocking exact episode reuse", async () => {
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_ACTIVE_LIMIT", "1");
    const { ctx, getEpisodes } = createCtx();
    const mars = {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "mars",
      title: "Mars",
      sectionCount: 4,
      narrationHash,
    };

    await upsertViewerPlaylistEpisodeForCtx(ctx, mars);
    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, mars),
    ).resolves.toMatchObject({ added: false, shouldSchedule: false });
    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, {
        ...mars,
        articleId: "article-2" as Id<"articles">,
        wikiPageId: "wiki-2",
        slug: "venus",
        title: "Venus",
      }),
    ).rejects.toThrow(
      "Personal Playlist queue is full. Wait for an episode to finish before adding another.",
    );
    expect(getEpisodes().map((episode) => episode.slug)).toEqual(["mars"]);

    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, {
        ...mars,
        viewerTokenIdentifier: "user-2",
        articleId: "article-2" as Id<"articles">,
        wikiPageId: "wiki-2",
        slug: "venus",
        title: "Venus",
      }),
    ).resolves.toMatchObject({ added: true, shouldSchedule: true });
  });

  it("counts only this account's visible queued and running episodes as active", async () => {
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_ACTIVE_LIMIT", "1");
    const { ctx } = createCtx({
      episodes: [
        buildEpisode({
          _id: "personalPlaylistEpisodes-ready" as Id<"personalPlaylistEpisodes">,
          articleId: "article-ready" as Id<"articles">,
          slug: "earth",
          title: "Earth",
          status: "ready",
        }),
        buildEpisode({
          _id: "personalPlaylistEpisodes-removed" as Id<"personalPlaylistEpisodes">,
          articleId: "article-removed" as Id<"articles">,
          slug: "mercury",
          title: "Mercury",
          status: "queued",
          removedAt: Date.now(),
        }),
        buildEpisode({
          _id: "personalPlaylistEpisodes-other-user" as Id<"personalPlaylistEpisodes">,
          viewerTokenIdentifier: "user-2",
          articleId: "article-other-user" as Id<"articles">,
          slug: "venus",
          title: "Venus",
          status: "running",
        }),
      ],
    });
    const buildArgs = (slug: string) => ({
      viewerTokenIdentifier: "user-1",
      articleId: `article-${slug}` as Id<"articles">,
      wikiPageId: `wiki-${slug}`,
      slug,
      title: slug[0].toUpperCase() + slug.slice(1),
      sectionCount: 4,
      narrationHash: `${slug}-narration`,
    });

    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, buildArgs("jupiter")),
    ).resolves.toMatchObject({ added: true, shouldSchedule: true });
    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, buildArgs("saturn")),
    ).rejects.toThrow("Personal Playlist queue is full.");
  });

  it("limits newly scheduled episodes per account while exempting exact reuse", async () => {
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT", "2");
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_DAILY_WINDOW_MS", "1000");
    const { ctx, getEpisodes, getQuotas } = createCtx();
    const buildArgs = (slug: string, account = "user-1") => ({
      viewerTokenIdentifier: account,
      articleId: `article-${slug}` as Id<"articles">,
      wikiPageId: `wiki-${slug}`,
      slug,
      title: slug[0].toUpperCase() + slug.slice(1),
      sectionCount: 4,
      narrationHash: `${slug}-narration`,
    });

    await upsertViewerPlaylistEpisodeForCtx(ctx, buildArgs("mars"));
    await upsertViewerPlaylistEpisodeForCtx(ctx, buildArgs("venus"));
    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, buildArgs("mars")),
    ).resolves.toMatchObject({ added: false, shouldSchedule: false });

    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, buildArgs("jupiter")),
    ).rejects.toThrow(
      "Personal Playlist generation limit reached. Try again after 2026-03-16T18:00:01.000Z.",
    );
    expect(getQuotas()).toEqual([
      expect.objectContaining({
        key: "personal-playlist:openai:daily:user-1",
        count: 2,
        windowStart: Date.now(),
        expiresAt: Date.now() + 1_000,
      }),
    ]);
    expect(getEpisodes().map((episode) => episode.slug)).toEqual([
      "mars",
      "venus",
    ]);

    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, buildArgs("jupiter", "user-2")),
    ).resolves.toMatchObject({ added: true, shouldSchedule: true });
    expect(getQuotas()).toHaveLength(2);

    vi.advanceTimersByTime(1_001);
    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, buildArgs("jupiter")),
    ).resolves.toMatchObject({ added: true, shouldSchedule: true });
    expect(
      getQuotas().find(
        (quota) => quota.key === "personal-playlist:openai:daily:user-1",
      ),
    ).toMatchObject({
      count: 1,
      windowStart: Date.now(),
      expiresAt: Date.now() + 1_000,
    });
  });

  it("uses safe defaults for invalid Personal Playlist quota settings", () => {
    expect(getPersonalPlaylistOpenAiQuotaConfig({})).toEqual({
      activeLimit: 5,
      dailyLimit: 10,
      dailyWindowMs: 86_400_000,
    });
    expect(
      getPersonalPlaylistOpenAiQuotaConfig({
        PERSONAL_PLAYLIST_OPENAI_ACTIVE_LIMIT: "0",
        PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT: "not-a-number",
        PERSONAL_PLAYLIST_OPENAI_DAILY_WINDOW_MS: "-1",
      }),
    ).toEqual({
      activeLimit: 5,
      dailyLimit: 10,
      dailyWindowMs: 86_400_000,
    });
  });

  it("does not spend daily allowance when an episode has no narratable tracks", async () => {
    const { ctx, getQuotas } = createCtx();

    await upsertViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "empty-article",
      title: "Empty article",
      sectionCount: 0,
      narrationHash,
    });

    expect(getQuotas()).toEqual([]);
  });

  it("does not double-charge an already queued episode when narration changes", async () => {
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_ACTIVE_LIMIT", "1");
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT", "1");
    const { ctx, getEpisodes, getQuotas } = createCtx();
    const args = {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "mars",
      title: "Mars",
      sectionCount: 4,
      narrationHash: "narration-v1",
    };
    await upsertViewerPlaylistEpisodeForCtx(ctx, args);

    await expect(
      upsertViewerPlaylistEpisodeForCtx(ctx, {
        ...args,
        narrationHash: "narration-v2",
      }),
    ).resolves.toMatchObject({ added: false, shouldSchedule: true });
    expect(getEpisodes()[0]).toMatchObject({
      status: "queued",
      narrationHash: "narration-v2",
    });
    expect(getQuotas()[0]).toMatchObject({ count: 1 });
  });

  it("charges regeneration after completion or removal as new scheduled work", async () => {
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT", "1");
    const quota = {
      _id: "routeQuotas-user-1" as Id<"routeQuotas">,
      key: "personal-playlist:openai:daily:user-1",
      count: 1,
      windowStart: Date.now(),
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const episodeId =
      "personalPlaylistEpisodes-existing" as Id<"personalPlaylistEpisodes">;
    const args = {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-mars",
      slug: "mars",
      title: "Mars",
      sectionCount: 4,
      narrationHash: "narration-v2",
    };
    const readyEpisode = buildEpisode({
      _id: episodeId,
      articleId: args.articleId,
      slug: args.slug,
      title: args.title,
      status: "ready",
      narrationHash: "narration-v1",
    });
    const { ctx: readyCtx, getEpisodes: getReadyEpisodes } = createCtx({
      episodes: [readyEpisode],
      quotas: [quota],
    });

    await expect(
      upsertViewerPlaylistEpisodeForCtx(readyCtx, {
        ...args,
        narrationHash: "narration-v1",
      }),
    ).resolves.toMatchObject({ status: "ready", shouldSchedule: false });
    await expect(
      upsertViewerPlaylistEpisodeForCtx(readyCtx, args),
    ).rejects.toThrow("Personal Playlist generation limit reached.");
    expect(getReadyEpisodes()[0]).toMatchObject({
      status: "ready",
      narrationHash: "narration-v1",
    });

    const { ctx: removedCtx, getEpisodes: getRemovedEpisodes } = createCtx({
      episodes: [{ ...readyEpisode, status: "failed", removedAt: Date.now() }],
      quotas: [quota],
    });
    await expect(
      upsertViewerPlaylistEpisodeForCtx(removedCtx, args),
    ).rejects.toThrow("Personal Playlist generation limit reached.");
    expect(getRemovedEpisodes()[0]).toMatchObject({
      status: "failed",
      removedAt: Date.now(),
    });
  });

  it("does not backfill an unchanged ready episode after the active profile changes", async () => {
    const episodeId =
      "personalPlaylistEpisodes-ready" as Id<"personalPlaylistEpisodes">;
    const { ctx, getEpisodes } = createCtx({
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "ready",
          narrationHash,
          requestedTtsMetadata,
          storageId: "storage-ready" as Id<"_storage">,
        }),
      ],
    });

    const result = await upsertViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-mars",
      slug: "mars",
      title: "Mars",
      sectionCount: 4,
      narrationHash,
      requestedTtsMetadata: refreshedTtsMetadata,
    });

    expect(result).toMatchObject({
      status: "ready",
      shouldSchedule: false,
    });
    expect(getEpisodes()[0]).toMatchObject({
      storageId: "storage-ready",
      requestedTtsMetadata,
    });
  });

  it("requeues an active episode when its article narration changes", async () => {
    const { ctx, getEpisodes } = createCtx();
    const args = {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "mars",
      title: "Mars",
      sectionCount: 4,
      narrationHash: "narration-v1",
      requestedTtsMetadata,
    };
    await upsertViewerPlaylistEpisodeForCtx(ctx, args);

    const refreshed = await upsertViewerPlaylistEpisodeForCtx(ctx, {
      ...args,
      narrationHash: "narration-v2",
      requestedTtsMetadata: refreshedTtsMetadata,
    });

    expect(refreshed).toMatchObject({
      added: false,
      shouldSchedule: true,
      status: "queued",
    });
    expect(getEpisodes()[0]).toMatchObject({
      narrationHash: "narration-v2",
      status: "queued",
      completedSectionCount: 0,
      requestedTtsMetadata: refreshedTtsMetadata,
    });
  });

  it("deletes audio that becomes unreferenced when narration changes", async () => {
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const { ctx, deleteStorage } = createCtx({
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "ready",
          narrationHash: "narration-v1",
          storageId: "primary-old" as Id<"_storage">,
          audioVariants: [
            {
              storageId: "primary-old",
              ttsCacheKey: "voice-a",
              provider: "openai",
              model: "gpt-4o-mini-tts",
              voiceId: "sage",
              promptVersion: "v1",
              ttsNormVersion: "v1",
              createdAt: 1,
            },
            {
              storageId: "alternate-old",
              ttsCacheKey: "voice-b",
              provider: "openai",
              model: "gpt-4o-mini-tts",
              voiceId: "cedar",
              promptVersion: "v1",
              ttsNormVersion: "v1",
              createdAt: 1,
            },
          ],
        }),
      ],
    });

    await upsertViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-mars",
      slug: "mars",
      title: "Mars",
      sectionCount: 4,
      narrationHash: "narration-v2",
      requestedTtsMetadata,
    });

    expect(deleteStorage.mock.calls.map(([id]) => id).sort()).toEqual([
      "alternate-old",
      "primary-old",
    ]);
  });

  it("soft-removes and later restores the same episode record in queued state", async () => {
    const { ctx, getEpisodes } = createCtx();
    const args = {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "mars",
      title: "Mars",
      description: "Planet article",
      imageUrl: "https://images.example.com/mars.jpg",
      sectionCount: 4,
      narrationHash,
    };

    const first = await upsertViewerPlaylistEpisodeForCtx(ctx, args);
    await removeViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      episodeId: first.episodeId,
    });

    let visible = await listViewerPlaylistEpisodesForCtx(ctx, "user-1");
    expect(visible).toEqual([]);

    const restored = await upsertViewerPlaylistEpisodeForCtx(ctx, {
      ...args,
      requestedTtsMetadata: refreshedTtsMetadata,
    });
    visible = await listViewerPlaylistEpisodesForCtx(ctx, "user-1");

    expect(restored.episodeId).toBe(first.episodeId);
    expect(restored.status).toBe("queued");
    expect(restored.shouldSchedule).toBe(true);
    expect(getEpisodes()).toHaveLength(1);
    expect(visible).toHaveLength(1);
    expect(visible[0]._id).toBe(first.episodeId);
    expect(visible[0].status).toBe("queued");
    expect(visible[0]).not.toHaveProperty("requestedTtsMetadata");
  });

  it("preserves a pinned profile when a legacy restore omits metadata", async () => {
    const { ctx, getEpisodes } = createCtx();
    const args = {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "mars",
      title: "Mars",
      sectionCount: 4,
      narrationHash,
      requestedTtsMetadata,
    };
    const first = await upsertViewerPlaylistEpisodeForCtx(ctx, args);
    await removeViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      episodeId: first.episodeId,
    });
    const legacyArgs = {
      viewerTokenIdentifier: args.viewerTokenIdentifier,
      articleId: args.articleId,
      wikiPageId: args.wikiPageId,
      slug: args.slug,
      title: args.title,
      sectionCount: args.sectionCount,
      narrationHash: args.narrationHash,
    };

    await upsertViewerPlaylistEpisodeForCtx(ctx, legacyArgs);

    expect(getEpisodes()[0].requestedTtsMetadata).toEqual(requestedTtsMetadata);
  });

  it("rewrites queue position and synthetic publishedAt when moved", async () => {
    const { ctx, getEpisodes } = createCtx();

    await upsertViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "mars",
      title: "Mars",
      sectionCount: 3,
      narrationHash: "mars-narration",
    });
    vi.advanceTimersByTime(1_000);
    const second = await upsertViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      articleId: "article-2" as Id<"articles">,
      wikiPageId: "wiki-2",
      slug: "venus",
      title: "Venus",
      sectionCount: 5,
      narrationHash: "venus-narration",
    });

    await moveViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      episodeId: second.episodeId,
      direction: "up",
    });

    const ordered = [...getEpisodes()].sort(
      (left, right) => left.position - right.position,
    );
    expect(ordered.map((episode) => episode.slug)).toEqual(["venus", "mars"]);
    expect(ordered[0].publishedAt).toBeGreaterThan(ordered[1].publishedAt);
  });

  it("keeps viewer queries scoped to the current account", async () => {
    const { ctx, getStorageUrl } = createCtx({
      feeds: [
        {
          _id: "personalPodcastFeeds-1" as Id<"personalPodcastFeeds">,
          viewerTokenIdentifier: "user-1",
          feedToken: "feed-1",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      episodes: [
        {
          _id: "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">,
          viewerTokenIdentifier: "user-1",
          articleId: "article-1" as Id<"articles">,
          wikiPageId: "wiki-1",
          slug: "mars",
          title: "Mars",
          position: 0,
          publishedAt: 10,
          status: "failed",
          stage: "rendering_audio",
          sectionCount: 4,
          completedSectionCount: 2,
          storageId: "storage-1" as Id<"_storage">,
          narrationHash: "private-narration-hash",
          requestedTtsMetadata,
          audioVariants: [{ storageId: "variant-secret" }],
          lastError: "private worker stack trace",
          leaseOwner: "worker-secret",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          _id: "personalPlaylistEpisodes-2" as Id<"personalPlaylistEpisodes">,
          viewerTokenIdentifier: "user-2",
          articleId: "article-2" as Id<"articles">,
          wikiPageId: "wiki-2",
          slug: "venus",
          title: "Venus",
          position: 0,
          publishedAt: 20,
          status: "ready",
          storageId: "storage-2" as Id<"_storage">,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });

    const visible = await listViewerPlaylistEpisodesForCtx(ctx, "user-1");

    expect(visible).toHaveLength(1);
    expect(visible[0]).toEqual({
      _id: "personalPlaylistEpisodes-1",
      slug: "mars",
      title: "Mars",
      position: 0,
      publishedAt: 10,
      status: "failed",
      stage: "rendering_audio",
      sectionCount: 4,
      completedSectionCount: 2,
      lastError: "Episode generation failed. Retry when ready.",
    });
    expect(getStorageUrl).not.toHaveBeenCalled();
  });

  it("honors another worker's active lease and claims after it expires", async () => {
    const targetId =
      "personalPlaylistEpisodes-2" as Id<"personalPlaylistEpisodes">;
    const { ctx, getEpisodes } = createCtx({
      episodes: [
        buildEpisode({
          _id: "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "running",
          leaseOwner: "worker-a",
          leaseExpiresAt: Date.now() + 30_000,
        }),
        buildEpisode({
          _id: targetId,
          articleId: "article-2" as Id<"articles">,
          slug: "venus",
          title: "Venus",
          position: 1,
        }),
      ],
    });

    await expect(
      markViewerPlaylistEpisodeRunningForCtx(ctx, {
        episodeId: targetId,
        owner: "worker-b",
      }),
    ).resolves.toEqual({ claimed: false, viewerTokenIdentifier: "user-1" });

    vi.advanceTimersByTime(30_001);
    await expect(
      markViewerPlaylistEpisodeRunningForCtx(ctx, {
        episodeId: targetId,
        owner: "worker-b",
      }),
    ).resolves.toEqual({ claimed: true, viewerTokenIdentifier: "user-1" });

    expect(
      getEpisodes().find((episode) => episode._id === targetId),
    ).toMatchObject({
      status: "running",
      stage: "rendering_audio",
      leaseOwner: "worker-b",
      leaseExpiresAt: Date.now() + 8 * 60 * 1_000,
    });
  });

  it("blocks playlist workers and deletes a late upload after deletion starts", async () => {
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const { ctx, deleteStorage, getEpisodes } = createCtx({
      deletingViewerTokenIdentifiers: ["user-1"],
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "running",
          stage: "packaging",
          leaseOwner: "worker-a",
          leaseExpiresAt: Date.now() + 60_000,
        }),
      ],
    });

    await expect(
      markViewerPlaylistEpisodeRunningForCtx(ctx, {
        episodeId,
        owner: "worker-b",
      }),
    ).resolves.toEqual({ claimed: false, viewerTokenIdentifier: null });
    await expect(
      completeViewerPlaylistEpisodeForCtx(ctx, {
        episodeId,
        owner: "worker-a",
        storageId: "late-upload" as Id<"_storage">,
        durationSeconds: 120,
        byteLength: 12_000,
        ttsCacheKey: "voice-a",
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voiceId: "sage",
        promptVersion: "v1",
        ttsNormVersion: "v1",
        narrationHash,
      }),
    ).resolves.toEqual({ completed: false });

    expect(deleteStorage).toHaveBeenCalledWith("late-upload");
    expect(getEpisodes()[0]).toMatchObject({ status: "running" });
    expect(getEpisodes()[0]).not.toHaveProperty("storageId");
  });

  it("rejects duplicate completion after deletion starts and removes its ledgered blob", async () => {
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const storageId = "ready-storage" as Id<"_storage">;
    const { ctx, deleteStorage, getOwnedStorage } = createCtx({
      deletingViewerTokenIdentifiers: ["user-1"],
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "ready",
          storageId,
        }),
      ],
      ownedStorage: [
        {
          _id: "accountOwnedStorage-1" as Id<"accountOwnedStorage">,
          viewerTokenIdentifier: "user-1",
          storageId,
          kind: "personal_playlist_episode",
          parentId: String(episodeId),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });

    await expect(
      completeViewerPlaylistEpisodeForCtx(ctx, {
        episodeId,
        owner: "worker-a",
        storageId,
        durationSeconds: 120,
        byteLength: 12_000,
        ttsCacheKey: "voice-a",
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voiceId: "sage",
        promptVersion: "v1",
        ttsNormVersion: "v1",
        narrationHash,
        viewerTokenIdentifier: "user-1",
      }),
    ).resolves.toEqual({ completed: false });

    expect(deleteStorage).toHaveBeenCalledWith(storageId);
    expect(getOwnedStorage()).toEqual([]);
  });

  it("binds combined-upload registration to the current unexpired lease", async () => {
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const { ctx, deleteStorage, getOwnedStorage } = createCtx({
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "running",
          leaseOwner: "worker-current",
          leaseExpiresAt: Date.now() + 60_000,
        }),
      ],
    });

    await expect(
      invokeRegistered(registerViewerPlaylistEpisodeStorageInternal, ctx, {
        episodeId,
        viewerTokenIdentifier: "user-1",
        owner: "worker-stale",
        storageId: "stale-upload" as Id<"_storage">,
      }),
    ).resolves.toEqual({ registered: false });
    expect(deleteStorage).toHaveBeenCalledWith("stale-upload");
    expect(getOwnedStorage()).toEqual([]);

    await expect(
      invokeRegistered(registerViewerPlaylistEpisodeStorageInternal, ctx, {
        episodeId,
        viewerTokenIdentifier: "user-1",
        owner: "worker-current",
        storageId: "current-upload" as Id<"_storage">,
      }),
    ).resolves.toEqual({ registered: true });
    expect(getOwnedStorage()).toEqual([
      expect.objectContaining({
        viewerTokenIdentifier: "user-1",
        storageId: "current-upload",
        parentId: String(episodeId),
      }),
    ]);

    vi.advanceTimersByTime(60_001);
    await expect(
      invokeRegistered(registerViewerPlaylistEpisodeStorageInternal, ctx, {
        episodeId,
        viewerTokenIdentifier: "user-1",
        owner: "worker-current",
        storageId: "expired-upload" as Id<"_storage">,
      }),
    ).resolves.toEqual({ registered: false });
    expect(deleteStorage).toHaveBeenCalledWith("expired-upload");
  });

  it("rejects an account-owned upload without the exact storage marker", async () => {
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const { ctx, deleteStorage, getOwnedStorage } = createCtx({
      storageContentTypes: { "unmarked-upload": "audio/mpeg" },
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "running",
          leaseOwner: "worker-current",
          leaseExpiresAt: Date.now() + 60_000,
        }),
      ],
    });

    await expect(
      invokeRegistered(registerViewerPlaylistEpisodeStorageInternal, ctx, {
        episodeId,
        viewerTokenIdentifier: "user-1",
        owner: "worker-current",
        storageId: "unmarked-upload" as Id<"_storage">,
      }),
    ).resolves.toEqual({ registered: false });

    expect(deleteStorage).toHaveBeenCalledWith("unmarked-upload");
    expect(getOwnedStorage()).toEqual([]);
  });

  it("discards unattached audio without deleting the episode's published blob", async () => {
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const currentStorageId = "current-storage" as Id<"_storage">;
    const { ctx, deleteStorage } = createCtx({
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "ready",
          storageId: currentStorageId,
        }),
      ],
    });

    await expect(
      invokeRegistered(discardViewerPlaylistEpisodeStorageInternal, ctx, {
        episodeId,
        viewerTokenIdentifier: "user-1",
        storageId: currentStorageId,
      }),
    ).resolves.toEqual({ discarded: false, referenced: true });
    expect(deleteStorage).not.toHaveBeenCalled();

    await expect(
      invokeRegistered(discardViewerPlaylistEpisodeStorageInternal, ctx, {
        episodeId,
        viewerTokenIdentifier: "user-1",
        storageId: "unattached-storage" as Id<"_storage">,
      }),
    ).resolves.toEqual({ discarded: true, referenced: false });
    expect(deleteStorage).toHaveBeenCalledWith("unattached-storage");
  });

  it("reclaims an expired running episode and rejects the stale owner", async () => {
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const { ctx, getEpisodes } = createCtx({
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "running",
          stage: "rendering_audio",
          leaseOwner: "worker-a",
          leaseExpiresAt: Date.now() + 30_000,
        }),
      ],
    });

    await expect(
      markViewerPlaylistEpisodeRunningForCtx(ctx, {
        episodeId,
        owner: "worker-b",
      }),
    ).resolves.toEqual({ claimed: false, viewerTokenIdentifier: "user-1" });

    vi.advanceTimersByTime(30_001);
    await expect(
      markViewerPlaylistEpisodeRunningForCtx(ctx, {
        episodeId,
        owner: "worker-b",
      }),
    ).resolves.toEqual({ claimed: true, viewerTokenIdentifier: "user-1" });
    await expect(
      updateViewerPlaylistEpisodeProgressForCtx(ctx, {
        episodeId,
        owner: "worker-a",
        completedSectionCount: 1,
        sectionCount: 2,
        stage: "packaging",
      }),
    ).resolves.toEqual({ updated: false });
    await expect(
      failViewerPlaylistEpisodeForCtx(ctx, {
        episodeId,
        owner: "worker-a",
        lastError: "stale worker",
      }),
    ).resolves.toEqual({ failed: false });
    await expect(
      completeViewerPlaylistEpisodeForCtx(ctx, {
        episodeId,
        owner: "worker-a",
        storageId: "storage-1" as Id<"_storage">,
        durationSeconds: 120,
        byteLength: 12_000,
        ttsCacheKey: "tts-key",
        provider: "edge",
        model: "edge-tts",
        voiceId: "voice-1",
        promptVersion: "prompt-1",
        ttsNormVersion: "norm-1",
        narrationHash,
      }),
    ).resolves.toEqual({ completed: false });

    await expect(
      updateViewerPlaylistEpisodeProgressForCtx(ctx, {
        episodeId,
        owner: "worker-b",
        completedSectionCount: 1,
        sectionCount: 2,
        stage: "packaging",
      }),
    ).resolves.toEqual({ updated: true });
    expect(getEpisodes()[0]).toMatchObject({
      status: "running",
      leaseOwner: "worker-b",
      leaseExpiresAt: Date.now() + PERSONAL_PLAYLIST_LEASE_MS,
    });
  });

  it("requires lease ownership for progress and failure, then permits retry", async () => {
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const { ctx, getEpisodes } = createCtx({
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "running",
          stage: "rendering_audio",
          sectionCount: 4,
          completedSectionCount: 1,
          leaseOwner: "worker-a",
          leaseExpiresAt: Date.now() + 60_000,
        }),
      ],
    });

    await expect(
      updateViewerPlaylistEpisodeProgressForCtx(ctx, {
        episodeId,
        owner: "worker-b",
        completedSectionCount: 2,
        sectionCount: 4,
        stage: "packaging",
      }),
    ).resolves.toEqual({ updated: false });
    await expect(
      updateViewerPlaylistEpisodeProgressForCtx(ctx, {
        episodeId,
        owner: "worker-a",
        completedSectionCount: 4,
        sectionCount: 4,
        stage: "packaging",
      }),
    ).resolves.toEqual({ updated: true });
    await expect(
      failViewerPlaylistEpisodeForCtx(ctx, {
        episodeId,
        owner: "worker-b",
        lastError: "wrong owner",
      }),
    ).resolves.toEqual({ failed: false });
    await expect(
      failViewerPlaylistEpisodeForCtx(ctx, {
        episodeId,
        owner: "worker-a",
        lastError: "transient failure",
      }),
    ).resolves.toEqual({ failed: true });

    expect(getEpisodes()[0]).toMatchObject({
      status: "failed",
      completedSectionCount: 4,
      lastError: "transient failure",
      leaseOwner: undefined,
    });
    await expect(
      retryViewerPlaylistEpisodeForCtx(ctx, {
        viewerTokenIdentifier: "user-2",
        episodeId,
      }),
    ).resolves.toEqual({ queued: false });
    await expect(
      retryViewerPlaylistEpisodeForCtx(ctx, {
        viewerTokenIdentifier: "user-1",
        episodeId,
        requestedTtsMetadata: refreshedTtsMetadata,
      }),
    ).resolves.toEqual({ queued: true });
    expect(getEpisodes()[0]).toMatchObject({
      status: "queued",
      stage: "queued",
      completedSectionCount: 0,
      lastError: undefined,
      requestedTtsMetadata: refreshedTtsMetadata,
    });
  });

  it("applies the active cap while preserving one unmetered retry", async () => {
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_ACTIVE_LIMIT", "1");
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT", "1");
    const failedId =
      "personalPlaylistEpisodes-failed" as Id<"personalPlaylistEpisodes">;
    const quota = {
      _id: "routeQuotas-user-1" as Id<"routeQuotas">,
      key: "personal-playlist:openai:daily:user-1",
      count: 1,
      windowStart: Date.now(),
      expiresAt: Date.now() + 60_000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const failedEpisode = buildEpisode({
      _id: failedId,
      articleId: "article-1" as Id<"articles">,
      slug: "mars",
      title: "Mars",
      status: "failed",
      lastError: "transient failure",
    });
    const { ctx: blockedCtx, getEpisodes: getBlockedEpisodes } = createCtx({
      episodes: [
        failedEpisode,
        buildEpisode({
          _id: "personalPlaylistEpisodes-active" as Id<"personalPlaylistEpisodes">,
          articleId: "article-2" as Id<"articles">,
          slug: "venus",
          title: "Venus",
          status: "queued",
          position: 1,
        }),
      ],
      quotas: [quota],
    });

    await expect(
      retryViewerPlaylistEpisodeForCtx(blockedCtx, {
        viewerTokenIdentifier: "user-1",
        episodeId: failedId,
      }),
    ).rejects.toThrow(
      "Personal Playlist queue is full. Wait for an episode to finish before adding another.",
    );
    expect(
      getBlockedEpisodes().find((episode) => episode._id === failedId),
    ).toMatchObject({ status: "failed" });

    const { ctx, getEpisodes, getQuotas } = createCtx({
      episodes: [failedEpisode],
      quotas: [quota],
    });
    await expect(
      retryViewerPlaylistEpisodeForCtx(ctx, {
        viewerTokenIdentifier: "user-1",
        episodeId: failedId,
      }),
    ).resolves.toEqual({ queued: true });
    expect(getQuotas()[0]).toMatchObject({ count: 1 });
    expect(getEpisodes()[0]).toMatchObject({ generationRetryCount: 1 });
  });

  it("charges retries after the first rerun against the daily allowance", async () => {
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT", "2");
    const episodeId =
      "personalPlaylistEpisodes-failed" as Id<"personalPlaylistEpisodes">;
    const { ctx, getEpisodes, getQuotas } = createCtx({
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "failed",
          sectionCount: 4,
          lastError: "transient failure",
        }),
      ],
      quotas: [
        {
          _id: "routeQuotas-user-1" as Id<"routeQuotas">,
          key: "personal-playlist:openai:daily:user-1",
          count: 1,
          windowStart: Date.now(),
          expiresAt: Date.now() + 60_000,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
    });

    await expect(
      retryViewerPlaylistEpisodeForCtx(ctx, {
        viewerTokenIdentifier: "user-1",
        episodeId,
      }),
    ).resolves.toEqual({ queued: true });
    expect(getQuotas()[0]).toMatchObject({ count: 1 });

    await expect(
      markViewerPlaylistEpisodeRunningForCtx(ctx, {
        episodeId,
        owner: "worker-a",
      }),
    ).resolves.toMatchObject({ claimed: true });
    await expect(
      failViewerPlaylistEpisodeForCtx(ctx, {
        episodeId,
        owner: "worker-a",
        lastError: "failed again",
      }),
    ).resolves.toEqual({ failed: true });
    await expect(
      retryViewerPlaylistEpisodeForCtx(ctx, {
        viewerTokenIdentifier: "user-1",
        episodeId,
      }),
    ).resolves.toEqual({ queued: true });
    expect(getQuotas()[0]).toMatchObject({ count: 2 });
    expect(getEpisodes()[0]).toMatchObject({ generationRetryCount: 2 });

    await markViewerPlaylistEpisodeRunningForCtx(ctx, {
      episodeId,
      owner: "worker-b",
    });
    await failViewerPlaylistEpisodeForCtx(ctx, {
      episodeId,
      owner: "worker-b",
      lastError: "failed a third time",
    });

    await expect(
      retryViewerPlaylistEpisodeForCtx(ctx, {
        viewerTokenIdentifier: "user-1",
        episodeId,
      }),
    ).rejects.toThrow("Personal Playlist generation limit reached.");
    expect(getQuotas()[0]).toMatchObject({ count: 2 });
    expect(getEpisodes()[0]).toMatchObject({
      status: "failed",
      generationRetryCount: 2,
      lastError: "failed a third time",
    });
  });

  it("does not meter repeated retries for an episode with no narratable tracks", async () => {
    vi.stubEnv("PERSONAL_PLAYLIST_OPENAI_DAILY_LIMIT", "1");

    const exerciseRetries = async (seedQuotaCount?: number) => {
      const episodeId =
        `personalPlaylistEpisodes-empty-${seedQuotaCount ?? "none"}` as Id<"personalPlaylistEpisodes">;
      const { ctx, getEpisodes, getQuotas } = createCtx({
        episodes: [
          buildEpisode({
            _id: episodeId,
            articleId: "article-empty" as Id<"articles">,
            slug: "empty",
            title: "Empty article",
            status: "failed",
            sectionCount: 0,
            lastError: "Article does not contain any narratable source tracks.",
          }),
        ],
        quotas:
          seedQuotaCount == null
            ? []
            : [
                {
                  _id: `routeQuotas-${seedQuotaCount}` as Id<"routeQuotas">,
                  key: "personal-playlist:openai:daily:user-1",
                  count: seedQuotaCount,
                  windowStart: Date.now(),
                  expiresAt: Date.now() + 60_000,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                },
              ],
      });

      for (let attempt = 1; attempt <= 3; attempt += 1) {
        await expect(
          retryViewerPlaylistEpisodeForCtx(ctx, {
            viewerTokenIdentifier: "user-1",
            episodeId,
          }),
        ).resolves.toEqual({ queued: true });
        await expect(
          markViewerPlaylistEpisodeRunningForCtx(ctx, {
            episodeId,
            owner: `worker-${attempt}`,
          }),
        ).resolves.toMatchObject({ claimed: true });
        await expect(
          failViewerPlaylistEpisodeForCtx(ctx, {
            episodeId,
            owner: `worker-${attempt}`,
            lastError: "Still no narratable tracks.",
          }),
        ).resolves.toEqual({ failed: true });
      }

      expect(getEpisodes()[0]).toMatchObject({
        status: "failed",
        sectionCount: 0,
        generationRetryCount: 3,
      });
      return getQuotas();
    };

    await expect(exerciseRetries()).resolves.toEqual([]);
    await expect(exerciseRetries(1)).resolves.toEqual([
      expect.objectContaining({ count: 1 }),
    ]);
  });

  it("meters later retries when a legacy episode has no section count", async () => {
    const episodeId =
      "personalPlaylistEpisodes-legacy" as Id<"personalPlaylistEpisodes">;
    const { ctx, getQuotas } = createCtx({
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-legacy" as Id<"articles">,
          slug: "legacy",
          title: "Legacy article",
          status: "failed",
          generationRetryCount: 1,
          lastError: "Legacy generation failed.",
        }),
      ],
    });

    await expect(
      retryViewerPlaylistEpisodeForCtx(ctx, {
        viewerTokenIdentifier: "user-1",
        episodeId,
      }),
    ).resolves.toEqual({ queued: true });
    expect(getQuotas()).toEqual([
      expect.objectContaining({
        key: "personal-playlist:openai:daily:user-1",
        count: 1,
      }),
    ]);
  });

  it("completes only for the lease owner and records the generated audio variant", async () => {
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const { ctx, getEpisodes } = createCtx({
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "running",
          stage: "packaging",
          sectionCount: 4,
          completedSectionCount: 3,
          leaseOwner: "worker-a",
          leaseExpiresAt: Date.now() + 60_000,
        }),
      ],
    });
    const completion = {
      episodeId,
      storageId: "storage-1" as Id<"_storage">,
      durationSeconds: 120,
      byteLength: 12_000,
      ttsCacheKey: "tts-key",
      provider: "edge",
      model: "edge-tts",
      voiceId: "voice-1",
      promptVersion: "prompt-1",
      ttsNormVersion: "norm-1",
      narrationHash,
    };

    await expect(
      completeViewerPlaylistEpisodeForCtx(ctx, {
        ...completion,
        owner: "worker-b",
      }),
    ).resolves.toEqual({ completed: false });
    await expect(
      completeViewerPlaylistEpisodeForCtx(ctx, {
        ...completion,
        owner: "worker-a",
      }),
    ).resolves.toEqual({ completed: true });

    expect(getEpisodes()[0]).toMatchObject({
      status: "ready",
      stage: undefined,
      storageId: "storage-1",
      durationSeconds: 120,
      completedSectionCount: 4,
      leaseOwner: undefined,
    });
    expect(getEpisodes()[0].audioVariants).toEqual([
      expect.objectContaining({
        storageId: "storage-1",
        ttsCacheKey: "tts-key",
      }),
    ]);
  });

  it("deletes only the audio variant superseded by a successful completion", async () => {
    const episodeId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const { ctx, deleteStorage, getEpisodes } = createCtx({
      episodes: [
        buildEpisode({
          _id: episodeId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          status: "running",
          stage: "packaging",
          leaseOwner: "worker-a",
          leaseExpiresAt: Date.now() + 60_000,
          storageId: "voice-a-old" as Id<"_storage">,
          audioVariants: [
            {
              storageId: "voice-a-old",
              ttsCacheKey: "voice-a",
              provider: "openai",
              model: "gpt-4o-mini-tts",
              voiceId: "sage",
              promptVersion: "v1",
              ttsNormVersion: "v1",
              createdAt: 1,
            },
            {
              storageId: "voice-b-keep",
              ttsCacheKey: "voice-b",
              provider: "openai",
              model: "gpt-4o-mini-tts",
              voiceId: "cedar",
              promptVersion: "v1",
              ttsNormVersion: "v1",
              createdAt: 1,
            },
          ],
        }),
      ],
    });

    await expect(
      completeViewerPlaylistEpisodeForCtx(ctx, {
        episodeId,
        owner: "worker-a",
        storageId: "voice-a-new" as Id<"_storage">,
        durationSeconds: 120,
        byteLength: 12_000,
        ttsCacheKey: "voice-a",
        provider: "openai",
        model: "gpt-4o-mini-tts",
        voiceId: "sage",
        promptVersion: "v1",
        ttsNormVersion: "v1",
        narrationHash,
      }),
    ).resolves.toEqual({ completed: true });

    expect(deleteStorage).toHaveBeenCalledOnce();
    expect(deleteStorage).toHaveBeenCalledWith("voice-a-old");
    expect(getEpisodes()[0].audioVariants).toEqual([
      expect.objectContaining({ storageId: "voice-b-keep" }),
      expect.objectContaining({ storageId: "voice-a-new" }),
    ]);
  });

  it("selects the next queued episode in queue order while honoring exclusions", async () => {
    const firstId =
      "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const secondId =
      "personalPlaylistEpisodes-2" as Id<"personalPlaylistEpisodes">;
    const { ctx } = createCtx({
      episodes: [
        buildEpisode({
          _id: secondId,
          articleId: "article-2" as Id<"articles">,
          slug: "venus",
          title: "Venus",
          position: 1,
        }),
        buildEpisode({
          _id: firstId,
          articleId: "article-1" as Id<"articles">,
          slug: "mars",
          title: "Mars",
          position: 0,
        }),
      ],
    });

    await expect(
      getNextQueuedEpisodeForViewerForCtx(ctx, {
        viewerTokenIdentifier: "user-1",
      }),
    ).resolves.toMatchObject({ _id: firstId });
    await expect(
      getNextQueuedEpisodeForViewerForCtx(ctx, {
        viewerTokenIdentifier: "user-1",
        excludeEpisodeId: firstId,
      }),
    ).resolves.toMatchObject({ _id: secondId });
  });
});
