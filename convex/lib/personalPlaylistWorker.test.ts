import { afterEach, describe, expect, it, vi } from "vitest";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { processViewerPlaylistEpisodeForCtx } from "./personalPlaylistWorker";

describe("personal playlist worker orchestration", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fails a missing article and schedules the next queued episode", async () => {
    const episodeId = "episode-1" as Id<"personalPlaylistEpisodes">;
    const nextEpisodeId = "episode-2" as Id<"personalPlaylistEpisodes">;
    const articleId = "article-1" as Id<"articles">;
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: episodeId,
        articleId,
        slug: "mars",
        status: "queued",
      })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: nextEpisodeId });
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        claimed: true,
        viewerTokenIdentifier: "user-1",
      })
      .mockResolvedValueOnce({ failed: true });
    const runAfter = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runQuery,
      runMutation,
      scheduler: { runAfter },
    } as unknown as ActionCtx;
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );

    await processViewerPlaylistEpisodeForCtx(ctx, {
      episodeId,
      baseUrl: "https://example.com",
    });

    expect(runMutation).toHaveBeenNthCalledWith(
      2,
      internal.personalPlaylist.failViewerPlaylistEpisodeInternal,
      {
        episodeId,
        owner: "00000000-0000-4000-8000-000000000001",
        lastError: "Article not found.",
      },
    );
    expect(runAfter).toHaveBeenCalledWith(
      0,
      internal.personalPlaylist.processViewerPlaylistEpisode,
      {
        episodeId: nextEpisodeId,
        baseUrl: "https://example.com",
      },
    );
  });

  it("does not schedule work when the episode lease cannot be claimed", async () => {
    const episodeId = "episode-1" as Id<"personalPlaylistEpisodes">;
    const runQuery = vi.fn().mockResolvedValue({
      _id: episodeId,
      articleId: "article-1" as Id<"articles">,
      slug: "mars",
      status: "queued",
    });
    const runMutation = vi.fn().mockResolvedValue({
      claimed: false,
      viewerTokenIdentifier: "user-1",
    });
    const runAfter = vi.fn();
    const ctx = {
      runQuery,
      runMutation,
      scheduler: { runAfter },
    } as unknown as ActionCtx;

    await processViewerPlaylistEpisodeForCtx(ctx, {
      episodeId,
      baseUrl: "https://example.com",
    });

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runAfter).not.toHaveBeenCalled();
  });
});
