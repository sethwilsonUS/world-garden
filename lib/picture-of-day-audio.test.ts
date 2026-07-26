import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import {
  PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
  buildPictureOfDayAudioTitle,
  buildPictureOfDaySpeechScript,
  syncPictureOfDayAudio,
} from "./picture-of-day-audio";
import type { WikipediaPictureOfDay } from "./featured-article";
import {
  buildTtsMetadataHeaders,
  getTtsMetadata,
  getTtsProfile,
} from "./tts-profile";
import {
  verifyPublicAudioWriteAttestation,
  type PublicAudioWriteOperation,
} from "./public-audio-write-attestation";
import type { ServerAttestation } from "./server-attestation";

vi.mock("convex/nextjs", () => ({
  fetchMutation: vi.fn(),
  fetchQuery: vi.fn(),
}));

const picture = {
  title: "File:Hoverfly May 2008-8.jpg",
  pictureKey: "File:Hoverfly May 2008-8.jpg",
  altText: "A Marmelade fly on flight.",
  description: "A Marmelade fly on flight.",
  artist: "Alvesgaspar",
  credit: "Own work",
  filePage: "https://commons.wikimedia.org/wiki/File:Hoverfly_May_2008-8.jpg",
  license: {
    type: "CC BY-SA 3.0",
    url: "https://creativecommons.org/licenses/by-sa/3.0",
  },
} satisfies WikipediaPictureOfDay;

const PUBLICATION_SECRET = "picture-publication-secret";

const expectValidPictureWrite = async (
  operation: PublicAudioWriteOperation,
  args: unknown,
): Promise<Record<string, unknown>> => {
  const { attestation, ...writeArgs } = (args ?? {}) as Record<string, unknown>;
  await expect(
    verifyPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation,
      args: writeArgs,
      attestation: attestation as ServerAttestation | undefined,
      secret: PUBLICATION_SECRET,
    }),
  ).resolves.toBe(true);
  return writeArgs;
};

