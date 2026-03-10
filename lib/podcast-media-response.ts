import { NextRequest, NextResponse } from "next/server";

export const PODCAST_MEDIA_CACHE_CONTROL =
  "public, max-age=300, s-maxage=300, stale-while-revalidate=900";

const sanitizeFilenamePart = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const isPodcastDownloadRequest = (request: NextRequest): boolean =>
  request.nextUrl.searchParams.get("download") === "1";

export const buildPodcastDownloadFilename = (
  title: string,
  fallback: string,
): string => {
  const sanitized = sanitizeFilenamePart(title);
  const baseName = sanitized || fallback;
  return baseName.toLowerCase().endsWith(".mp3") ? baseName : `${baseName}.mp3`;
};

export const createPodcastAttachmentResponse = async ({
  audioUrl,
  title,
  fallbackFilename,
}: {
  audioUrl: string;
  title: string;
  fallbackFilename: string;
}): Promise<NextResponse> => {
  const upstream = await fetch(audioUrl, { cache: "no-store" });

  if (!upstream.ok || !upstream.body) {
    throw new Error(`Podcast audio fetch failed: ${upstream.status}`);
  }

  const headers = new Headers({
    "Cache-Control": PODCAST_MEDIA_CACHE_CONTROL,
    "Content-Disposition": `attachment; filename="${buildPodcastDownloadFilename(title, fallbackFilename)}"`,
    "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
  });

  const contentLength = upstream.headers.get("Content-Length");
  if (contentLength) {
    headers.set("Content-Length", contentLength);
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers,
  });
};
