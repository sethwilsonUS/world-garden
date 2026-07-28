import { describe, expect, it, vi } from "vitest";
import {
  createAiCostOperationContext,
  createInstrumentedOpenAiFetch,
  runWithAiCostOperationContext,
} from "./openai-client";
import type { AiCostProviderAttempt } from "./ai-cost-ledger-contract";

describe("OpenAI provider dispatch instrumentation", () => {
  it("records a boundary and terminal usage without retaining provider content", async () => {
    const record = vi.fn<(attempt: AiCostProviderAttempt) => Promise<void>>(
      async () => undefined,
    );
    const providerFetch = vi.fn<typeof fetch>(async () =>
      Response.json({
        id: "provider-response-id-must-not-be-recorded",
        model: "gpt-5.6-luna-2026-07-01",
        service_tier: "priority",
        output: [{ type: "message", text: "private generated response" }],
        usage: {
          input_tokens: 120,
          input_tokens_details: {
            cached_tokens: 20,
            cache_write_tokens: 5,
          },
          output_tokens: 45,
          output_tokens_details: { reasoning_tokens: 12 },
          total_tokens: 165,
        },
      }),
    );
    const instrumentedFetch = createInstrumentedOpenAiFetch({
      fetch: providerFetch,
      record,
      now: vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_125),
      createId: vi
        .fn()
        .mockReturnValueOnce("correlation-id")
        .mockReturnValueOnce("attempt-id"),
    });
    const context = createAiCostOperationContext({
      operation: "article_context_generation",
      source: "article_context",
      model: "gpt-5.6-luna",
    });

    const response = await runWithAiCostOperationContext(context, () =>
      instrumentedFetch("https://api.openai.com/v1/responses", {
        method: "POST",
        body: JSON.stringify({ input: "private article content" }),
      }),
    );
    await expect(response.json()).resolves.toHaveProperty(
      "id",
      "provider-response-id-must-not-be-recorded",
    );
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2));

    expect(record.mock.calls[0]?.[0]).toMatchObject({
      eventKey: "attempt-id",
      correlationId: "correlation-id",
      lifecycleVersion: 0,
      operation: "article_context_generation",
      source: "article_context",
      requestedProvider: "openai",
      effectiveProvider: "openai",
      model: "gpt-5.6-luna",
      state: "unknown_after_dispatch",
      dispatchedAt: 1_000,
      completedAt: null,
      inputTokens: null,
      outputTokens: null,
    });
    expect(record.mock.calls[1]?.[0]).toMatchObject({
      eventKey: "attempt-id",
      correlationId: "correlation-id",
      lifecycleVersion: 1,
      model: "gpt-5.6-luna-2026-07-01",
      serviceTier: "priority",
      state: "succeeded",
      failureCategory: null,
      dispatchedAt: 1_000,
      completedAt: 1_125,
      inputTokens: 120,
      cachedInputTokens: 20,
      cacheWriteInputTokens: 5,
      outputTokens: 45,
      reasoningOutputTokens: 12,
    });

    const recorded = JSON.stringify(record.mock.calls);
    expect(recorded).not.toContain("private article content");
    expect(recorded).not.toContain("private generated response");
    expect(recorded).not.toContain("provider-response-id");
  });

  it("keeps SDK retries correlated while assigning each dispatch a distinct event key", async () => {
    const record = vi.fn<(attempt: AiCostProviderAttempt) => Promise<void>>(
      async () => undefined,
    );
    const providerFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: { type: "server_error" } }, { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          model: "gpt-5.6-luna",
          service_tier: "auto",
          output: [],
          usage: null,
        }),
      );
    const ids = ["retry-correlation", "attempt-one", "attempt-two"];
    const instrumentedFetch = createInstrumentedOpenAiFetch({
      fetch: providerFetch,
      record,
      createId: () => ids.shift() ?? "unexpected-id",
    });
    const context = createAiCostOperationContext({
      operation: "trending_brief_writing",
      source: "trending_brief",
      model: "gpt-5.6-luna",
    });

    await runWithAiCostOperationContext(context, async () => {
      const first = await instrumentedFetch(
        "https://api.openai.com/v1/responses",
      );
      expect(first.status).toBe(503);
      const second = await instrumentedFetch(
        "https://api.openai.com/v1/responses",
      );
      expect(second.status).toBe(200);
    });
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(4));

    const attempts = record.mock.calls.map(([attempt]) => attempt);
    expect(attempts.map(({ correlationId }) => correlationId)).toEqual([
      "retry-correlation",
      "retry-correlation",
      "retry-correlation",
      "retry-correlation",
    ]);
    expect(attempts.map(({ eventKey }) => eventKey)).toEqual([
      "attempt-one",
      "attempt-one",
      "attempt-two",
      "attempt-two",
    ]);
    expect(attempts.map(({ state }) => state)).toEqual([
      "unknown_after_dispatch",
      "failed_after_dispatch",
      "unknown_after_dispatch",
      "succeeded",
    ]);
    expect(attempts[1]?.failureCategory).toBe("provider_http_5xx");
  });

  it("preserves ambiguous network dispatches without leaking error details", async () => {
    const record = vi.fn<(attempt: AiCostProviderAttempt) => Promise<void>>(
      async () => undefined,
    );
    const instrumentedFetch = createInstrumentedOpenAiFetch({
      fetch: vi.fn(async () => {
        throw new TypeError("private network and request details");
      }),
      record,
      createId: vi
        .fn()
        .mockReturnValueOnce("network-correlation")
        .mockReturnValueOnce("network-attempt"),
    });
    const context = createAiCostOperationContext({
      operation: "trending_brief_research",
      source: "trending_brief",
      model: "gpt-5.6-luna",
    });

    await expect(
      runWithAiCostOperationContext(context, () =>
        instrumentedFetch("https://api.openai.com/v1/responses"),
      ),
    ).rejects.toThrow("private network and request details");
    await vi.waitFor(() => expect(record).toHaveBeenCalledTimes(2));

    expect(record.mock.calls[1]?.[0]).toMatchObject({
      lifecycleVersion: 1,
      state: "unknown_after_dispatch",
      failureCategory: "network",
      completedAt: expect.any(Number),
    });
    expect(JSON.stringify(record.mock.calls)).not.toContain(
      "private network and request details",
    );
  });

  it("uses the provider uninstrumented when ledger identity creation fails", async () => {
    const response = Response.json({ output: [{ text: "still delivered" }] });
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const record = vi.fn<(attempt: AiCostProviderAttempt) => Promise<void>>(
      async () => undefined,
    );
    const instrumentedFetch = createInstrumentedOpenAiFetch({
      fetch: providerFetch,
      record,
      createId: () => {
        throw new Error("UUID source unavailable");
      },
    });
    const context = createAiCostOperationContext({
      operation: "article_context_generation",
      source: "article_context",
      model: "gpt-5.6-luna",
    });

    const actual = await runWithAiCostOperationContext(context, () =>
      instrumentedFetch("https://api.openai.com/v1/responses"),
    );

    expect(actual).toBe(response);
    await expect(actual.json()).resolves.toEqual({
      output: [{ text: "still delivered" }],
    });
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(record).not.toHaveBeenCalled();
  });

  it("returns a successful provider response when cloning for usage observation fails", async () => {
    const response = Response.json({ output: [{ text: "still delivered" }] });
    vi.spyOn(response, "clone").mockImplementation(() => {
      throw new Error("response body cannot be cloned");
    });
    const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const record = vi.fn<(attempt: AiCostProviderAttempt) => Promise<void>>(
      async () => undefined,
    );
    const ids = ["clone-correlation", "clone-attempt"];
    const instrumentedFetch = createInstrumentedOpenAiFetch({
      fetch: providerFetch,
      record,
      createId: () => ids.shift() ?? "unexpected-id",
    });
    const context = createAiCostOperationContext({
      operation: "article_context_generation",
      source: "article_context",
      model: "gpt-5.6-luna",
    });

    const actual = await runWithAiCostOperationContext(context, () =>
      instrumentedFetch("https://api.openai.com/v1/responses"),
    );

    expect(actual).toBe(response);
    await expect(actual.json()).resolves.toEqual({
      output: [{ text: "still delivered" }],
    });
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledOnce();
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      eventKey: "clone-attempt",
      state: "unknown_after_dispatch",
    });
  });
});
