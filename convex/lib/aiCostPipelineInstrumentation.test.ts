import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recordCacheWriteFailureBestEffort,
  recordPipelineOutcomeBestEffort,
} from "./aiCostPipelineInstrumentation";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("AI cost pipeline instrumentation", () => {
  it.each([
    [
      "pipeline outcomes",
      async (runMutation: ReturnType<typeof vi.fn>) =>
        await recordPipelineOutcomeBestEffort(
          { runMutation } as never,
          {} as never,
        ),
    ],
    [
      "cache-write failures",
      async (runMutation: ReturnType<typeof vi.fn>) =>
        await recordCacheWriteFailureBestEffort({ runMutation } as never, {
          eventKey: "cache-write-failure:opaque-asset",
          source: "personal_playlist",
          provider: "edge",
        }),
    ],
  ])(
    "skips %s without a mutation round trip while observation is off",
    async (_label, record) => {
      vi.stubEnv("AI_COST_LEDGER_MODE", "off");
      const runMutation = vi.fn().mockResolvedValue({
        created: false,
        disposition: "disabled",
      });

      await record(runMutation);

      expect(runMutation).toHaveBeenCalledTimes(0);
    },
  );
});
