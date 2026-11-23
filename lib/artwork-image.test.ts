import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ARTWORK_IMAGE_TIMEOUT_MS,
  ARTWORK_IMAGE_USER_AGENT,
  fetchArtworkImageDataUrl,
} from "./artwork-image";

// Minimal valid 1x1 transparent PNG.
const SAMPLE_PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

describe("fetchArtworkImageDataUrl", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends Curio Garden's User-Agent and returns a base64 data URL for valid images", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(SAMPLE_PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png; charset=binary" },
      }),
    );

    const url =
      "https://upload.wikimedia.org/wikipedia/commons/4/4c/Ada_Lovelace.png";
    const result = await fetchArtworkImageDataUrl(url, {
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          "User-Agent": ARTWORK_IMAGE_USER_AGENT,
        }),
      }),
    );
    expect(result).toBe(
      `data:image/png;base64,${Buffer.from(SAMPLE_PNG_BYTES).toString("base64")}`,
    );
  });

  it.each([
    ["HTTP 429 throttle", new Response("Too many requests", { status: 429 })],
    ["HTTP 500 error", new Response("Server error", { status: 500 })],
    [
      "non-image HTML response",
      new Response("<html>blocked</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    ],
    [
      "empty image body",
      new Response(new Uint8Array(), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    ],
    [
      "oversized declared content-length",
      new Response(SAMPLE_PNG_BYTES, {
        status: 200,
        headers: {
          "content-type": "image/png",
          "content-length": String(20 * 1024 * 1024),
        },
      }),
    ],
  ])("returns null on %s", async (_label, response) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);

    const result = await fetchArtworkImageDataUrl(
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.png",
      { fetchImpl: fetchMock },
    );

    expect(result).toBeNull();
  });

  it("rejects non-HTTP and malformed URLs without calling fetch", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>();

    expect(
      await fetchArtworkImageDataUrl("javascript:alert(1)", {
        fetchImpl: fetchMock,
      }),
    ).toBeNull();
    expect(
      await fetchArtworkImageDataUrl("not a url", { fetchImpl: fetchMock }),
    ).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("aborts stalled image requests after timeout and returns null", async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const pending = fetchArtworkImageDataUrl(
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Slow.jpg",
      { fetchImpl: fetchMock },
    );
    await vi.advanceTimersByTimeAsync(ARTWORK_IMAGE_TIMEOUT_MS);

    await expect(pending).resolves.toBeNull();
    warnSpy.mockRestore();
  });

  it("propagates caller-initiated cancellation", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Caller aborted", "AbortError")),
          );
        }),
    );

    const pending = fetchArtworkImageDataUrl(
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Cancel.jpg",
      { fetchImpl: fetchMock, signal: controller.signal },
    );
    controller.abort(new DOMException("Caller aborted", "AbortError"));

    await expect(pending).rejects.toThrow("Caller aborted");
  });
});
