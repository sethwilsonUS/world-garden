import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Id } from "./_generated/dataModel";
import { type TtsMetadata } from "../lib/tts-profile";
import {
  addViewerPlaylistEpisodeBySlug,
  listViewerPlaylistEpisodesForCtx,
  moveViewerPlaylistEpisodeForCtx,
  removeViewerPlaylistEpisodeForCtx,
  retryViewerPlaylistEpisode,
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

type FeedDoc = {
  _id: Id<"personalPodcastFeeds">;
  viewerTokenIdentifier: string;
  feedToken: string;
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
  feeds?: FeedDoc[];
  episodes?: EpisodeDoc[];
  quotas?: QuotaDoc[];
}) => {
  let feeds = [...(seed?.feeds ?? [])];
  let episodes = [...(seed?.episodes ?? [])];
  let quotas = [...(seed?.quotas ?? [])];
  let idCounter = feeds.length + episodes.length + quotas.length;

  const matchesFilters = (
    doc: Record<string, unknown>,
    filters: Array<[string, unknown]>,
  ) => filters.every(([field, value]) => doc[field] === value);

  const ctx = {
    db: {
      query: (
        tableName:
          | "personalPodcastFeeds"
          | "personalPlaylistEpisodes"
          | "routeQuotas",
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
              : tableName === "personalPlaylistEpisodes"
                ? episodes
                : quotas;
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
          | "routeQuotas",
        value:
          | Omit<FeedDoc, "_id">
          | Omit<EpisodeDoc, "_id">
          | Omit<QuotaDoc, "_id">,
      ) => {
        idCounter += 1;
        const id = `${tableName}-${idCounter}` as never;
        if (tableName === "personalPodcastFeeds") {
          feeds.push({ _id: id, ...(value as Omit<FeedDoc, "_id">) });
        } else if (tableName === "personalPlaylistEpisodes") {
          episodes.push({ _id: id, ...(value as Omit<EpisodeDoc, "_id">) });
        } else {
          quotas.push({ _id: id, ...(value as Omit<QuotaDoc, "_id">) });
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
      },
      get: async (id: string) => {
        return (
          episodes.find((doc) => doc._id === id) ??
          feeds.find((doc) => doc._id === id) ??
          quotas.find((doc) => doc._id === id) ??
          null
        );
      },
    },
    storage: {
      getUrl: async (storageId: Id<"_storage">) =>
        `https://cdn.example.com/${storageId}.mp3`,
    },
  } as unknown as PersonalPlaylistMutationCtx;

  return {
    ctx,
    getFeeds: () => feeds,
    getEpisodes: () => episodes,
    getQuotas: () => quotas,
  };
};

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
    expect(visible[0].requestedTtsMetadata).toEqual(refreshedTtsMetadata);
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
    const { ctx } = createCtx({
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
          status: "ready",
          storageId: "storage-1" as Id<"_storage">,
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
    expect(visible[0]).toMatchObject({
      slug: "mars",
      audioUrl: "https://cdn.example.com/storage-1.mp3",
    });
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

  it("applies the active cap to retries without charging the daily allowance again", async () => {
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

    const { ctx, getQuotas } = createCtx({
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
