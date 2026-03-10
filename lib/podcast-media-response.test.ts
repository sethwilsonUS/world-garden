import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildPodcastDownloadFilename,
  createPodcastAttachmentResponse,
  isPodcastDownloadRequest,
} from "@/lib/podcast-media-response";

describe("buildPodcastDownloadFilename", () => {
  it("adds an mp3 extension when missing", () => {
    expect(buildPodcastDownloadFilename("Featured Article", "fallback.mp3")).toBe(
      "Featured Article.mp3",
    );
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
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Featured Article.mp3"',
    );
    expect(response.headers.get("Content-Type")).toBe("audio/mpeg");
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(await response.text()).toBe("audio-data");
  });
});
