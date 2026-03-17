import { beforeEach, describe, expect, it, vi } from "vitest";

import { addMp3Metadata } from "../../lib/audio-metadata";
import type { Id } from "../_generated/dataModel";
import {
  assembleArticleAudio,
  type ArticleAudioSource,
} from "./articleAudioPipeline";

const concatBytes = (...chunks: Uint8Array[]): Uint8Array => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
};

const streamFromBytes = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

const readStreamBytes = async (
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return concatBytes(...chunks);
};

const createStreamOnlyAudioResponse = (bytes: Uint8Array): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({
      "Content-Type": "audio/mpeg",
    }),
    body: streamFromBytes(bytes),
    blob: async () => {
      throw new Error("blob() should not be called for cached section audio");
    },
    arrayBuffer: async () => {
      throw new Error("arrayBuffer() should not be called for cached section audio");
    },
  }) as unknown as Response;

describe("assembleArticleAudio", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("streams cached section audio into the combined upload without blob reads", async () => {
    const article: ArticleAudioSource = {
      _id: "article-1" as Id<"articles">,
      title: "Chrono Trigger",
      slug: "Chrono_Trigger",
      sections: [
        {
          title: "Gameplay",
          level: 2,
          content:
            "Chrono Trigger uses an active time battle system with party attacks and time travel.",
          audioMode: "full",
          audioReason: "eligible",
        },
        {
          title: "Legacy",
          level: 2,
          content:
            "The game remains widely praised and has been re-released on several platforms over time.",
          audioMode: "full",
          audioReason: "eligible",
        },
      ],
    };

    const firstSectionUrl = "https://cdn.test/chrono-trigger-section-0.mp3";
    const secondSectionUrl = "https://cdn.test/chrono-trigger-section-1.mp3";
    const firstSectionBytes = Uint8Array.of(0xff, 0xfb, 0x90, 0x64, 0x01, 0x02);
    const secondSectionBytes = Uint8Array.of(0xff, 0xfb, 0x91, 0x64, 0x03, 0x04);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === firstSectionUrl) {
        return createStreamOnlyAudioResponse(firstSectionBytes);
      }

      if (url === secondSectionUrl) {
        return createStreamOnlyAudioResponse(secondSectionBytes);
      }

      if (url.endsWith("/api/article/Chrono_Trigger/artwork")) {
        return new Response("not found", {
          status: 404,
          headers: {
            "Content-Type": "text/plain",
          },
        });
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const saveSectionAudio = vi.fn(async () => {
      throw new Error("saveSectionAudio should not run when cached section audio is available");
    });

    let uploadedBytes: Uint8Array | null = null;
    const result = await assembleArticleAudio({
      article,
      albumTitle: "Curio Garden Article Audio",
      baseUrl: "https://curiogarden.org",
      getCachedSectionAudioUrls: async () => ({
        "section-0": firstSectionUrl,
        "section-1": secondSectionUrl,
      }),
      saveSectionAudio,
      saveCombinedAudio: async ({ stream, contentType }) => {
        expect(contentType).toBe("audio/mpeg");
        uploadedBytes = await readStreamBytes(stream);

        return {
          storageId: "combined-storage",
          byteLength: uploadedBytes.byteLength,
        };
      },
    });

    const expectedTag = addMp3Metadata(new Uint8Array(), {
      title: article.title,
      artist: "Curio Garden",
      album: "Curio Garden Article Audio",
    });

    expect(saveSectionAudio).not.toHaveBeenCalled();
    expect(result.storageId).toBe("combined-storage");
    expect(result.generatedSectionCount).toBe(0);
    expect(result.reusedSectionCount).toBe(2);
    expect(result.byteLength).toBe(
      expectedTag.byteLength +
        firstSectionBytes.byteLength +
        secondSectionBytes.byteLength,
    );
    expect(Array.from(uploadedBytes ?? new Uint8Array())).toEqual([
      ...Array.from(expectedTag),
      ...Array.from(firstSectionBytes),
      ...Array.from(secondSectionBytes),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
