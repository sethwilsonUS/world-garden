import { describe, expect, it } from "vitest";
import {
  ACCOUNT_OWNED_AUDIO_MAX_LATE_ACTION_MS,
  ACCOUNT_OWNED_AUDIO_ORPHAN_GRACE_MS,
  ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
  getCombinedAudioStorageContentType,
  isAccountOwnedAudioStorageContentType,
} from "./account-owned-audio-storage";

describe("account-owned audio storage marker", () => {
  it("marks only account-owned combined uploads", () => {
    expect(getCombinedAudioStorageContentType("audio/mpeg", true)).toBe(
      "application/vnd.curiogarden.account-audio",
    );
    expect(getCombinedAudioStorageContentType("audio/mpeg", false)).toBe(
      "audio/mpeg",
    );
  });

  it("recognizes only the exact forward-only marker", () => {
    expect(
      isAccountOwnedAudioStorageContentType(
        "application/vnd.curiogarden.account-audio",
      ),
    ).toBe(true);
    expect(isAccountOwnedAudioStorageContentType("audio/mpeg")).toBe(false);
    expect(
      isAccountOwnedAudioStorageContentType(
        "application/vnd.curiogarden.account-audio; legacy=1",
      ),
    ).toBe(false);
  });

  it("keeps orphan cleanup beyond the late-action safety window", () => {
    expect(ACCOUNT_OWNED_AUDIO_SWEEP_KEY).toBe("account_owned_audio_orphans");
    expect(ACCOUNT_OWNED_AUDIO_MAX_LATE_ACTION_MS).toBe(30 * 60 * 1_000);
    expect(ACCOUNT_OWNED_AUDIO_ORPHAN_GRACE_MS).toBeGreaterThan(
      ACCOUNT_OWNED_AUDIO_MAX_LATE_ACTION_MS,
    );
  });
});
