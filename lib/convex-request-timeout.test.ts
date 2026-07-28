import { anyApi } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchConvexMutationWithTimeout,
  fetchConvexQueryWithTimeout,
} from "./convex-request-timeout";

describe("abortable Convex HTTP requests", () => {
  const requestFetch = vi.fn();

  beforeEach(() => {
    requestFetch.mockReset();
    vi.useFakeTimers();
    vi.stubEnv(
      "NEXT_PUBLIC_CONVEX_URL",
      "https://curio-garden-test.convex.cloud",
    );
    vi.stubGlobal("fetch", requestFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("aborts the underlying mutation request when its deadline expires", async () => {
    let requestSignal: AbortSignal | undefined;
    requestFetch.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal;
          requestSignal.addEventListener(
            "abort",
            () => reject(requestSignal?.reason),
            { once: true },
          );
        }),
    );

    const request = fetchConvexMutationWithTimeout(
      anyApi.personalPlaylist.getEpisodeForPersonalFeedServer,
      {
        feedToken: "a".repeat(64),
        episodeId: "episode-1",
        attestation: {
          issuedAt: 1,
          expiresAt: 2,
          nonce: "nonce",
          signature: "b".repeat(64),
        },
      },
      {
        timeoutMs: 5_000,
        message: "Personal podcast authorization timed out",
      },
    );
    const rejection = expect(request).rejects.toThrow(
      "Personal podcast authorization timed out",
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses a private no-store query request and clears its deadline", async () => {
    requestFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          value: {
            feed: { updatedAt: 1_000 },
            episodes: [],
          },
          logLines: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    const result = await fetchConvexQueryWithTimeout(
      anyApi.personalPlaylist.getFeedEpisodesByToken,
      { feedToken: "c".repeat(64) },
      {
        timeoutMs: 5_000,
        message: "Personal podcast feed lookup timed out",
      },
    );

    expect(result).toEqual({
      feed: { updatedAt: 1_000 },
      episodes: [],
    });
    expect(requestFetch).toHaveBeenCalledTimes(1);
    const [url, init] = requestFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://curio-garden-test.convex.cloud/api/query");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a server-resolved Clerk token on an abortable query", async () => {
    requestFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "success",
          value: { feed: null, quotas: [] },
          logLines: [],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await fetchConvexQueryWithTimeout(
      anyApi.accountData.getViewerAccountDataOverview,
      {},
      {
        timeoutMs: 5_000,
        message: "Account data lookup timed out",
        token: "clerk-convex-jwt",
      },
    );

    const [, init] = requestFetch.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get("Authorization")).toBe(
      "Bearer clerk-convex-jwt",
    );
  });

  it("links a parent cancellation to the underlying request and clears its timer", async () => {
    let requestSignal: AbortSignal | undefined;
    requestFetch.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          requestSignal = init?.signal as AbortSignal;
          requestSignal.addEventListener(
            "abort",
            () => reject(requestSignal?.reason),
            { once: true },
          );
        }),
    );
    const parent = new AbortController();

    const request = fetchConvexQueryWithTimeout(
      anyApi.accountData.getViewerAccountDataOverview,
      {},
      {
        timeoutMs: 5_000,
        message: "Account data lookup timed out",
        signal: parent.signal,
        token: "clerk-convex-jwt",
      },
    ).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    parent.abort(new Error("Account export cancelled"));
    await vi.advanceTimersByTimeAsync(5_000);

    const error = await request;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Account export cancelled");
    expect(requestSignal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
