import { describe, expect, it } from "vitest";
import { verifyServerAttestation } from "./server-attestation";
import {
  AI_COST_MAX_STATEMENT_AMOUNT_MICROS,
  AI_COST_PROVIDER_ATTEMPT_ATTESTATION_SCOPE,
  assertValidAiCostProviderAttempt,
  createAiCostProviderAttemptAttestation,
  getAiCostLedgerMode,
  getAiCostProviderAttemptAttestationPayload,
  parseAiCostStatementInput,
  type AiCostProviderAttempt,
} from "./ai-cost-ledger-contract";

const attempt = (
  overrides: Partial<AiCostProviderAttempt> = {},
): AiCostProviderAttempt => ({
  eventKey: "1a8ea99d-45f5-45e8-9748-e54f20e1058a",
  correlationId: "271a4e23-f449-41f7-8c20-e32f531a4691",
  lifecycleVersion: 0,
  operation: "tts",
  source: "interactive_article",
  requestedProvider: "openai",
  effectiveProvider: "openai",
  model: "gpt-4o-mini-tts",
  serviceTier: null,
  profile: "marin",
  state: "unknown_after_dispatch",
  failureCategory: "unknown",
  dispatchedAt: 1_800_000_000_000,
  completedAt: null,
  inputCharacters: 120,
  inputWords: 20,
  inputTokens: null,
  cachedInputTokens: null,
  cacheWriteInputTokens: null,
  outputTokens: null,
  reasoningOutputTokens: null,
  audioInputTokens: null,
  audioOutputTokens: null,
  webSearchCalls: null,
  responseAudioBytes: null,
  audioDurationMs: null,
  durationMeasurement: "unknown",
  isFallbackAttempt: false,
  ...overrides,
});

describe("AI cost ledger contract", () => {
  it("defaults absent and invalid modes to off", () => {
    expect(getAiCostLedgerMode({})).toBe("off");
    expect(getAiCostLedgerMode({ AI_COST_LEDGER_MODE: "enforce" })).toBe("off");
    expect(getAiCostLedgerMode({ AI_COST_LEDGER_MODE: "observe" })).toBe(
      "observe",
    );
  });

  it("allows only an ambiguous dispatched attempt at lifecycle version zero", () => {
    expect(() => assertValidAiCostProviderAttempt(attempt())).not.toThrow();
    expect(() =>
      assertValidAiCostProviderAttempt(
        attempt({ lifecycleVersion: 0, state: "succeeded" }),
      ),
    ).toThrow("lifecycle version zero");
  });

  it("binds provider-write attestations to every attempt field", async () => {
    const value = attempt();
    const secret = "tts-write-secret";
    const attestation = await createAiCostProviderAttemptAttestation(value, {
      secret,
      now: 1_800_000_000_001,
      nonce: "provider-attempt-test",
    });

    await expect(
      verifyServerAttestation({
        attestation,
        scope: AI_COST_PROVIDER_ATTEMPT_ATTESTATION_SCOPE,
        payload: getAiCostProviderAttemptAttestationPayload(value),
        secret,
        now: 1_800_000_000_002,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyServerAttestation({
        attestation,
        scope: AI_COST_PROVIDER_ATTEMPT_ATTESTATION_SCOPE,
        payload: getAiCostProviderAttemptAttestationPayload(
          attempt({ inputCharacters: 121 }),
        ),
        secret,
        now: 1_800_000_000_002,
      }),
    ).resolves.toBe(false);
  });

  it("rejects prohibited content, URLs, routes, and raw errors", () => {
    for (const value of [
      "https://example.com/full/provider/url",
      "/article/the-fellowship-of-the-ring",
      "The Fellowship of the Ring",
      "Provider timeout: raw upstream error\nstack trace",
    ]) {
      expect(() =>
        assertValidAiCostProviderAttempt(attempt({ model: value })),
      ).toThrow("provider identifier");
    }
    expect(() =>
      assertValidAiCostProviderAttempt({
        ...attempt(),
        articleText: "In a hole in the ground...",
      } as never),
    ).toThrow("unsupported field");
  });

  it("rejects free-text statement notes instead of risking secrets or invoice contents", () => {
    expect(() =>
      parseAiCostStatementInput({
        statementKey: "statement.2026-07.openai",
        provider: "openai",
        serviceScope: "all_direct_ai",
        periodStartDay: "2026-07-01",
        periodEndDay: "2026-08-01",
        amountMicros: 123_456,
        currency: "USD",
        source: "manual_entry",
        allocationMethod: "unallocated",
        allocationNote: "invoice@example.com / secret-token",
      }),
    ).toThrow("unsupported field");
  });

  it("bounds each statement so exact-cover totals remain safe integers", () => {
    const base = {
      statementKey: "statement.2026-07.openai",
      provider: "openai",
      serviceScope: "all_direct_ai",
      periodStartDay: "2026-07-01",
      periodEndDay: "2026-08-01",
      currency: "USD",
      source: "manual_entry",
      allocationMethod: "unallocated",
    };

    expect(
      parseAiCostStatementInput({
        ...base,
        amountMicros: AI_COST_MAX_STATEMENT_AMOUNT_MICROS,
      }).amountMicros,
    ).toBe(AI_COST_MAX_STATEMENT_AMOUNT_MICROS);
    expect(() =>
      parseAiCostStatementInput({
        ...base,
        amountMicros: AI_COST_MAX_STATEMENT_AMOUNT_MICROS + 1,
      }),
    ).toThrow("amountMicros exceeds");
  });
});
