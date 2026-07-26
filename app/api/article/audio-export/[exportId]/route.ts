import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { createArticleAudioExportReadAttestation } from "@/lib/article-audio-export-attestation";
import {
  createPodcastAttachmentResponse,
  createPodcastInlineResponse,
  isPodcastDownloadRequest,
  PODCAST_MEDIA_CACHE_CONTROL,
} from "@/lib/podcast-media-response";

type ArticleAudioExport = {
  _id: Id<"articleAudioExports">;
  title: string;
  status: string;
  ttsProvider: "edge" | "openai";
  audioUrl: string | null;
};

type ArticleAudioExportIdentity = {
  exportId: Id<"articleAudioExports">;
  ttsCacheKey: string;
  ttsProvider: "edge" | "openai";
};

const PRIVATE_MEDIA_CACHE_CONTROL = "private, no-store";

const notFoundResponse = () =>
  NextResponse.json(
    { error: "Article audio export not found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );

const getConvexAuthOptions = async (): Promise<
  { token: string } | Record<string, never>
> => {
  try {
    const session = await auth();
    if (!session.userId) return {};
    const token = await session.getToken({ template: "convex" });
    return token ? { token } : {};
  } catch (error) {
    console.warn(
      "[article-audio-export] Convex auth token unavailable",
      error instanceof Error ? error.message : "Unknown authentication error",
    );
    return {};
  }
};

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ exportId: string }> },
) => {
  const { exportId } = await params;

  try {
    const convexAuthOptions = await getConvexAuthOptions();
    const storedIdentity = (await fetchQuery(
      anyApi.articleExports.getArticleAudioExportDownloadIdentity,
      {
        exportId,
      },
      convexAuthOptions,
    )) as ArticleAudioExportIdentity | null;
    if (!storedIdentity) {
      return notFoundResponse();
    }

    let articleExport: ArticleAudioExport | null;
    if (storedIdentity.ttsProvider === "edge") {
      articleExport = (await fetchQuery(
        anyApi.articleExports.getArticleAudioExportById,
        {
          exportId: storedIdentity.exportId,
          ttsCacheKey: storedIdentity.ttsCacheKey,
        },
        convexAuthOptions,
      )) as ArticleAudioExport | null;
    } else if (
      storedIdentity.ttsProvider === "openai" &&
      "token" in convexAuthOptions
    ) {
      const attestation = await createArticleAudioExportReadAttestation({
        exportId: storedIdentity.exportId,
        ttsCacheKey: storedIdentity.ttsCacheKey,
      });
      articleExport = (await fetchMutation(
        anyApi.articleExports.getArticleAudioExportForServer,
        {
          exportId: storedIdentity.exportId,
          ttsCacheKey: storedIdentity.ttsCacheKey,
          attestation,
        },
        convexAuthOptions,
      )) as ArticleAudioExport | null;
    } else {
      return notFoundResponse();
    }

    if (
      !articleExport ||
      articleExport.status !== "ready" ||
      !articleExport.audioUrl ||
      articleExport.ttsProvider !== storedIdentity.ttsProvider
    ) {
      return notFoundResponse();
    }

    const cacheControl =
      articleExport.ttsProvider === "edge"
        ? PODCAST_MEDIA_CACHE_CONTROL
        : PRIVATE_MEDIA_CACHE_CONTROL;

    if (isPodcastDownloadRequest(req)) {
      return await createPodcastAttachmentResponse({
        audioUrl: articleExport.audioUrl,
        title: articleExport.title,
        fallbackFilename: "article-audio-export.mp3",
        cacheControl,
        request: req,
      });
    }

    if (articleExport.ttsProvider === "openai") {
      return await createPodcastInlineResponse({
        audioUrl: articleExport.audioUrl,
        cacheControl,
        request: req,
      });
    }

    return NextResponse.redirect(articleExport.audioUrl, {
      status: 307,
      headers: {
        "Cache-Control": cacheControl,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to resolve article audio export" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const HEAD = GET;
