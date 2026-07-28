import { describe, expect, it } from "vitest";
import { verifyServerAttestation } from "./server-attestation";
import {
  AI_COST_COVERAGE_RESET_ATTESTATION_SCOPE,
  AI_COST_REPORT_ATTESTATION_SCOPE,
  assertValidAiCostReportRange,
  createAiCostCoverageResetAttestation,
  createAiCostReportAttestation,
  createAiCostStatementAttestation,
  getAiCostCoverageResetAttestationPayload,
  getAiCostReportAttestationPayload,
  parseAiCostCoverageReset,
  verifyAiCostCoverageResetAttestation,
  verifyAiCostStatementAttestation,
} from "./ai-cost-owner-attestation";

describe("AI cost owner attestations", () => {
  it("accepts a half-open range of at most 90 UTC days", () => {
    expect(() =>
      assertValidAiCostReportRange({
        fromDay: "2026-07-01",
        toDay: "2026-08-01",
      }),
    ).not.toThrow();
    expect(() =>
      assertValidAiCostReportRange({
        fromDay: "2026-01-01",
        toDay: "2026-04-02",
      }),
    ).toThrow("90 days");
  });

  it("binds the owner report attestation to both endpoints", async () => {
    const range = { fromDay: "2026-07-01", toDay: "2026-08-01" };
    const secret = "owner-report-secret";
    const attestation = await createAiCostReportAttestation(range, {
      secret,
      now: 1_800_000_000_000,
      nonce: "owner-report-test",
    });

    await expect(
      verifyServerAttestation({
        attestation,
        scope: AI_COST_REPORT_ATTESTATION_SCOPE,
        payload: getAiCostReportAttestationPayload(range),
        secret,
        now: 1_800_000_000_001,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyServerAttestation({
        attestation,
        scope: AI_COST_REPORT_ATTESTATION_SCOPE,
        payload: getAiCostReportAttestationPayload({
          ...range,
          toDay: "2026-08-02",
        }),
        secret,
        now: 1_800_000_000_001,
      }),
    ).resolves.toBe(false);
  });

  it("binds a statement attestation to its key, period, and amount", async () => {
    const statement = {
      statementKey: "statement.2026-07.openai",
      provider: "openai" as const,
      serviceScope: "all_direct_ai" as const,
      periodStartDay: "2026-07-01",
      periodEndDay: "2026-08-01",
      amountMicros: 456_789,
      currency: "USD" as const,
      source: "manual_entry" as const,
      allocationMethod: "estimated_cost_weight" as const,
    };
    const secret = "owner-report-secret";
    const now = 1_800_000_000_000;
    const attestation = await createAiCostStatementAttestation(statement, {
      secret,
      now,
      nonce: "owner-statement-test",
    });

    await expect(
      verifyAiCostStatementAttestation({
        statement,
        attestation,
        secret,
        now: now + 1,
      }),
    ).resolves.toBe(true);
    for (const tampered of [
      { ...statement, statementKey: "statement.2026-07.edge" },
      { ...statement, periodEndDay: "2026-09-01" },
      { ...statement, amountMicros: statement.amountMicros + 1 },
    ]) {
      await expect(
        verifyAiCostStatementAttestation({
          statement: tampered,
          attestation,
          secret,
          now: now + 1,
        }),
      ).resolves.toBe(false);
    }
  });

  it("strictly parses and payload-binds a coverage epoch reset", async () => {
    const reset = parseAiCostCoverageReset({ epochKey: "epoch.reset-0001" });
    const secret = "owner-report-secret";
    const now = 1_800_000_000_000;
    const attestation = await createAiCostCoverageResetAttestation(reset, {
      secret,
      now,
      nonce: "coverage-reset-test",
    });

    await expect(
      verifyServerAttestation({
        attestation,
        scope: AI_COST_COVERAGE_RESET_ATTESTATION_SCOPE,
        payload: getAiCostCoverageResetAttestationPayload(reset),
        secret,
        now: now + 1,
      }),
    ).resolves.toBe(true);
    await expect(
      verifyAiCostCoverageResetAttestation({
        reset: { epochKey: "epoch.reset-0002" },
        attestation,
        secret,
        now: now + 1,
      }),
    ).resolves.toBe(false);
    expect(() =>
      parseAiCostCoverageReset({
        epochKey: "epoch.reset-0001",
        note: "do not accept free text",
      }),
    ).toThrow("unsupported field");
  });
});
