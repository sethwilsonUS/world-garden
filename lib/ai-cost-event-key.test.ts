import { describe, expect, it } from "vitest";
import { deriveOpaqueAiCostEventKey } from "./ai-cost-event-key";

describe("opaque AI cost event keys", () => {
  it("is deterministic and does not retain account-owned record identifiers", async () => {
    const input = {
      namespace: "pipeline-article-export",
      identityParts: ["export-123", "lease-owner-456"],
      secret: "synthetic-ledger-key-secret",
    };
    const first = await deriveOpaqueAiCostEventKey(input);

    await expect(deriveOpaqueAiCostEventKey(input)).resolves.toBe(first);
    await expect(
      deriveOpaqueAiCostEventKey({
        ...input,
        identityParts: ["export-124", "lease-owner-456"],
      }),
    ).resolves.not.toBe(first);
    expect(first).toMatch(/^opaque:pipeline-article-export:[a-f0-9]{64}$/);
    expect(first).not.toContain("export-123");
    expect(first).not.toContain("lease-owner-456");
  });
});
