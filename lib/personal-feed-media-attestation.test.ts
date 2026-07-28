import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPersonalFeedMediaReadAttestation,
  verifyPersonalFeedMediaReadAttestation,
} from "./personal-feed-media-attestation";

describe("personal feed media read attestations", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("binds a short-lived signature to one feed token and episode", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "personal-media-server-secret");
    const identity = {
      feedToken: "a".repeat(64),
      episodeId: "personalPlaylistEpisodes-1",
    };
    const attestation = await createPersonalFeedMediaReadAttestation(identity);

    expect(attestation.signature).not.toContain("personal-media-server-secret");
    await expect(
      verifyPersonalFeedMediaReadAttestation({
        ...identity,
        attestation,
        secret: "personal-media-server-secret",
      }),
    ).resolves.toBe(true);
    await expect(
      verifyPersonalFeedMediaReadAttestation({
        ...identity,
        episodeId: "personalPlaylistEpisodes-2",
        attestation,
        secret: "personal-media-server-secret",
      }),
    ).resolves.toBe(false);
    await expect(
      verifyPersonalFeedMediaReadAttestation({
        ...identity,
        feedToken: "b".repeat(64),
        attestation,
        secret: "personal-media-server-secret",
      }),
    ).resolves.toBe(false);
  });
});
