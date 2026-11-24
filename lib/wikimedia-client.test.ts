import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildWikimediaActionApiUrl,
  buildWikimediaHeaders,
  DEFAULT_WIKIMEDIA_TIMEOUT_MS,
  extractActionApiPages,
  fetchWikimedia,
  fetchWikimediaActionApi,
  isMissingActionApiPage,
  isWikimediaApiPortalUrl,
  isWikimediaTimeoutError,
  parseRetryAfterMs,
  parseRetryAfterSeconds,
  WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV,
  WIKIMEDIA_USER_AGENT,
} from "./wikimedia-client";

const originalOAuthToken = process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV];

const restoreOAuthEnv = () => {
  if (originalOAuthToken === undefined) {
    delete process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV];
  } else {
    process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV] = originalOAuthToken;
  }
};

describe("lib/wikimedia-client", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    restoreOAuthEnv();
  });

  describe("headers and OAuth 2.0 bearer auth", () => {
    it("sends the canonical policy-compliant User-Agent with a contactable URL", async () => {
      delete process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV];
      expect(WIKIMEDIA_USER_AGENT).toMatch(/^CurioGarden\/\d+\.\d+ \(https:\/\/curiogarden\.org;/);

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ ok: true })));

      await fetchWikimedia("https://en.wikipedia.org/api/rest_v1/page/summary/Ada_Lovelace", {
        fetchImpl: fetchMock,
        headers: { Accept: "application/json" },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://en.wikipedia.org/api/rest_v1/page/summary/Ada_Lovelace",
        expect.objectContaining({
          headers: {
            Accept: "application/json",
            "User-Agent": WIKIMEDIA_USER_AGENT,
          },
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it("injects Authorization: Bearer from env ONLY for https://api.wikimedia.org", async () => {
      process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV] = "  oauth-secret-token  ";

      const fetchMock = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response("{}"));

      await fetchWikimedia("https://api.wikimedia.org/service/lw/inference/v1/models/outlink-topic-model:predict", {
        fetchImpl: fetchMock,
      });
      await fetchWikimedia("https://en.wikipedia.org/w/api.php?action=query", {
        fetchImpl: fetchMock,
      });
      await fetchWikimedia("https://commons.wikimedia.org/w/api.php?action=query", {
        fetchImpl: fetchMock,
      });
      await fetchWikimedia("http://api.wikimedia.org/insecure", {
        fetchImpl: fetchMock,
      });

      expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
        "User-Agent": WIKIMEDIA_USER_AGENT,
        Authorization: "Bearer oauth-secret-token",
      });
      expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
        "User-Agent": WIKIMEDIA_USER_AGENT,
      });
      expect(fetchMock.mock.calls[2]?.[1]?.headers).toEqual({
        "User-Agent": WIKIMEDIA_USER_AGENT,
      });
      expect(fetchMock.mock.calls[3]?.[1]?.headers).toEqual({
        "User-Agent": WIKIMEDIA_USER_AGENT,
      });
    });

    it("preserves explicit caller Authorization headers and honors accessToken overrides", () => {
      process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV] = "env-token";

      expect(
        buildWikimediaHeaders("https://api.wikimedia.org/feed/v1/wikipedia/en/featured/2026/11/24", {
          headers: { authorization: "Bearer caller-token" },
        }),
      ).toEqual({
        authorization: "Bearer caller-token",
        "User-Agent": WIKIMEDIA_USER_AGENT,
      });

      expect(
        buildWikimediaHeaders("https://api.wikimedia.org/core/v1/wikipedia/en/page/Ada", {
          accessToken: null,
        }),
      ).toEqual({
        "User-Agent": WIKIMEDIA_USER_AGENT,
      });

      expect(isWikimediaApiPortalUrl("https://API.WIKIMEDIA.ORG/test")).toBe(true);
      expect(isWikimediaApiPortalUrl("https://api.wikimedia.org.evil.com/test")).toBe(false);
      expect(isWikimediaApiPortalUrl("https://wikimedia.org/api/rest_v1")).toBe(false);
      expect(isWikimediaApiPortalUrl("not-a-url")).toBe(false);
    });
  });

  describe("server-to-server Action API URL & response helpers", () => {
    it("sets format=json and formatversion=2 and strips browser-only origin=*", async () => {
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify({ query: { pages: [] } })));

      await fetchWikimediaActionApi(
        "https://en.wikipedia.org/w/api.php",
        {
          action: "query",
          titles: "Ada Lovelace",
          origin: "*",
          formatversion: "1",
        },
        { fetchImpl: fetchMock },
      );

      const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
      expect(calledUrl.searchParams.get("format")).toBe("json");
      expect(calledUrl.searchParams.get("formatversion")).toBe("2");
      expect(calledUrl.searchParams.has("origin")).toBe(false);
      expect(calledUrl.searchParams.get("titles")).toBe("Ada Lovelace");

      const fromSearchParams = new URL(
        buildWikimediaActionApiUrl(
          "https://commons.wikimedia.org/w/api.php",
          new URLSearchParams({ action: "query", origin: "*", titles: "File:A.jpg" }),
        ),
      );
      expect(fromSearchParams.searchParams.get("formatversion")).toBe("2");
      expect(fromSearchParams.searchParams.has("origin")).toBe(false);
    });

    it("normalizes formatversion=2 page arrays and legacy page maps safely", () => {
      expect(
        extractActionApiPages([{ pageid: 1, title: "Ada Lovelace" }]),
      ).toEqual([{ pageid: 1, title: "Ada Lovelace" }]);
      expect(
        extractActionApiPages({ "1": { pageid: 1, title: "Ada Lovelace" } }),
      ).toEqual([{ pageid: 1, title: "Ada Lovelace" }]);
      expect(extractActionApiPages(null)).toBeNull();
      expect(extractActionApiPages({ "-1": null })).toBeNull();
      expect(extractActionApiPages([null])).toBeNull();

      expect(isMissingActionApiPage({ missing: true })).toBe(true);
      expect(isMissingActionApiPage({ missing: "" })).toBe(true);
      expect(isMissingActionApiPage({ missing: false })).toBe(false);
      expect(isMissingActionApiPage({})).toBe(false);
    });
  });

  describe("timeouts and caller cancellation", () => {
    it("aborts stalled requests when timeoutMs elapses", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          }),
      );

      const pending = fetchWikimedia("https://en.wikipedia.org/w/api.php", {
        fetchImpl: fetchMock,
        timeoutMs: 1_500,
      });
      const expectation = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });

      await vi.advanceTimersByTimeAsync(1_499);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expectation;
    });

    it("respects an already-aborted caller signal without calling fetch", async () => {
      const caller = new AbortController();
      const reason = new DOMException("Cancelled by caller", "AbortError");
      caller.abort(reason);
      const fetchMock = vi.fn<typeof fetch>();

      await expect(
        fetchWikimedia("https://en.wikipedia.org/w/api.php", {
          fetchImpl: fetchMock,
          signal: caller.signal,
        }),
      ).rejects.toBe(reason);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("aborts immediately during a retry backoff wait when caller cancels", async () => {
      vi.useFakeTimers();
      const caller = new AbortController();
      const reason = new DOMException("Caller stopped", "AbortError");
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "3" },
        }),
      );

      const pending = fetchWikimedia("https://en.wikipedia.org/w/api.php", {
        fetchImpl: fetchMock,
        signal: caller.signal,
      });
      const expectation = expect(pending).rejects.toBe(reason);

      await vi.advanceTimersByTimeAsync(500);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      caller.abort(reason);
      await expectation;
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("falls back to DEFAULT_WIKIMEDIA_TIMEOUT_MS if timeoutMs is invalid", async () => {
      vi.useFakeTimers();
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(
        async (_input, init) =>
          await new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      );

      const pending = fetchWikimedia("https://en.wikipedia.org/w/api.php", {
        fetchImpl: fetchMock,
        timeoutMs: 0,
      });
      const expectation = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(DEFAULT_WIKIMEDIA_TIMEOUT_MS);
      await expectation;
    });

    it("keeps the timeout active after headers arrive and aborts a stalled body read", async () => {
      vi.useFakeTimers();
      let upstreamCancelled = false;
      const stalledBody = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise(() => {});
        },
        cancel() {
          upstreamCancelled = true;
        },
      });
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response(stalledBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const response = await fetchWikimediaActionApi(
        "https://en.wikipedia.org/w/api.php",
        { action: "query", titles: "Ada Lovelace" },
        {
          fetchImpl: fetchMock,
          timeoutMs: 1_500,
        },
      );

      let caughtError: unknown;
      const bodyRead = response.json().catch((error: unknown) => {
        caughtError = error;
      });

      await vi.advanceTimersByTimeAsync(1_499);
      expect(caughtError).toBeUndefined();
      expect(upstreamCancelled).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await bodyRead;

      expect(caughtError).toMatchObject({ name: "AbortError" });
      expect(isWikimediaTimeoutError(caughtError)).toBe(true);
      expect(upstreamCancelled).toBe(true);
    });

    it("propagates caller abort while reading a stalled response body after headers arrive", async () => {
      vi.useFakeTimers();
      const caller = new AbortController();
      const reason = new DOMException("Caller stopped reading", "AbortError");
      let upstreamCancelled = false;
      const stalledBody = new ReadableStream<Uint8Array>({
        pull() {
          return new Promise(() => {});
        },
        cancel() {
          upstreamCancelled = true;
        },
      });
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response(stalledBody, { status: 200 }));

      const response = await fetchWikimedia(
        "https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/11/24",
        {
          fetchImpl: fetchMock,
          signal: caller.signal,
          timeoutMs: 10_000,
        },
      );

      let caughtError: unknown;
      const bodyRead = response.text().catch((error: unknown) => {
        caughtError = error;
      });

      await vi.advanceTimersByTimeAsync(500);
      expect(caughtError).toBeUndefined();

      caller.abort(reason);
      await bodyRead;

      expect(caughtError).toBe(reason);
      expect(isWikimediaTimeoutError(caughtError)).toBe(false);
      expect(upstreamCancelled).toBe(true);
    });

    it("preserves streaming reads and cleans up timers and caller abort listeners on completion, cancel, and stream error", async () => {
      vi.useFakeTimers();

      // 1. Normal completion cleans up caller listener and timeout.
      {
        const caller = new AbortController();
        const removeSpy = vi.spyOn(caller.signal, "removeEventListener");
        const fetchMock = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
          );

        const response = await fetchWikimedia(
          "https://en.wikipedia.org/w/api.php",
          {
            fetchImpl: fetchMock,
            signal: caller.signal,
            timeoutMs: 1_000,
          },
        );
        expect(await response.json()).toEqual({ ok: true });
        expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
      }

      // 2. Bounded streaming read + early cancel cleans up upstream body, timer, and listener.
      {
        const caller = new AbortController();
        const removeSpy = vi.spyOn(caller.signal, "removeEventListener");
        let chunksEmitted = 0;
        let upstreamCancelled = false;
        const encoder = new TextEncoder();
        const streamingBody = new ReadableStream<Uint8Array>({
          pull(ctrl) {
            chunksEmitted += 1;
            ctrl.enqueue(encoder.encode(`chunk-${chunksEmitted}`));
          },
          cancel() {
            upstreamCancelled = true;
          },
        });
        const fetchMock = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(new Response(streamingBody, { status: 200 }));

        const response = await fetchWikimedia(
          "https://en.wikipedia.org/w/api.php",
          {
            fetchImpl: fetchMock,
            signal: caller.signal,
            timeoutMs: 1_000,
          },
        );
        const reader = response.body?.getReader();
        expect(reader).toBeDefined();
        if (!reader) {
          throw new Error("Expected wrapped response body reader");
        }
        const first = await reader.read();
        expect(first.done).toBe(false);
        expect(new TextDecoder().decode(first.value)).toBe("chunk-1");

        await reader.cancel("size-limit");
        expect(upstreamCancelled).toBe(true);
        expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
      }

      // 3. Upstream stream error cleans up timer and listener and is not misclassified as timeout.
      {
        const caller = new AbortController();
        const removeSpy = vi.spyOn(caller.signal, "removeEventListener");
        const streamFailure = new Error("socket reset");
        const failingBody = new ReadableStream<Uint8Array>({
          pull(ctrl) {
            ctrl.error(streamFailure);
          },
        });
        const fetchMock = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(new Response(failingBody, { status: 200 }));

        const response = await fetchWikimedia(
          "https://en.wikipedia.org/w/api.php",
          {
            fetchImpl: fetchMock,
            signal: caller.signal,
            timeoutMs: 1_000,
          },
        );
        let caughtError: unknown;
        try {
          await response.text();
        } catch (error: unknown) {
          caughtError = error;
        }
        expect(caughtError).toBe(streamFailure);
        expect(isWikimediaTimeoutError(caughtError)).toBe(false);
        expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
      }

      // 4. Unread response timing out cancels upstream body and cleans up without unhandled rejections.
      {
        const caller = new AbortController();
        const removeSpy = vi.spyOn(caller.signal, "removeEventListener");
        let upstreamCancelled = false;
        const stalledBody = new ReadableStream<Uint8Array>({
          pull() {
            return new Promise(() => {});
          },
          cancel() {
            upstreamCancelled = true;
          },
        });
        const fetchMock = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(new Response(stalledBody, { status: 500 }));

        const response = await fetchWikimedia(
          "https://en.wikipedia.org/w/api.php",
          {
            fetchImpl: fetchMock,
            signal: caller.signal,
            timeoutMs: 1_000,
          },
        );
        expect(response.status).toBe(500);

        await vi.advanceTimersByTimeAsync(1_000);
        expect(upstreamCancelled).toBe(true);
        expect(removeSpy).toHaveBeenCalledWith("abort", expect.any(Function));
        expect(vi.getTimerCount()).toBe(0);
      }
    });
  });

  describe("429/503 Retry-After and capped jittered backoff", () => {
    it("parses delta-seconds and HTTP-date Retry-After headers", () => {
      const now = Date.UTC(2026, 10, 24, 12, 0, 0);
      expect(parseRetryAfterMs("2", now)).toBe(2_000);
      expect(parseRetryAfterMs("0", now)).toBe(0);
      expect(parseRetryAfterMs("Tue, 24 Nov 2026 12:00:04 GMT", now)).toBe(
        4_000,
      );
      expect(parseRetryAfterMs("Tue, 24 Nov 2026 11:59:55 GMT", now)).toBe(0);
      expect(parseRetryAfterMs("not-a-date", now)).toBeUndefined();
      expect(parseRetryAfterMs(null, now)).toBeUndefined();
      expect(parseRetryAfterSeconds("45", now)).toBe(45);
    });

    it("retries 429 honoring delta-seconds Retry-After and cancels abandoned response bodies", async () => {
      vi.useFakeTimers();
      let cancelledFirstBody = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("rate limited"));
        },
        cancel() {
          cancelledFirstBody = true;
        },
      });
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(body, {
            status: 429,
            headers: { "Retry-After": "2" },
          }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );

      const pending = fetchWikimedia("https://en.wikipedia.org/w/api.php", {
        fetchImpl: fetchMock,
      });

      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(cancelledFirstBody).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(response.status).toBe(200);
    });

    it("retries 503 honoring HTTP-date Retry-After", async () => {
      vi.useFakeTimers();
      const now = Date.UTC(2026, 10, 24, 12, 0, 0);
      const retryDate = new Date(now + 2_000).toUTCString();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response("unavailable", {
            status: 503,
            headers: { "Retry-After": retryDate },
          }),
        )
        .mockResolvedValueOnce(new Response("ok", { status: 200 }));

      const pending = fetchWikimedia("https://wikimedia.org/api/rest_v1/metrics/pageviews/top/en.wikipedia/all-access/2026/11/23", {
        fetchImpl: fetchMock,
        now: () => now,
      });

      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(response.status).toBe(200);
    });

    it("uses capped jittered exponential backoff when Retry-After is absent", async () => {
      vi.useFakeTimers();
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(new Response("busy 1", { status: 503 }))
        .mockResolvedValueOnce(new Response("busy 2", { status: 429 }))
        .mockResolvedValueOnce(new Response("recovered", { status: 200 }));

      const pending = fetchWikimedia("https://en.wikipedia.org/w/api.php", {
        fetchImpl: fetchMock,
        maxRetries: 2,
        baseBackoffMs: 200,
        maxRetryDelayMs: 450,
        jitterRatio: 0.25,
        random: () => 1, // deterministic max jitter: attempt 0 => 250ms, attempt 1 => min(450, 500) = 450ms
      });

      await vi.advanceTimersByTimeAsync(249);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(449);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(response.status).toBe(200);
    });

    it("returns immediately without retrying when Retry-After exceeds maxRetryDelayMs", async () => {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
        new Response("wait longer", {
          status: 429,
          headers: { "Retry-After": "45" },
        }),
      );

      const response = await fetchWikimedia("https://en.wikipedia.org/w/api.php", {
        fetchImpl: fetchMock,
        maxRetryDelayMs: 5_000,
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("45");
    });

    it("never retries 4xx client errors other than 429", async () => {
      for (const status of [400, 401, 403, 404, 410, 422]) {
        const fetchMock = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(new Response("client error", { status }));

        const response = await fetchWikimedia(
          "https://en.wikipedia.org/w/api.php",
          { fetchImpl: fetchMock },
        );

        expect(response.status).toBe(status);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    });
  });
});
