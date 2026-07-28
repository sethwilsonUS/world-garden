import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAudioCacheReadResultAttestation: vi.fn(),
  createAudioCacheWriteFailureAttestation: vi.fn(),
  fetchMutation: vi.fn(),
}));

vi.mock("convex/nextjs", () => ({
  fetchMutation: mocks.fetchMutation,
}));

vi.mock("./tts-quota-bypass", () => ({
  createAudioCacheReadResultAttestation:
    mocks.createAudioCacheReadResultAttestation,
  createAudioCacheWriteFailureAttestation:
    mocks.createAudioCacheWriteFailureAttestation,
}));

import { recordAudioCacheReadResultBestEffort } from "./audio-cache-ledger";

const input = {
  source: "featured_podcast" as const,
  provider: "edge" as const,
  hit: true,
  byteLength: 2_048,
  durationSeconds: 12,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("audio cache ledger helpers", () => {
  it("does no attestation or network work while observation is off", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "off");

    await recordAudioCacheReadResultBestEffort(input);

    expect(mocks.createAudioCacheReadResultAttestation).not.toHaveBeenCalled();
    expect(mocks.fetchMutation).not.toHaveBeenCalled();
  });

  it("attests and records verified read results while observing", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    mocks.createAudioCacheReadResultAttestation.mockResolvedValue({
      scope: "audio-cache-read-result",
    });
    mocks.fetchMutation.mockResolvedValue({
      created: true,
      disposition: "inserted",
    });

    await recordAudioCacheReadResultBestEffort(input);

    expect(mocks.createAudioCacheReadResultAttestation).toHaveBeenCalledWith(
      input,
    );
    expect(mocks.fetchMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        ...input,
        attestation: { scope: "audio-cache-read-result" },
      }),
    );
  });
});
