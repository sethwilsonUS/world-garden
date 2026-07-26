import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  createPodcastAttachmentResponse,
  isPodcastDownloadRequest,
  PODCAST_MEDIA_CACHE_CONTROL,
} from "@/lib/podcast-media-response";

type ArticleAudioExport = Doc<"articleAudioExports"> & {
  audioUrl: string | null;
};

const getConvexAuthOptions = async (): Promise<
  { token: string } | Record<string, never>
> => {
  try {
    const session = await auth();
    if (!session.userId) return {};
    const token = await session.getToken({ template: "convex" });
    return token ? { token } : {};
  } catch {
    return {};
  }
};

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ exportId: string }> },
) => {
  const { exportId } = await params;

  try {
    const storedIdentity = (await fetchQuery(
      anyApi.articleExports.getArticleAudioExportDownloadIdentity,
      {
        exportId,
      },
    )) as {
      exportId: Id<"articleAudioExports">;
      ttsCacheKey: string;
    } | null;
    if (!storedIdentity) {
      return NextResponse.json(
        { error: "Article audio export not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const convexAuthOptions = await getConvexAuthOptions();
    const articleExport = (await fetchQuery(
      anyApi.articleExports.getArticleAudioExportById,
      {
        exportId: storedIdentity.exportId,
        ttsCacheKey: storedIdentity.ttsCacheKey,
      },
      convexAuthOptions,
    )) as ArticleAudioExport | null;

    if (
      !articleExport ||
      articleExport.status !== "ready" ||
      !articleExport.audioUrl
    ) {
      return NextResponse.json(
        { error: "Article audio export not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const cacheControl =
      articleExport.ttsProvider === "edge"
        ? PODCAST_MEDIA_CACHE_CONTROL
        : "private, no-store";

    if (isPodcastDownloadRequest(req)) {
      return await createPodcastAttachmentResponse({
        audioUrl: articleExport.audioUrl,
        title: articleExport.title,
        fallbackFilename: "article-audio-export.mp3",
        cacheControl,
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
