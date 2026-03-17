import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Id } from "./_generated/dataModel";
import {
  listViewerPlaylistEpisodesForCtx,
  moveViewerPlaylistEpisodeForCtx,
  removeViewerPlaylistEpisodeForCtx,
  upsertViewerPlaylistEpisodeForCtx,
} from "./personalPlaylist";

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
  storageId?: Id<"_storage">;
  durationSeconds?: number;
  byteLength?: number;
  lastError?: string;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
};

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

  return {
    ctx: {
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
    },
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
    };

    const first = await upsertViewerPlaylistEpisodeForCtx(ctx, args);
    const second = await upsertViewerPlaylistEpisodeForCtx(ctx, args);

    expect(first.added).toBe(true);
    expect(second.added).toBe(false);
    expect(getEpisodes()).toHaveLength(1);
  });

  it("soft-removes and later restores the same episode record", async () => {
    const { ctx, getEpisodes } = createCtx();
    const args = {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "mars",
      title: "Mars",
      description: "Planet article",
      imageUrl: "https://images.example.com/mars.jpg",
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
    expect(getEpisodes()).toHaveLength(1);
    expect(visible).toHaveLength(1);
    expect(visible[0]._id).toBe(first.episodeId);
  });

  it("rewrites queue position and synthetic publishedAt when moved", async () => {
    const { ctx, getEpisodes } = createCtx();

    await upsertViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      articleId: "article-1" as Id<"articles">,
      wikiPageId: "wiki-1",
      slug: "mars",
      title: "Mars",
    });
    vi.advanceTimersByTime(1_000);
    const second = await upsertViewerPlaylistEpisodeForCtx(ctx, {
      viewerTokenIdentifier: "user-1",
      articleId: "article-2" as Id<"articles">,
      wikiPageId: "wiki-2",
      slug: "venus",
      title: "Venus",
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
});
