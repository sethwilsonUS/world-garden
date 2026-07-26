import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import {
  PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
  buildPictureOfDayAudioTitle,
  buildPictureOfDaySpeechScript,
  syncPictureOfDayAudio,
} from "./picture-of-day-audio";
import type { WikipediaPictureOfDay } from "./featured-article";
import { getTtsProfile } from "./tts-profile";

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

  it("keeps prior ready audio available when an Edge replacement fails", async () => {
    vi.stubEnv("TTS_PRIMARY_PROVIDER", "openai");
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
    vi.mocked(fetchMutation).mockImplementation(async (...callArgs) => {
      const [reference, args] = callArgs;
      const functionName = getFunctionName(reference);
      if (functionName === "pictureOfDay:claimPictureOfDayAudioJob") {
        return { claimed: true } as never;
      }
      if (functionName === "pictureOfDay:savePictureOfDayAudio") {
        persisted = {
          ...persisted,
          ...((args ?? {}) as object),
          audioUrl: (args as { storageId?: string }).storageId
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
      status: "ready",
      audioUrl: "https://cdn.example.com/openai.mp3",
      storageId: "openai-storage",
      ttsCacheKey: getTtsProfile("openai").ttsCacheKey,
    });
  });
});
