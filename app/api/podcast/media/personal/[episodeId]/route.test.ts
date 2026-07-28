import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMutation = vi.fn();
const createPersonalFeedMediaReadAttestation = vi.fn();
const upstreamFetch = vi.fn();
const VALID_FEED_TOKEN = "f".repeat(64);
const ATTESTATION = {
  issuedAt: 1,
  expiresAt: 2,
  nonce: "nonce",
  signature: "a".repeat(64),
};

const expectPrivateMediaHeaders = (response: Response) => {
  expect(response.headers.get("Cache-Control")).toBe(
    "private, no-store, max-age=0",
  );
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("X-Robots-Tag")).toBe(
    "noindex, nofollow, noarchive",
  );
  expect(response.headers.get("Location")).toBeNull();
};

vi.mock("convex/nextjs", () => ({
  fetchMutation,
}));

vi.mock("@/lib/personal-feed-media-attestation", () => ({
  createPersonalFeedMediaReadAttestation,
}));

describe("GET /api/podcast/media/personal/[episodeId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", upstreamFetch);
    createPersonalFeedMediaReadAttestation.mockResolvedValue(ATTESTATION);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns 404 when the token does not match an accessible episode", async () => {
    fetchMutation.mockResolvedValue(null);

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        "https://curiogarden.org/api/podcast/media/personal/episode-1?token=bad-token",
      ),
      { params: Promise.resolve({ episodeId: "episode-1" }) },
    );

    expect(response.status).toBe(404);
    expectPrivateMediaHeaders(response);
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(createPersonalFeedMediaReadAttestation).not.toHaveBeenCalled();
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("does not trim whitespace around a bearer token", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/media/personal/episode-1?token=%20${VALID_FEED_TOKEN}%20`,
      ),
      { params: Promise.resolve({ episodeId: "episode-1" }) },
    );

    expect(response.status).toBe(404);
    expectPrivateMediaHeaders(response);
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(createPersonalFeedMediaReadAttestation).not.toHaveBeenCalled();
  });

  it("proxies stored audio privately without exposing its permanent URL", async () => {
    fetchMutation.mockResolvedValue({
      title: "Mars",
      audioUrl: "https://cdn.example.com/mars.mp3",
    });
    upstreamFetch.mockResolvedValue(
      new Response("audio", {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "5",
          "Content-Type": "audio/mpeg",
        },
      }),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/media/personal/episode-1?token=${VALID_FEED_TOKEN}`,
      ),
      { params: Promise.resolve({ episodeId: "episode-1" }) },
    );

    expect(response.status).toBe(200);
    expectPrivateMediaHeaders(response);
    expect(await response.text()).toBe("audio");
    expect(createPersonalFeedMediaReadAttestation).toHaveBeenCalledWith({
      feedToken: VALID_FEED_TOKEN,
      episodeId: "episode-1",
    });
    expect(fetchMutation).toHaveBeenCalledWith(expect.anything(), {
      feedToken: VALID_FEED_TOKEN,
      episodeId: "episode-1",
      attestation: ATTESTATION,
    });
    const [upstreamUrl, upstreamOptions] = upstreamFetch.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(upstreamUrl).toBe("https://cdn.example.com/mars.mp3");
    expect(upstreamOptions.method).toBe("GET");
    expect(upstreamOptions.signal).toBeInstanceOf(AbortSignal);
    expect(upstreamOptions.signal?.aborted).toBe(false);
    const upstreamHeaders = upstreamOptions.headers as Headers;
    expect(upstreamHeaders.get("Authorization")).toBeNull();
    expect(upstreamHeaders.get("Cookie")).toBeNull();
  });

  it("authorizes and proxies HEAD requests without a response body", async () => {
    fetchMutation.mockResolvedValue({
      title: "Mars",
      audioUrl: "https://cdn.example.com/mars.mp3",
    });
    upstreamFetch.mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "100",
          "Content-Type": "audio/mpeg",
        },
      }),
    );

    const { HEAD } = await import("./route");
    const response = await HEAD(
      new NextRequest(
        `https://curiogarden.org/api/podcast/media/personal/episode-1?token=${VALID_FEED_TOKEN}`,
        { method: "HEAD" },
      ),
      { params: Promise.resolve({ episodeId: "episode-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(response.headers.get("Content-Length")).toBe("100");
    expectPrivateMediaHeaders(response);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
    expect(upstreamFetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "HEAD" }),
    );
  });

  it("serves explicit downloads through the same private no-store proxy", async () => {
    fetchMutation.mockResolvedValue({
      title: "Mars: The Red Planet",
      audioUrl: "https://cdn.example.com/mars.mp3",
    });
    upstreamFetch.mockResolvedValue(
      new Response("audio", {
        status: 200,
        headers: {
          "Content-Length": "5",
          "Content-Type": "audio/mpeg",
        },
      }),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/media/personal/episode-1?token=${VALID_FEED_TOKEN}&download=1`,
      ),
      { params: Promise.resolve({ episodeId: "episode-1" }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Mars The Red Planet.mp3"',
    );
    expect(await response.text()).toBe("audio");
    expectPrivateMediaHeaders(response);
  });

  it("forwards byte ranges through the private proxy", async () => {
    fetchMutation.mockResolvedValue({
      title: "Mars",
      audioUrl: "https://cdn.example.com/mars.mp3",
    });
    upstreamFetch.mockResolvedValue(
      new Response("part", {
        status: 206,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": "4",
          "Content-Range": "bytes 10-13/100",
          "Content-Type": "audio/mpeg",
        },
      }),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/media/personal/episode-1?token=${VALID_FEED_TOKEN}`,
        {
          headers: {
            Authorization: "Bearer never-forward-this",
            Cookie: "session=never-forward-this",
            Range: "bytes=10-13",
            "X-Request-Debug": "never-forward-this",
          },
        },
      ),
      { params: Promise.resolve({ episodeId: "episode-1" }) },
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 10-13/100");
    expectPrivateMediaHeaders(response);
    const upstreamHeaders = upstreamFetch.mock.calls[0]?.[1]
      ?.headers as Headers;
    expect(Array.from(upstreamHeaders.entries())).toEqual([
      ["range", "bytes=10-13"],
    ]);
  });

  it("rechecks the token before every request and skips storage after revocation", async () => {
    fetchMutation
      .mockResolvedValueOnce({
        title: "Mars",
        audioUrl: "https://cdn.example.com/mars.mp3",
      })
      .mockResolvedValueOnce(null);
    upstreamFetch.mockResolvedValueOnce(
      new Response("audio", {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );

    const { GET } = await import("./route");
    const requestUrl = `https://curiogarden.org/api/podcast/media/personal/episode-1?token=${VALID_FEED_TOKEN}`;
    const routeContext = {
      params: Promise.resolve({ episodeId: "episode-1" }),
    };
    const beforeRevocation = await GET(
      new NextRequest(requestUrl),
      routeContext,
    );
    const afterRevocation = await GET(
      new NextRequest(requestUrl),
      routeContext,
    );

    expect(beforeRevocation.status).toBe(200);
    expectPrivateMediaHeaders(beforeRevocation);
    expect(afterRevocation.status).toBe(404);
    expect(await afterRevocation.json()).toEqual({
      error: "Podcast episode not found",
    });
    expectPrivateMediaHeaders(afterRevocation);
    expect(fetchMutation).toHaveBeenCalledTimes(2);
    expect(createPersonalFeedMediaReadAttestation).toHaveBeenCalledTimes(2);
    expect(upstreamFetch).toHaveBeenCalledTimes(1);
  });

  it("does not expose backend failures", async () => {
    fetchMutation.mockRejectedValue(
      new Error("Convex deployment and storage internals"),
    );

    const { GET } = await import("./route");
    const response = await GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/media/personal/episode-1?token=${VALID_FEED_TOKEN}`,
      ),
      { params: Promise.resolve({ episodeId: "episode-1" }) },
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Personal podcast audio is unavailable");
    expect(body).not.toContain("Convex deployment");
    expectPrivateMediaHeaders(response);
  });

  it("fails closed when the Convex authorization lookup stalls", async () => {
    vi.useFakeTimers();
    fetchMutation.mockImplementation(() => new Promise(() => {}));

    const { GET } = await import("./route");
    const responsePromise = GET(
      new NextRequest(
        `https://curiogarden.org/api/podcast/media/personal/episode-1?token=${VALID_FEED_TOKEN}`,
      ),
      { params: Promise.resolve({ episodeId: "episode-1" }) },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    const response = await responsePromise;
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("Personal podcast audio is unavailable");
    expect(body).not.toContain("timed out");
    expectPrivateMediaHeaders(response);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });
});
