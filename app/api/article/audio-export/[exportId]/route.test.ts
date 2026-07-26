import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchQuery: mocks.fetchQuery,
}));

import { GET } from "./route";

describe("article audio export download route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resolves a ready export with the profile identity stored on that export", async () => {
    mocks.fetchQuery
      .mockResolvedValueOnce({
        exportId: "export-1",
        ttsCacheKey:
          "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2",
      })
      .mockResolvedValueOnce({
        _id: "export-1",
        title: "An Unexpected Journey",
        status: "ready",
        audioUrl: "https://cdn.example.com/export-1.mp3",
      });

    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/article/audio-export/export-1",
      ),
      { params: Promise.resolve({ exportId: "export-1" }) },
    );

    expect(mocks.fetchQuery).toHaveBeenCalledTimes(2);
    expect(mocks.fetchQuery.mock.calls[0]?.[1]).toEqual({
      exportId: "export-1",
    });
    expect(mocks.fetchQuery.mock.calls[1]?.[1]).toEqual({
      exportId: "export-1",
      ttsCacheKey: "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2",
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://cdn.example.com/export-1.mp3",
    );
  });

  it("returns 404 without a second lookup when a malformed ID cannot be normalized", async () => {
    mocks.fetchQuery.mockResolvedValueOnce(null);

    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/article/audio-export/not-a-convex-id",
      ),
      { params: Promise.resolve({ exportId: "not-a-convex-id" }) },
    );

    expect(mocks.fetchQuery).toHaveBeenCalledOnce();
    expect(mocks.fetchQuery).toHaveBeenCalledWith(expect.anything(), {
      exportId: "not-a-convex-id",
    });
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Article audio export not found",
    });
  });

  it("returns a safe no-store error without leaking backend details", async () => {
    mocks.fetchQuery.mockRejectedValueOnce(
      new Error("Secret Convex deployment details"),
    );

    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/article/audio-export/backend-failure",
      ),
      { params: Promise.resolve({ exportId: "backend-failure" }) },
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Failed to resolve article audio export",
    });
  });
});
