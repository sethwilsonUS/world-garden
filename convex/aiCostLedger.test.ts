import { describe, expect, it } from "vitest";
import { getCostStatementDisposition } from "./aiCostLedger";
import type { AiCostStatementInput } from "../lib/ai-cost-ledger-contract";

const statement = (
  overrides: Partial<AiCostStatementInput> = {},
): AiCostStatementInput => ({
  statementKey: "statement.2026-07.openai",
  provider: "openai",
  serviceScope: "all_direct_ai",
  periodStartDay: "2026-07-01",
  periodEndDay: "2026-08-01",
  amountMicros: 123_456,
  currency: "USD",
  source: "manual_entry",
  allocationMethod: "estimated_cost_weight",
  ...overrides,
});

describe("AI cost statement upsert", () => {
  it("is insert/update idempotent by the authenticated statement payload", () => {
    const value = statement();
    expect(getCostStatementDisposition(null, value)).toBe("inserted");
    expect(getCostStatementDisposition(value, value)).toBe("duplicate");
    expect(
      getCostStatementDisposition(value, statement({ amountMicros: 123_457 })),
    ).toBe("updated");
  });
});
