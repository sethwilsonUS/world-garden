import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Id } from "./_generated/dataModel";
import {
  listViewerPlaylistEpisodesForCtx,
  moveViewerPlaylistEpisodeForCtx,
  removeViewerPlaylistEpisodeForCtx,
  upsertViewerPlaylistEpisodeForCtx,
} from "./personalPlaylist";
import {
  completeViewerPlaylistEpisodeForCtx,
  failViewerPlaylistEpisodeForCtx,
  getNextQueuedEpisodeForViewerForCtx,
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
  ttsCacheKey?: string;
  provider?: string;
  model?: string;
  voiceId?: string;
  promptVersion?: string;
  ttsNormVersion?: string;
  audioVariants?: unknown;
  lastError?: string;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
};

const buildEpisode = (
  overrides: Partial<EpisodeDoc> & Pick<EpisodeDoc, "_id" | "articleId" | "slug" | "title">,
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
}) => {
  let feeds = [...(seed?.feeds ?? [])];
  let episodes = [...(seed?.episodes ?? [])];
  let idCounter = feeds.length + episodes.length;

  const matchesFilters = (
    doc: Record<string, unknown>,
    filters: Array<[string, unknown]>,
  ) =>
    filters.every(([field, value]) => doc[field] === value);

  const ctx = {
      db: {
        query: (tableName: "personalPodcastFeeds" | "personalPlaylistEpisodes") => ({
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
            const docs = tableName === "personalPodcastFeeds" ? feeds : episodes;
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
          tableName: "personalPodcastFeeds" | "personalPlaylistEpisodes",
          value: Omit<FeedDoc, "_id"> | Omit<EpisodeDoc, "_id">,
        ) => {
          idCounter += 1;
          const id = `${tableName}-${idCounter}` as never;
          if (tableName === "personalPodcastFeeds") {
            feeds.push({ _id: id, ...(value as Omit<FeedDoc, "_id">) });
          } else {
            episodes.push({ _id: id, ...(value as Omit<EpisodeDoc, "_id">) });
          }
          return id;
        },
        patch: async (id: string, value: Partial<FeedDoc & EpisodeDoc>) => {
          feeds = feeds.map((doc) => (doc._id === id ? { ...doc, ...value } : doc));
          episodes = episodes.map((doc) =>
            doc._id === id ? { ...doc, ...value } : doc,
          );
        },
        get: async (id: string) => {
          return (
            episodes.find((doc) => doc._id === id) ??
            feeds.find((doc) => doc._id === id) ??
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
  };
};

describe("personal playlist data helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T18:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
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
    };

    const first = await upsertViewerPlaylistEpisodeForCtx(ctx, args);
    const second = await upsertViewerPlaylistEpisodeForCtx(ctx, args);

    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
    expect(getEpisodes()).toHaveLength(1);
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
    };

    const first = await upsertViewerPlaylistEpisodeForCtx(ctx, args);
    await removeViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      episodeId: first.episodeId,
    });

    let visible = await listViewerPlaylistEpisodesForCtx(ctx, "user-1");
    expect(visible).toEqual([]);

    const restored = await upsertViewerPlaylistEpisodeForCtx(ctx, args);
    visible = await listViewerPlaylistEpisodesForCtx(ctx, "user-1");

    expect(restored.episodeId).toBe(first.episodeId);
    expect(restored.status).toBe("queued");
    expect(restored.shouldSchedule).toBe(true);
    expect(getEpisodes()).toHaveLength(1);
    expect(visible).toHaveLength(1);
    expect(visible[0]._id).toBe(first.episodeId);
    expect(visible[0].status).toBe("queued");
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
    });
    vi.advanceTimersByTime(1_000);
    const second = await upsertViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      articleId: "article-2" as Id<"articles">,
      wikiPageId: "wiki-2",
      slug: "venus",
      title: "Venus",
      sectionCount: 5,
    });

    await moveViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      episodeId: second.episodeId,
      direction: "up",
    });

    const ordered = getEpisodes().sort((left, right) => left.position - right.position);
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
    const targetId = "personalPlaylistEpisodes-2" as Id<"personalPlaylistEpisodes">;
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

    expect(getEpisodes().find((episode) => episode._id === targetId)).toMatchObject({
      status: "running",
      stage: "rendering_audio",
      leaseOwner: "worker-b",
      leaseExpiresAt: Date.now() + 8 * 60 * 1_000,
    });
  });

  it("requires lease ownership for progress and failure, then permits retry", async () => {
    const episodeId = "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
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
      }),
    ).resolves.toEqual({ queued: true });
    expect(getEpisodes()[0]).toMatchObject({
      status: "queued",
      stage: "queued",
      completedSectionCount: 0,
      lastError: undefined,
    });
  });

  it("completes only for the lease owner and records the generated audio variant", async () => {
    const episodeId = "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
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
      expect.objectContaining({ storageId: "storage-1", ttsCacheKey: "tts-key" }),
    ]);
  });

  it("selects the next queued episode in queue order while honoring exclusions", async () => {
    const firstId = "personalPlaylistEpisodes-1" as Id<"personalPlaylistEpisodes">;
    const secondId = "personalPlaylistEpisodes-2" as Id<"personalPlaylistEpisodes">;
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
