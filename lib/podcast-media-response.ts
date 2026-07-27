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
  upstreamTimeoutMs,
}: {
  audioUrl: string;
  cacheControl: string;
  request: NextRequest;
  contentDisposition?: string;
  upstreamTimeoutMs?: number;
}): Promise<NextResponse> => {
  const method = request.method === "HEAD" ? "HEAD" : "GET";
  const upstreamRequestHeaders = new Headers();
  const requestedRange = request.headers.get("Range");
  if (requestedRange) upstreamRequestHeaders.set("Range", requestedRange);

  const timeoutController =
    upstreamTimeoutMs != null &&
    Number.isFinite(upstreamTimeoutMs) &&
    upstreamTimeoutMs > 0
      ? new AbortController()
      : null;
  const timeoutHandle = timeoutController
    ? setTimeout(() => timeoutController.abort(), upstreamTimeoutMs)
    : null;
  let upstream: Response;
  try {
    upstream = await fetch(audioUrl, {
      cache: "no-store",
      method,
      headers: upstreamRequestHeaders,
      ...(timeoutController ? { signal: timeoutController.signal } : {}),
    });
  } finally {
    // Bound the upstream handshake without cutting off the streamed audio body
    // after its response headers have arrived.
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
  }

  const isRangeNotSatisfiable = upstream.status === 416;
  if (
    (!upstream.ok && !isRangeNotSatisfiable) ||
    (method !== "HEAD" && !upstream.body && !isRangeNotSatisfiable)
  ) {
    throw new Error(`Podcast audio fetch failed: ${upstream.status}`);
  }

  const headers = new Headers({
    "Cache-Control": isRangeNotSatisfiable ? "private, no-store" : cacheControl,
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
  upstreamTimeoutMs,
}: {
  audioUrl: string;
  cacheControl: string;
  request: NextRequest;
  upstreamTimeoutMs?: number;
}): Promise<NextResponse> =>
  await createPodcastMediaProxyResponse({
    audioUrl,
    cacheControl,
    request,
    upstreamTimeoutMs,
  });

export const createPodcastAttachmentResponse = async ({
  audioUrl,
  title,
  fallbackFilename,
  cacheControl = PODCAST_MEDIA_CACHE_CONTROL,
  request,
  upstreamTimeoutMs,
}: {
  audioUrl: string;
  title: string;
  fallbackFilename: string;
  cacheControl?: string;
  request: NextRequest;
  upstreamTimeoutMs?: number;
}): Promise<NextResponse> => {
  return await createPodcastMediaProxyResponse({
    audioUrl,
    cacheControl,
    request,
    upstreamTimeoutMs,
    contentDisposition: `attachment; filename="${buildPodcastDownloadFilename(title, fallbackFilename)}"`,
  });
};
