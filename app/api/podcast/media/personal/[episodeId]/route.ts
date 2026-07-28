import { anyApi } from "convex/server";
import { fetchMutation } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import {
  createPodcastAttachmentResponse,
  createPodcastInlineResponse,
  isPodcastDownloadRequest,
} from "@/lib/podcast-media-response";
import { createPersonalFeedMediaReadAttestation } from "@/lib/personal-feed-media-attestation";
import { isValidPersonalFeedToken } from "@/lib/personal-feed-token";
import {
  applyPersonalPodcastPrivateHeaders,
  PERSONAL_PODCAST_CACHE_CONTROL,
  PERSONAL_PODCAST_PRIVATE_HEADERS,
} from "@/lib/personal-podcast-response";
import { withPromiseTimeout } from "@/lib/promise-timeout";

type PersonalPlaylistEpisode = {
  title: string;
  audioUrl: string;
};

const PERSONAL_PODCAST_MEDIA_UPSTREAM_TIMEOUT_MS = 15_000;
const PERSONAL_PODCAST_CONVEX_TIMEOUT_MS = 5_000;

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ episodeId: string }> },
) => {
  const { episodeId } = await params;
  const feedToken = req.nextUrl.searchParams.get("token");

  if (!feedToken || !isValidPersonalFeedToken(feedToken)) {
    return NextResponse.json(
      { error: "Podcast episode not found" },
      { status: 404, headers: PERSONAL_PODCAST_PRIVATE_HEADERS },
    );
  }

  try {
    const attestation = await createPersonalFeedMediaReadAttestation({
      feedToken,
      episodeId,
    });
    const episode = (await withPromiseTimeout(
      fetchMutation(anyApi.personalPlaylist.getEpisodeForPersonalFeedServer, {
        feedToken,
        episodeId,
        attestation,
      }),
      {
        timeoutMs: PERSONAL_PODCAST_CONVEX_TIMEOUT_MS,
        message: "Personal podcast authorization timed out",
      },
    )) as PersonalPlaylistEpisode | null;

    if (!episode) {
      return NextResponse.json(
        { error: "Podcast episode not found" },
        { status: 404, headers: PERSONAL_PODCAST_PRIVATE_HEADERS },
      );
    }

    const response = isPodcastDownloadRequest(req)
      ? await createPodcastAttachmentResponse({
          audioUrl: episode.audioUrl,
          title: episode.title,
          fallbackFilename: "personal-playlist-episode.mp3",
          cacheControl: PERSONAL_PODCAST_CACHE_CONTROL,
          request: req,
          upstreamTimeoutMs: PERSONAL_PODCAST_MEDIA_UPSTREAM_TIMEOUT_MS,
        })
      : await createPodcastInlineResponse({
          audioUrl: episode.audioUrl,
          cacheControl: PERSONAL_PODCAST_CACHE_CONTROL,
          request: req,
          upstreamTimeoutMs: PERSONAL_PODCAST_MEDIA_UPSTREAM_TIMEOUT_MS,
        });
    applyPersonalPodcastPrivateHeaders(response.headers);
    return response;
  } catch (error) {
    console.error(
      "[personal-podcast-media] Private episode request failed.",
      { episodeId },
      error,
    );
    return NextResponse.json(
      { error: "Personal podcast audio is unavailable" },
      { status: 500, headers: PERSONAL_PODCAST_PRIVATE_HEADERS },
    );
  }
};

export const HEAD = GET;
