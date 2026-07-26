import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  fetchQuery: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("convex/nextjs", () => ({ fetchQuery: mocks.fetchQuery }));

import { GET } from "./route";

const EDGE_TTS_CACHE_KEY =
  "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:2";
const request = (exportId = "export-1") =>
  new NextRequest(
    `https://curiogarden.org/api/article/audio-export/${exportId}`,
  );
const context = (exportId = "export-1") => ({
  params: Promise.resolve({ exportId }),
});

const mockReadyExport = (ttsProvider: "edge" | "openai") => {
  mocks.fetchQuery
    .mockResolvedValueOnce({
      exportId: "export-1",
      ttsCacheKey: EDGE_TTS_CACHE_KEY,
    })
    .mockResolvedValueOnce({
      _id: "export-1",
      title: "An Unexpected Journey",
      status: "ready",
      ttsProvider,
      audioUrl: "https://cdn.example.com/export-1.mp3",
    });
};

describe("article audio export download route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({
      userId: null,
      getToken: mocks.getToken,
    });
  });

  it("keeps a guest Edge download anonymous and resolves its stored profile", async () => {
    mockReadyExport("edge");

    const response = await GET(request(), context());

    expect(mocks.fetchQuery).toHaveBeenCalledTimes(2);
    expect(mocks.fetchQuery.mock.calls[0]?.slice(1)).toEqual([
      { exportId: "export-1" },
    ]);
    expect(mocks.fetchQuery.mock.calls[1]?.slice(1)).toEqual([
      { exportId: "export-1", ttsCacheKey: EDGE_TTS_CACHE_KEY },
      {},
    ]);
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://cdn.example.com/export-1.mp3",
    );
    expect(response.headers.get("cache-control")).toContain("public");
  });

  it("forwards the signed-in Convex token and keeps OpenAI media private", async () => {
    mocks.auth.mockResolvedValue({
      userId: "user-1",
      getToken: mocks.getToken,
    });
    mocks.getToken.mockResolvedValue("convex-jwt");
    mockReadyExport("openai");

    const response = await GET(request(), context());

    expect(response.status).toBe(307);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getToken).toHaveBeenCalledWith({ template: "convex" });
    expect(mocks.fetchQuery.mock.calls[1]?.slice(1)).toEqual([
      { exportId: "export-1", ttsCacheKey: EDGE_TTS_CACHE_KEY },
      { token: "convex-jwt" },
    ]);
  });

  it("fails closed to anonymous access when Clerk token resolution fails", async () => {
    mocks.auth.mockRejectedValue(new Error("Clerk unavailable"));
    mockReadyExport("edge");

    await GET(request(), context());

    expect(mocks.fetchQuery.mock.calls[1]?.slice(1)).toEqual([
      { exportId: "export-1", ttsCacheKey: EDGE_TTS_CACHE_KEY },
      {},
    ]);
  });

  it("returns 404 without auth or a second lookup for a malformed ID", async () => {
    mocks.fetchQuery.mockResolvedValueOnce(null);

    const response = await GET(
      request("not-a-convex-id"),
      context("not-a-convex-id"),
    );

    expect(mocks.fetchQuery).toHaveBeenCalledOnce();
    expect(mocks.fetchQuery).toHaveBeenCalledWith(expect.anything(), {
      exportId: "not-a-convex-id",
    });
    expect(mocks.auth).not.toHaveBeenCalled();
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
      request("backend-failure"),
      context("backend-failure"),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Failed to resolve article audio export",
    });
  });
});
