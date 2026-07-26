import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createAttestation: vi.fn(),
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("convex/nextjs", () => ({
  fetchMutation: mocks.fetchMutation,
  fetchQuery: mocks.fetchQuery,
}));
vi.mock("@/lib/article-audio-export-attestation", () => ({
  createArticleAudioExportReadAttestation: mocks.createAttestation,
}));

import { GET } from "./route";

const EDGE_TTS_CACHE_KEY =
  "tts:edge:edge-tts:en-US-AriaNeural:edge-default:ttsNorm:3";
const OPENAI_TTS_CACHE_KEY =
  "tts:openai:gpt-4o-mini-tts:marin:curio-warm-narrator-v1:ttsNorm:3";
const ATTESTATION = {
  issuedAt: 1,
  expiresAt: 2,
  nonce: "nonce",
  signature: "signature",
};

const request = (
  exportId = "export-1",
  init?: ConstructorParameters<typeof NextRequest>[1],
) =>
  new NextRequest(
    `https://curiogarden.org/api/article/audio-export/${exportId}`,
    init,
  );
const context = (exportId = "export-1") => ({
  params: Promise.resolve({ exportId }),
});

const mockReadyEdgeExport = () => {
  mocks.fetchQuery
    .mockResolvedValueOnce({
      exportId: "export-1",
      ttsCacheKey: EDGE_TTS_CACHE_KEY,
      ttsProvider: "edge",
    })
    .mockResolvedValueOnce({
      _id: "export-1",
      title: "An Unexpected Journey",
      status: "ready",
      ttsProvider: "edge",
      audioUrl: "https://cdn.example.com/export-1.mp3",
    });
};

const mockReadyOpenAiExport = () => {
  mocks.fetchQuery.mockResolvedValueOnce({
    exportId: "export-1",
    ttsCacheKey: OPENAI_TTS_CACHE_KEY,
    ttsProvider: "openai",
  });
  mocks.fetchMutation.mockResolvedValueOnce({
    _id: "export-1",
    title: "An Unexpected Journey",
    status: "ready",
    ttsProvider: "openai",
    audioUrl: "https://storage.example.com/private-export.mp3",
  });
};

describe("article audio export download route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({
      userId: null,
      getToken: mocks.getToken,
    });
    mocks.createAttestation.mockResolvedValue(ATTESTATION);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps a guest Edge stream anonymous and publicly cacheable", async () => {
    mockReadyEdgeExport();

    const response = await GET(request(), context());

    expect(mocks.fetchQuery).toHaveBeenCalledTimes(2);
    expect(mocks.fetchQuery.mock.calls[0]?.slice(1)).toEqual([
      { exportId: "export-1" },
      {},
    ]);
    expect(mocks.fetchQuery.mock.calls[1]?.slice(1)).toEqual([
      { exportId: "export-1", ttsCacheKey: EDGE_TTS_CACHE_KEY },
      {},
    ]);
    expect(mocks.getToken).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://cdn.example.com/export-1.mp3",
    );
    expect(response.headers.get("cache-control")).toContain("public");
  });

  it("proxies signed-in OpenAI media privately without exposing its storage URL", async () => {
    mocks.auth.mockResolvedValue({
      userId: "user-1",
      getToken: mocks.getToken,
    });
    mocks.getToken.mockResolvedValue("convex-jwt");
    mockReadyOpenAiExport();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("private-audio", {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "13",
          "Content-Range": "bytes 10-22/100",
          "Content-Type": "audio/mpeg",
        },
      }),
    );

    const response = await GET(
      request("export-1", {
        headers: {
          Authorization: "Bearer never-forward-this",
          Cookie: "session=never-forward-this",
          Range: "bytes=10-",
        },
      }),
      context(),
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-range")).toBe("bytes 10-22/100");
    expect(await response.text()).toBe("private-audio");
    expect(mocks.getToken).toHaveBeenCalledWith({ template: "convex" });
    expect(mocks.fetchQuery).toHaveBeenCalledTimes(1);
    expect(mocks.fetchQuery.mock.calls[0]?.slice(1)).toEqual([
      { exportId: "export-1" },
      { token: "convex-jwt" },
    ]);
    expect(mocks.createAttestation).toHaveBeenCalledWith({
      exportId: "export-1",
      ttsCacheKey: OPENAI_TTS_CACHE_KEY,
    });
    expect(mocks.fetchMutation.mock.calls[0]?.slice(1)).toEqual([
      {
        exportId: "export-1",
        ttsCacheKey: OPENAI_TTS_CACHE_KEY,
        attestation: ATTESTATION,
      },
      { token: "convex-jwt" },
    ]);

    const [upstreamUrl, upstreamInit] = fetchSpy.mock.calls[0] ?? [];
    expect(upstreamUrl).toBe("https://storage.example.com/private-export.mp3");
    expect(upstreamInit).toEqual(
      expect.objectContaining({ cache: "no-store", method: "GET" }),
    );
    const upstreamHeaders = new Headers(upstreamInit?.headers);
    expect(upstreamHeaders.get("range")).toBe("bytes=10-");
    expect(upstreamHeaders.get("authorization")).toBeNull();
    expect(upstreamHeaders.get("cookie")).toBeNull();
  });

  it("proxies signed-in OpenAI downloads as private attachments", async () => {
    mocks.auth.mockResolvedValue({
      userId: "user-1",
      getToken: mocks.getToken,
    });
    mocks.getToken.mockResolvedValue("convex-jwt");
    mockReadyOpenAiExport();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("private-audio", {
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );

    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/article/audio-export/export-1?download=1",
      ),
      context(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="An Unexpected Journey.mp3"',
    );
  });

  it("fails closed when Convex token resolution fails for a signed-in user", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.auth.mockResolvedValue({
      userId: "user-1",
      getToken: mocks.getToken,
    });
    mocks.getToken.mockRejectedValue(new Error("Convex token unavailable"));
    mocks.fetchQuery.mockResolvedValueOnce(null);

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(mocks.fetchQuery.mock.calls[0]?.slice(1)).toEqual([
      { exportId: "export-1" },
      {},
    ]);
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(
      "[article-audio-export] Convex auth token unavailable",
      "Convex token unavailable",
    );
  });

  it("rejects an OpenAI identity when no authenticated token is available", async () => {
    mocks.fetchQuery.mockResolvedValueOnce({
      exportId: "export-1",
      ttsCacheKey: OPENAI_TTS_CACHE_KEY,
      ttsProvider: "openai",
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(mocks.createAttestation).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });

  it("returns 404 without a second lookup for a malformed ID", async () => {
    mocks.fetchQuery.mockResolvedValueOnce(null);

    const response = await GET(
      request("not-a-convex-id"),
      context("not-a-convex-id"),
    );

    expect(mocks.fetchQuery).toHaveBeenCalledOnce();
    expect(mocks.fetchQuery.mock.calls[0]?.slice(1)).toEqual([
      { exportId: "not-a-convex-id" },
      {},
    ]);
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