describe("picture of day audio", () => {
  afterEach(async () => {
    const { fetchMutation, fetchQuery } = await import("convex/nextjs");
    vi.mocked(fetchMutation).mockReset();
    vi.mocked(fetchQuery).mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses a stable script version", () => {
    expect(PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION).toBe(1);
  });

  it("builds a descriptive title for the daily picture", () => {
    expect(buildPictureOfDayAudioTitle("2026-05-08")).toBe(
      "Picture of the Day: May 8, 2026",
    );
  });

  it("builds speech from description, artist, credit, source, and license", () => {
    const script = buildPictureOfDaySpeechScript({
      feedDateIso: "2026-05-08",
      picture,
    });

    expect(script).toContain(
      "Curio Garden. Picture of the Day for May 8, 2026.",
    );
    expect(script).toContain("A Marmelade fly on flight.");
    expect(script).toContain("Artist: Alvesgaspar.");
    expect(script).toContain("Credit: Own work.");
    expect(script).toContain(
      "Source file: File:Hoverfly May 2008-8.jpg on Wikimedia Commons.",
    );
    expect(script).toContain("License: CC BY-SA 3.0.");
  });

  it("uses useful fallbacks when optional Commons metadata is missing", () => {
    const script = buildPictureOfDaySpeechScript({
      feedDateIso: "2026-05-08",
      picture: {
        title: "File:Quiet garden.jpg",
        pictureKey: "File:Quiet garden.jpg",
        altText: "Wikipedia picture of the day",
        description: "",
      },
    });

    expect(script).toContain("The picture is titled File:Quiet garden.jpg.");
    expect(script).toContain(
      "Creator and license details were not included in the feed metadata.",
    );
  });

  it("invalidates incompatible ready audio when its Edge replacement fails", async () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "openai");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", PUBLICATION_SECRET);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let persisted: Record<string, unknown> & {
      status: string;
      storageId: string;
      ttsCacheKey: string;
      audioUrl: string | null;
    } = {
      _id: "picture-audio-1",
      feedDate: "2026-05-08",
      pictureKey: picture.pictureKey,
      scriptVersion: PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
      status: "ready",
      title: "Picture of the Day: May 8, 2026",
      spokenText: "Existing speech",
      storageId: "openai-storage",
      ttsCacheKey: getTtsProfile("openai").ttsCacheKey,
      audioUrl: "https://cdn.example.com/openai.mp3",
      createdAt: 1,
      updatedAt: 1,
    };
    const { fetchMutation, fetchQuery } = await import("convex/nextjs");
    vi.mocked(fetchQuery).mockImplementation(async () => persisted as never);
    const publicationOperations: PublicAudioWriteOperation[] = [];
    vi.mocked(fetchMutation).mockImplementation(async (...callArgs) => {
      const [reference, args] = callArgs;
      const functionName = getFunctionName(reference);
      if (functionName === "pictureOfDay:claimPictureOfDayAudioJob") {
        await expectValidPictureWrite("claim-job", args);
        publicationOperations.push("claim-job");
        return { claimed: true } as never;
      }
      if (functionName === "pictureOfDay:finalizePictureOfDayAudioJob") {
        await expectValidPictureWrite("finalize-job", args);
        publicationOperations.push("finalize-job");
        return { updated: true } as never;
      }
      if (functionName === "pictureOfDay:savePictureOfDayAudio") {
        const writeArgs = await expectValidPictureWrite("save-record", args);
        publicationOperations.push("save-record");
        persisted = {
          ...persisted,
          ...writeArgs,
          audioUrl: (writeArgs as { storageId?: string }).storageId
            ? "https://cdn.example.com/replacement.mp3"
            : null,
          updatedAt: Date.now(),
        };
      }
      return undefined as never;
    });
    const ttsRequests: Array<{ provider?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        ttsRequests.push(
          JSON.parse(String(init?.body)) as { provider?: string },
        );
        return Response.json({ error: "speech unavailable" }, { status: 503 });
      }),
    );

    await expect(
      syncPictureOfDayAudio({
        baseUrl: "https://curiogarden.org",
        feedDateIso: "2026-05-08",
        picture,
      }),
    ).rejects.toThrow("speech unavailable");

    expect(ttsRequests).toEqual([
      expect.objectContaining({ provider: "edge" }),
    ]);
    expect(persisted).toMatchObject({
      status: "failed",
      audioUrl: null,
      storageId: "openai-storage",
      ttsCacheKey: getTtsProfile("openai").ttsCacheKey,
    });
    expect(publicationOperations).toEqual([
      "claim-job",
      "save-record",
      "save-record",
      "finalize-job",
    ]);
  });

  it("signs both failure writes when no prior audio can be preserved", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", PUBLICATION_SECRET);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    let persisted: Record<string, unknown> | null = null;
    const publicationOperations: PublicAudioWriteOperation[] = [];
    const { fetchMutation, fetchQuery } = await import("convex/nextjs");
    vi.mocked(fetchQuery).mockImplementation(async () => persisted as never);
    vi.mocked(fetchMutation).mockImplementation(async (...callArgs) => {
      const [reference, args] = callArgs;
      const functionName = getFunctionName(reference);

      if (functionName === "pictureOfDay:claimPictureOfDayAudioJob") {
        await expectValidPictureWrite("claim-job", args);
        publicationOperations.push("claim-job");
        return { claimed: true } as never;
      }
      if (functionName === "pictureOfDay:savePictureOfDayAudio") {
        const writeArgs = await expectValidPictureWrite("save-record", args);
        publicationOperations.push("save-record");
        persisted = { ...writeArgs, audioUrl: null };
        return "picture-audio-1" as never;
      }
      if (functionName === "pictureOfDay:finalizePictureOfDayAudioJob") {
        await expectValidPictureWrite("finalize-job", args);
        publicationOperations.push("finalize-job");
        return { updated: true } as never;
      }

      throw new Error(`Unexpected mutation: ${functionName}`);
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "speech unavailable" }, { status: 503 }),
      ),
    );

    await expect(
      syncPictureOfDayAudio({
        baseUrl: "https://curiogarden.org",
        feedDateIso: "2026-05-08",
        picture,
      }),
    ).rejects.toThrow("speech unavailable");

    expect(publicationOperations).toEqual([
      "claim-job",
      "save-record",
      "save-record",
      "finalize-job",
    ]);
    expect(persisted).toMatchObject({
      status: "failed",
      lastError: expect.stringContaining("speech unavailable"),
      audioUrl: null,
    });
  });

  it("signs the exact payload for every successful publication write", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", PUBLICATION_SECRET);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const edgeMetadata = getTtsMetadata(getTtsProfile("edge"));
    let persisted: Record<string, unknown> | null = null;
    const publicationOperations: PublicAudioWriteOperation[] = [];
    const { fetchMutation, fetchQuery } = await import("convex/nextjs");
    vi.mocked(fetchQuery).mockImplementation(async () => persisted as never);
    vi.mocked(fetchMutation).mockImplementation(async (...callArgs) => {
      const [reference, args] = callArgs;
      const functionName = getFunctionName(reference);

      if (functionName === "pictureOfDay:claimPictureOfDayAudioJob") {
        await expectValidPictureWrite("claim-job", args);
        publicationOperations.push("claim-job");
        return { claimed: true } as never;
      }
      if (functionName === "pictureOfDay:generateUploadUrl") {
        await expectValidPictureWrite("generate-upload-url", args);
        publicationOperations.push("generate-upload-url");
        return "https://uploads.example.com/picture" as never;
      }
      if (functionName === "pictureOfDay:savePictureOfDayAudio") {
        const writeArgs = await expectValidPictureWrite("save-record", args);
        publicationOperations.push("save-record");
        persisted = {
          _id: "picture-audio-1",
          ...writeArgs,
          audioUrl:
            writeArgs.status === "ready"
              ? "https://cdn.example.com/edge.mp3"
              : null,
          createdAt: 1,
          updatedAt: 2,
        };
        return "picture-audio-1" as never;
      }
      if (functionName === "pictureOfDay:finalizePictureOfDayAudioJob") {
        await expectValidPictureWrite("finalize-job", args);
        publicationOperations.push("finalize-job");
        return { updated: true } as never;
      }

      throw new Error(`Unexpected mutation: ${functionName}`);
    });

    const ttsRequests: Array<{ provider?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "https://uploads.example.com/picture") {
          return Response.json({ storageId: "edge-storage" });
        }

        ttsRequests.push(
          JSON.parse(String(init?.body)) as { provider?: string },
        );
        return new Response(Uint8Array.of(1, 2, 3), {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            ...buildTtsMetadataHeaders(edgeMetadata),
          },
        });
      }),
    );

    await expect(
      syncPictureOfDayAudio({
        baseUrl: "https://curiogarden.org",
        feedDateIso: "2026-05-08",
        picture,
      }),
    ).resolves.toMatchObject({
      status: "created",
      audio: {
        status: "ready",
        provider: "edge",
        storageId: "edge-storage",
        ttsCacheKey: edgeMetadata.ttsCacheKey,
      },
    });

    expect(ttsRequests).toEqual([
      expect.objectContaining({ provider: "edge" }),
    ]);
    expect(publicationOperations).toEqual([
      "claim-job",
      "save-record",
      "generate-upload-url",
      "save-record",
      "finalize-job",
    ]);
  });
});
