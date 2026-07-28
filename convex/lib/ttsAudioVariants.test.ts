import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  getSupersededTtsAudioStorageIds,
  type TtsAudioVariant,
} from "./ttsAudioVariants";

const storageId = (value: string) => value as Id<"_storage">;

const variant = (id: string, ttsCacheKey: string): TtsAudioVariant => ({
  storageId: storageId(id),
  ttsCacheKey,
  provider: "openai",
  model: "gpt-4o-mini-tts",
  voiceId: "sage",
  promptVersion: "v1",
  ttsNormVersion: "v1",
  createdAt: 1,
});

describe("getSupersededTtsAudioStorageIds", () => {
  it("returns each old blob that is no longer referenced", () => {
    expect(
      getSupersededTtsAudioStorageIds({
        previousPrimaryStorageId: storageId("old-primary"),
        previousVariants: [
          variant("old-primary", "voice-a"),
          variant("keep", "voice-b"),
          variant("orphan", "voice-c"),
        ],
        nextPrimaryStorageId: storageId("new-primary"),
        nextVariants: [
          variant("new-primary", "voice-a"),
          variant("keep", "voice-b"),
        ],
      }),
    ).toEqual([storageId("old-primary"), storageId("orphan")]);
  });

  it("deduplicates references and preserves blobs retained anywhere", () => {
    expect(
      getSupersededTtsAudioStorageIds({
        previousPrimaryStorageId: storageId("shared"),
        previousVariants: [
          variant("shared", "voice-a"),
          variant("removed", "voice-b"),
          variant("removed", "voice-c"),
        ],
        nextPrimaryStorageId: storageId("shared"),
        nextVariants: [variant("shared", "voice-a")],
      }),
    ).toEqual([storageId("removed")]);
  });

  it("returns all prior references when audio is cleared", () => {
    expect(
      getSupersededTtsAudioStorageIds({
        previousPrimaryStorageId: storageId("primary"),
        previousVariants: [
          variant("primary", "voice-a"),
          variant("alternate", "voice-b"),
        ],
      }),
    ).toEqual([storageId("primary"), storageId("alternate")]);
  });
});
