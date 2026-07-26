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
});
