import { afterEach, describe, expect, it, vi } from "vitest";
import * as ttsClient from "../../lib/tts-client";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { getTtsMetadata, getTtsProfile } from "../../lib/tts-profile";
import { PERSONAL_PLAYLIST_LEASE_MS } from "./personalPlaylistPersistence";
import { processViewerPlaylistEpisodeForCtx } from "./personalPlaylistWorker";

describe("personal playlist worker orchestration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the latest claimed initiating profile when the worker environment differs", async () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "openai");
    vi.stubEnv("OPENAI_TTS_VOICE", "marin");
    vi.stubEnv("AUDIO_GENERATION_BASE_URL", "https://example.com");
    const episodeId = "episode-1" as Id<"personalPlaylistEpisodes">;
    const articleId = "article-1" as Id<"articles">;
    const requestedTtsMetadata = getTtsMetadata(
      getTtsProfile("openai", "cedar"),
    );
    const queuedEpisode = {
      _id: episodeId,
      articleId,
      slug: "Mars",
      title: "Mars",
      status: "queued" as const,
    };
    const claimedEpisode = {
      ...queuedEpisode,
      status: "running" as const,
      leaseOwner: "00000000-0000-4000-8000-000000000001",
      requestedTtsMetadata,
    };
    const article = {
      _id: articleId,
      title: "Mars",
      slug: "Mars",
      revisionId: "100",
      narrationVersion: 2,
      summary:
        "Mars is the fourth planet from the Sun and has a long history of scientific observation.",
      sections: [],
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(queuedEpisode)
      .mockResolvedValueOnce(claimedEpisode)
      .mockResolvedValueOnce(article)
      .mockResolvedValueOnce({ urls: {} })
      .mockResolvedValueOnce(null);
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        claimed: true,
        viewerTokenIdentifier: "user-1",
      })
      .mockResolvedValueOnce({ updated: true })
      .mockResolvedValueOnce("https://upload.test/section")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ updated: true })
      .mockResolvedValueOnce({ updated: true })
      .mockResolvedValueOnce("https://upload.test/combined")
      .mockResolvedValueOnce({ completed: true });
    const runAfter = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runQuery,
      runMutation,
      scheduler: { runAfter },
      storage: {
        getUrl: vi.fn().mockResolvedValue("https://cdn.test/section.mp3"),
      },
    } as unknown as ActionCtx;
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
    const generate = vi
      .spyOn(ttsClient, "generateTtsAudioWithMetadata")
      .mockResolvedValue({
        blob: new Blob([Uint8Array.of(0xff, 0xfb)], { type: "audio/mpeg" }),
        metadata: requestedTtsMetadata,
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://upload.test/section") {
          return Response.json({ storageId: "section-storage" });
        }
        if (url === "https://upload.test/combined") {
          await new Response(init?.body as BodyInit).arrayBuffer();
          return Response.json({ storageId: "combined-storage" });
        }
        if (url === "https://cdn.test/section.mp3") {
          return new Response(Uint8Array.of(0xff, 0xfb), {
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        if (url.endsWith("/api/article/Mars/artwork")) {
          return new Response("not found", { status: 404 });
        }
        throw new Error(`Unexpected fetch request: ${url}`);
      }),
    );

    await processViewerPlaylistEpisodeForCtx(ctx, {
      episodeId,
      baseUrl: "https://attacker.example",
    });

    expect(runQuery.mock.calls[1]?.[1]).toEqual({ episodeId });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        voiceId: "cedar",
        expectedTtsCacheKey: requestedTtsMetadata.ttsCacheKey,
      }),
      expect.objectContaining({ apiBaseUrl: "https://example.com" }),
    );
    const completionArgs = runMutation.mock.calls
      .map(([, callArgs]) => callArgs)
      .find((callArgs) => callArgs?.ttsCacheKey && callArgs?.episodeId);
    expect(completionArgs).toMatchObject({
      episodeId,
      ttsCacheKey: requestedTtsMetadata.ttsCacheKey,
      voiceId: "cedar",
    });
  });

  it("defaults legacy episodes without pinned metadata to OpenAI speech", async () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "edge");
    vi.stubEnv("AUDIO_GENERATION_BASE_URL", "https://example.com");
    const episodeId = "episode-1" as Id<"personalPlaylistEpisodes">;
    const articleId = "article-1" as Id<"articles">;
    const owner = "00000000-0000-4000-8000-000000000001";
    const openAi = getTtsMetadata(getTtsProfile("openai"));
    const queuedEpisode = {
      _id: episodeId,
      articleId,
      slug: "mars",
      title: "Mars",
      status: "queued" as const,
    };
    const claimedEpisode = {
      ...queuedEpisode,
      status: "running" as const,
      leaseOwner: owner,
    };
    const article = {
      _id: articleId,
      title: "Mars",
      slug: "mars",
      revisionId: "100",
      narrationVersion: 2,
      summary:
        "Mars is the fourth planet from the Sun and has a long history of scientific observation.",
      sections: [],
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(queuedEpisode)
      .mockResolvedValueOnce(claimedEpisode)
      .mockResolvedValueOnce(article)
      .mockResolvedValueOnce({ urls: {} })
      .mockResolvedValueOnce(null);
    const runMutation = vi
      .fn()
      .mockResolvedValueOnce({
        claimed: true,
        viewerTokenIdentifier: "user-1",
      })
      .mockResolvedValueOnce({ updated: true })
      .mockResolvedValueOnce("https://upload.test/section")
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ updated: true })
      .mockResolvedValueOnce({ updated: true })
      .mockResolvedValueOnce("https://upload.test/combined")
      .mockResolvedValueOnce({ completed: true });
    const ctx = {
      runQuery,
      runMutation,
      scheduler: { runAfter: vi.fn() },
      storage: {
        getUrl: vi.fn().mockResolvedValue("https://cdn.test/section.mp3"),
      },
    } as unknown as ActionCtx;
    vi.spyOn(crypto, "randomUUID").mockReturnValue(owner);
    const generate = vi
      .spyOn(ttsClient, "generateTtsAudioWithMetadata")
      .mockResolvedValue({
        blob: new Blob([Uint8Array.of(0xff, 0xfb)], { type: "audio/mpeg" }),
        metadata: openAi,
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://upload.test/section") {
          return Response.json({ storageId: "section-storage" });
        }
        if (url === "https://upload.test/combined") {
          await new Response(init?.body as BodyInit).arrayBuffer();
          return Response.json({ storageId: "combined-storage" });
        }
        if (url === "https://cdn.test/section.mp3") {
          return new Response(Uint8Array.of(0xff, 0xfb), {
            headers: { "Content-Type": "audio/mpeg" },
          });
        }
        if (url.endsWith("/api/article/mars/artwork")) {
          return new Response("not found", { status: 404 });
        }
        throw new Error(`Unexpected fetch request: ${url}`);
      }),
    );

    await processViewerPlaylistEpisodeForCtx(ctx, {
      episodeId,
      baseUrl: "https://attacker.example",
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openai",
        expectedTtsCacheKey: openAi.ttsCacheKey,
      }),
      expect.objectContaining({ apiBaseUrl: "https://example.com" }),
    );
    expect(runMutation).toHaveBeenCalledWith(
      internal.personalPlaylist.completeViewerPlaylistEpisodeInternal,
      expect.objectContaining({
        episodeId,
        provider: "openai",
        ttsCacheKey: openAi.ttsCacheKey,
      }),
    );
  });

  it("fails a missing article and schedules the next queued episode", async () => {
    const episodeId = "episode-1" as Id<"personalPlaylistEpisodes">;
    const nextEpisodeId = "episode-2" as Id<"personalPlaylistEpisodes">;
    const articleId = "article-1" as Id<"articles">;
    const queuedEpisode = {
      _id: episodeId,
      articleId,
      slug: "mars",
      status: "queued",
    };
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce(queuedEpisode)
      .mockResolvedValueOnce({
        ...queuedEpisode,
        status: "running",
        leaseOwner: "00000000-0000-4000-8000-000000000001",
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
      },
    );
  });

  it("retries the episode after lease contention", async () => {
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
    expect(runAfter).toHaveBeenCalledWith(
      PERSONAL_PLAYLIST_LEASE_MS,
      internal.personalPlaylist.processViewerPlaylistEpisode,
      {
        episodeId,
      },
    );
  });

  it("schedules a watchdog and the next episode when failure persistence throws", async () => {
    const episodeId = "episode-1" as Id<"personalPlaylistEpisodes">;
    const nextEpisodeId = "episode-2" as Id<"personalPlaylistEpisodes">;
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce({
        _id: episodeId,
        articleId: "article-1" as Id<"articles">,
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
      .mockRejectedValueOnce(new Error("persistence unavailable"));
    const runAfter = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      runQuery,
      runMutation,
      scheduler: { runAfter },
    } as unknown as ActionCtx;

    await processViewerPlaylistEpisodeForCtx(ctx, {
      episodeId,
      baseUrl: "https://example.com",
    });

    expect(runAfter).toHaveBeenNthCalledWith(
      1,
      PERSONAL_PLAYLIST_LEASE_MS,
      internal.personalPlaylist.processViewerPlaylistEpisode,
      {
        episodeId,
      },
    );
    expect(runAfter).toHaveBeenNthCalledWith(
      2,
      0,
      internal.personalPlaylist.processViewerPlaylistEpisode,
      {
        episodeId: nextEpisodeId,
      },
    );
  });
});
