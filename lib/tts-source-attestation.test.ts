import { describe, expect, it } from "vitest";
import {
  createTtsSourceAttestationHeaderValue,
  resolveTtsAiCostSource,
  TTS_AI_COST_SOURCE_ATTESTATION_TTL_MS,
  TTS_AI_COST_SOURCE_ATTESTATION_HEADER,
  TTS_AI_COST_SOURCE_HEADER,
} from "./tts-source-attestation";

const SECRET = "trusted-tts-source-secret";
const NOW = 1_800_000_000_000;

describe("TTS AI-cost source attestations", () => {
  it("accepts a bounded source only when a server attestation binds that source", async () => {
    const attestation = await createTtsSourceAttestationHeaderValue(
      "featured_podcast",
      {
        secret: SECRET,
        now: NOW,
        nonce: "featured-podcast-test",
      },
    );

    await expect(
      resolveTtsAiCostSource(
        new Headers({
          [TTS_AI_COST_SOURCE_HEADER]: "featured_podcast",
          [TTS_AI_COST_SOURCE_ATTESTATION_HEADER]: attestation,
        }),
        { secret: SECRET, now: NOW + 1 },
      ),
    ).resolves.toBe("featured_podcast");
    await expect(
      resolveTtsAiCostSource(
        new Headers({
          [TTS_AI_COST_SOURCE_HEADER]: "picture_of_day",
          [TTS_AI_COST_SOURCE_ATTESTATION_HEADER]: attestation,
        }),
        { secret: SECRET, now: NOW + 1 },
      ),
    ).resolves.toBe("unknown");
    await expect(
      resolveTtsAiCostSource(
        new Headers({
          [TTS_AI_COST_SOURCE_HEADER]: "featured_podcast",
          [TTS_AI_COST_SOURCE_ATTESTATION_HEADER]: attestation,
        }),
        {
          secret: SECRET,
          now: NOW + TTS_AI_COST_SOURCE_ATTESTATION_TTL_MS - 1,
        },
      ),
    ).resolves.toBe("featured_podcast");
    await expect(
      resolveTtsAiCostSource(
        new Headers({
          [TTS_AI_COST_SOURCE_HEADER]: "featured_podcast",
          [TTS_AI_COST_SOURCE_ATTESTATION_HEADER]: attestation,
        }),
        {
          secret: SECRET,
          now: NOW + TTS_AI_COST_SOURCE_ATTESTATION_TTL_MS,
        },
      ),
    ).resolves.toBe("unknown");
  });

  it("assigns the public route default only when no source claim is present", async () => {
    await expect(resolveTtsAiCostSource(new Headers())).resolves.toBe(
      "interactive_article",
    );
    await expect(
      resolveTtsAiCostSource(
        new Headers({
          [TTS_AI_COST_SOURCE_HEADER]: "picture_of_day",
        }),
        { secret: SECRET, now: NOW + 1 },
      ),
    ).resolves.toBe("unknown");
    await expect(
      resolveTtsAiCostSource(
        new Headers({
          [TTS_AI_COST_SOURCE_HEADER]: "not-a-real-source",
          [TTS_AI_COST_SOURCE_ATTESTATION_HEADER]: "{}",
        }),
        { secret: SECRET, now: NOW + 1 },
      ),
    ).resolves.toBe("unknown");
  });
});
