import { describe, expect, it, vi } from "vitest";
import type { AiCostProviderAttempt } from "./ai-cost-ledger-contract";
import { createFailOpenAiCostAttemptRecorder } from "./ai-cost-provider-recorder";

const attempt: AiCostProviderAttempt = {
  eventKey: "attempt-opaque-key",
  correlationId: "correlation-opaque-key",
  lifecycleVersion: 1,
  operation: "trending_brief_writing",
  source: "trending_brief",
  requestedProvider: "openai",
  effectiveProvider: "openai",
  model: "gpt-5.6-luna",
  serviceTier: "auto",
  profile: null,
  state: "succeeded",
  failureCategory: null,
  dispatchedAt: 1_000,
  completedAt: 1_050,
  inputCharacters: null,
  inputWords: null,
  inputTokens: 10,
  cachedInputTokens: 2,
  cacheWriteInputTokens: 0,
  outputTokens: 4,
  reasoningOutputTokens: 1,
  audioInputTokens: null,
  audioOutputTokens: null,
  webSearchCalls: null,
  responseAudioBytes: null,
  audioDurationMs: null,
  durationMeasurement: "unknown",
  isFallbackAttempt: false,
};

describe("AI cost provider recorder", () => {
  it("attests and writes an observation without remapping its bounded fields", async () => {
    const attestation = {
      issuedAt: 1,
      expiresAt: 2,
      nonce: "nonce",
      signature: "signature",
    };
    const createAttestation = vi.fn(async () => attestation);
    const sink = vi.fn(async () => ({ recorded: true }));
    const record = createFailOpenAiCostAttemptRecorder({
      getMode: () => "observe",
      createAttestation,
      sink,
    });

    await expect(record(attempt)).resolves.toBeUndefined();
    expect(createAttestation).toHaveBeenCalledWith(attempt);
    expect(sink).toHaveBeenCalledWith({ attempt, attestation });
  });

  it("does nothing in off mode and swallows observe-mode sink failures", async () => {
    const sink = vi.fn(async () => {
      throw new Error("database details must not escape");
    });
    const createAttestation = vi.fn(async () => ({
      issuedAt: 1,
      expiresAt: 2,
      nonce: "nonce",
      signature: "signature",
    }));
    const warn = vi.fn();
    const off = createFailOpenAiCostAttemptRecorder({
      getMode: () => "off",
      createAttestation,
      sink,
      warn,
    });
    await expect(off(attempt)).resolves.toBeUndefined();
    expect(createAttestation).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();

    const observe = createFailOpenAiCostAttemptRecorder({
      getMode: () => "observe",
      createAttestation,
      sink,
      warn,
    });
    await expect(observe(attempt)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[ai-cost-ledger] Provider attempt recording failed.",
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("database details");
  });
});
