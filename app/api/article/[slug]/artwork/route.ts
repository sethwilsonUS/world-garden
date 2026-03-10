import { NextRequest } from "next/server";
import { renderArticleAudioArtworkResponse } from "@/lib/article-audio-artwork";
import { fetchWikiSummary, slugToTitle } from "@/lib/wiki-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 3600;

export const GET = async (
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) => {
  const { slug } = await params;

  const fallbackTitle = slugToTitle(slug);
  const article = await fetchWikiSummary(slug);

  const response = await renderArticleAudioArtworkResponse({
    title: article?.title || fallbackTitle,
    summary: article?.extract || "",
    imageUrl: article?.thumbnailUrl,
  });

  response.headers.set(
    "Cache-Control",
    "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
  );
  return response;
};
