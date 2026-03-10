import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
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

export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ exportId: string }> },
) => {
  const { exportId } = await params;

  try {
    const articleExport = (await fetchQuery(
      anyApi.articleExports.getArticleAudioExportById,
      {
        exportId: exportId as Id<"articleAudioExports">,
      },
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

    if (isPodcastDownloadRequest(req)) {
      return await createPodcastAttachmentResponse({
        audioUrl: articleExport.audioUrl,
        title: articleExport.title,
        fallbackFilename: "article-audio-export.mp3",
      });
    }

    return NextResponse.redirect(articleExport.audioUrl, {
      status: 307,
      headers: {
        "Cache-Control": PODCAST_MEDIA_CACHE_CONTROL,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to resolve article audio export",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};

export const HEAD = GET;
