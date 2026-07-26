import { afterEach, describe, expect, it, vi } from "vitest";
import { generateArticleSectionAudioUrlWithMetadata } from "./article-section-audio-client";
import { getTtsMetadata, getTtsProfile } from "./tts-profile";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("generateArticleSectionAudioUrlWithMetadata", () => {
  it("requests canonical cached audio without sending browser-supplied text", async () => {
    const metadata = getTtsMetadata(getTtsProfile("edge"));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "X-Curio-TTS-Provider": metadata.provider,
          "X-Curio-TTS-Model": metadata.model,
          "X-Curio-TTS-Voice": metadata.voiceId,
          "X-Curio-TTS-Prompt-Version": metadata.promptVersion,
          "X-Curio-TTS-Norm-Version": metadata.ttsNormVersion,
          "X-Curio-TTS-Cache-Key": metadata.ttsCacheKey,
          "X-Curio-TTS-Fallback": "false",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:section-audio");

    const result = await generateArticleSectionAudioUrlWithMetadata({
      slug: "The_Silmarillion",
      sectionKey: "summary",
      sourceHash: "source-hash",
      provider: "edge",
    });

    expect(result).toEqual({ url: "blob:section-audio", metadata });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/article/audio/section");
    expect(JSON.parse(String(init.body))).toEqual({
      slug: "The_Silmarillion",
      sectionKey: "summary",
      sourceHash: "source-hash",
      provider: "edge",
    });
    expect(String(init.body)).not.toContain("text");
  });

  it("preserves fallback metadata from the server", async () => {
    const metadata = getTtsMetadata(getTtsProfile("edge"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: {
            "X-Curio-TTS-Provider": metadata.provider,
            "X-Curio-TTS-Model": metadata.model,
            "X-Curio-TTS-Voice": metadata.voiceId,
            "X-Curio-TTS-Prompt-Version": metadata.promptVersion,
            "X-Curio-TTS-Norm-Version": metadata.ttsNormVersion,
            "X-Curio-TTS-Cache-Key": metadata.ttsCacheKey,
            "X-Curio-TTS-Fallback": "true",
            "X-Curio-TTS-Fallback-Reason": "openai_quota",
          },
        }),
      ),
    );
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fallback");

    await expect(
      generateArticleSectionAudioUrlWithMetadata({
        slug: "The_Silmarillion",
        sectionKey: "summary",
        sourceHash: "source-hash",
        provider: "openai",
      }),
    ).resolves.toEqual({
      url: "blob:fallback",
      metadata,
      fallbackReason: "openai_quota",
    });
  });

  it("surfaces structured route errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Article narration changed; refresh and try again." },
            { status: 409 },
          ),
        ),
    );

    await expect(
      generateArticleSectionAudioUrlWithMetadata({
        slug: "The_Silmarillion",
        sectionKey: "summary",
        sourceHash: "stale",
        provider: "edge",
      }),
    ).rejects.toThrow("Article narration changed; refresh and try again.");
  });

  it("aborts a stalled canonical audio request", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NEXT_PUBLIC_ARTICLE_SECTION_AUDIO_TIMEOUT_MS", "25");
    let signal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    const result = generateArticleSectionAudioUrlWithMetadata({
      slug: "The_Silmarillion",
      sectionKey: "summary",
      sourceHash: "source-hash",
      provider: "edge",
    });
    const rejection = expect(result).rejects.toThrow(
      "Article audio request timed out after 25ms",
    );
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(signal?.aborted).toBe(true);
  });

  it("uses direct Edge speech in local mode without a second article fetch", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:local-edge");

    await expect(
      generateArticleSectionAudioUrlWithMetadata({
        slug: "The_Silmarillion",
        sectionKey: "summary",
        sourceHash: "source-hash",
        provider: "openai",
        localText: "Already fetched canonical local narration.",
      }),
    ).resolves.toMatchObject({
      url: "blob:local-edge",
      metadata: { provider: "edge" },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tts",
      expect.objectContaining({
        body: expect.stringContaining('"provider":"edge"'),
      }),
    );
  });
});
