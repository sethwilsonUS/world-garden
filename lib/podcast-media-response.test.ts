import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildPodcastDownloadFilename,
  createPodcastAttachmentResponse,
  createPodcastInlineResponse,
  isPodcastDownloadRequest,
} from "@/lib/podcast-media-response";

describe("buildPodcastDownloadFilename", () => {
  it("adds an mp3 extension when missing", () => {
    expect(
      buildPodcastDownloadFilename("Featured Article", "fallback.mp3"),
    ).toBe("Featured Article.mp3");
  });

  it("removes unsafe filename characters", () => {
    expect(buildPodcastDownloadFilename('A/B:C*D?"', "fallback.mp3")).toBe(
      "ABCD.mp3",
    );
  });

  it("falls back when the title sanitizes to empty", () => {
    expect(buildPodcastDownloadFilename("////", "fallback.mp3")).toBe(
      "fallback.mp3",
    );
  });
});

describe("isPodcastDownloadRequest", () => {
  it("returns true when the download flag is present", () => {
    const request = new NextRequest("https://example.com/audio?download=1");
    expect(isPodcastDownloadRequest(request)).toBe(true);
  });

  it("returns false when the download flag is absent", () => {
    const request = new NextRequest("https://example.com/audio");
    expect(isPodcastDownloadRequest(request)).toBe(false);
  });
});

describe("createPodcastAttachmentResponse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an attachment response with audio headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("audio-data", {
        headers: {
          "Content-Length": "10",
          "Content-Type": "audio/mpeg",
        },
      }),
    );

    const response = await createPodcastAttachmentResponse({
      audioUrl: "https://example.com/audio.mp3",
      title: "Featured Article",
      fallbackFilename: "fallback.mp3",
      request: new NextRequest("https://example.com/download?download=1"),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Featured Article.mp3"',
    );
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.headers.get("Vary")).toBe("Range");
    expect(await response.text()).toBe("audio-data");
  });

  it("supports private cache policy for authenticated audio downloads", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("audio-data", {
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );

    const response = await createPodcastAttachmentResponse({
      audioUrl: "https://example.com/private-audio.mp3",
      title: "Private Article",
      fallbackFilename: "fallback.mp3",
      cacheControl: "private, no-store",
      request: new NextRequest("https://example.com/download?download=1"),
    });

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("proxies private inline audio and forwards only the byte range", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("partial-audio", {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "13",
          "Content-Range": "bytes 10-22/100",
          "Content-Type": "audio/mpeg",
        },
      }),
    );
    const request = new NextRequest("https://example.com/private-audio", {
      headers: {
        Authorization: "Bearer never-forward-this",
        Cookie: "session=never-forward-this",
        Range: "bytes=10-",
      },
    });

    const response = await createPodcastInlineResponse({
      audioUrl: "https://storage.example/private.mp3",
      cacheControl: "private, no-store",
      request,
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Range")).toBe("bytes 10-22/100");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Location")).toBeNull();
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(await response.text()).toBe("partial-audio");

    const [, init] = fetchSpy.mock.calls[0];
    expect(init).toEqual(
      expect.objectContaining({ cache: "no-store", method: "GET" }),
    );
    const forwardedHeaders = new Headers(init?.headers);
    expect(forwardedHeaders.get("Range")).toBe("bytes=10-");
    expect(forwardedHeaders.get("Authorization")).toBeNull();
    expect(forwardedHeaders.get("Cookie")).toBeNull();
  });

  it("proxies private HEAD requests without a response body", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        headers: {
          "Content-Length": "100",
          "Content-Type": "audio/mpeg",
        },
      }),
    );

    const response = await createPodcastInlineResponse({
      audioUrl: "https://storage.example/private.mp3",
      cacheControl: "private, no-store",
      request: new NextRequest("https://example.com/private-audio", {
        method: "HEAD",
      }),
    });

    expect(response.body).toBeNull();
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("preserves an unsatisfiable range response without caching it", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, {
        status: 416,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Range": "bytes */100",
        },
      }),
    );

    const response = await createPodcastInlineResponse({
      audioUrl: "https://storage.example/private.mp3",
      cacheControl: "private, no-store",
      request: new NextRequest("https://example.com/private-audio", {
        headers: { Range: "bytes=500-" },
      }),
    });

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */100");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Range");
  });
});
