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

const createPodcastMediaProxyResponse = async ({
  audioUrl,
  cacheControl,
  request,
  contentDisposition,
}: {
  audioUrl: string;
  cacheControl: string;
  request: NextRequest;
  contentDisposition?: string;
}): Promise<NextResponse> => {
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const upstreamRequestHeaders = new Headers();
  const requestedRange = request.headers.get("Range");
  if (requestedRange) upstreamRequestHeaders.set("Range", requestedRange);

  const upstream = await fetch(audioUrl, {
    cache: "no-store",
    method,
    headers: upstreamRequestHeaders,
  });

  const isRangeNotSatisfiable = upstream.status === 416;
  if (
    (!upstream.ok && !isRangeNotSatisfiable) ||
    (method !== "HEAD" && !upstream.body && !isRangeNotSatisfiable)
  ) {
    throw new Error(`Podcast audio fetch failed: ${upstream.status}`);
  }

  const headers = new Headers({
    "Cache-Control": isRangeNotSatisfiable
      ? "private, no-store"
      : cacheControl,
    "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg",
    Vary: "Range",
  });
  if (contentDisposition) {
    headers.set("Content-Disposition", contentDisposition);
  }
  for (const name of ["Accept-Ranges", "Content-Length", "Content-Range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new NextResponse(method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
};

export const createPodcastInlineResponse = async ({
  audioUrl,
  cacheControl,
  request,
}: {
  audioUrl: string;
  cacheControl: string;
  request: NextRequest;
}): Promise<NextResponse> =>
  await createPodcastMediaProxyResponse({ audioUrl, cacheControl, request });

export const createPodcastAttachmentResponse = async ({
  audioUrl,
  title,
  fallbackFilename,
  cacheControl = PODCAST_MEDIA_CACHE_CONTROL,
  request,
}: {
  audioUrl: string;
  title: string;
  fallbackFilename: string;
  cacheControl?: string;
  request: NextRequest;
}): Promise<NextResponse> => {
  return await createPodcastMediaProxyResponse({
    audioUrl,
    cacheControl,
    request,
    contentDisposition: `attachment; filename="${buildPodcastDownloadFilename(title, fallbackFilename)}"`,
  });
};
