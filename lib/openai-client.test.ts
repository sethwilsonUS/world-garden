import { afterEach, describe, expect, it, vi } from "vitest";

const OpenAI = vi.hoisted(() =>
  vi.fn(function MockOpenAI(options: unknown) {
    return { options };
  }),
);

vi.mock("openai", () => ({ default: OpenAI }));

const originalApiKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalApiKey;
  vi.resetModules();
  vi.clearAllMocks();
});

describe("shared OpenAI client", () => {
  it("passes the same trimmed key that configuration validation accepts", async () => {
    process.env.OPENAI_API_KEY = "  test-openai-key  ";
    const { getOpenAIClient, isOpenAIConfigured } = await import(
      "./openai-client"
    );

    expect(isOpenAIConfigured()).toBe(true);
    getOpenAIClient();
    expect(OpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "test-openai-key" }),
    );
  });

  it("rejects a whitespace-only key", async () => {
    process.env.OPENAI_API_KEY = "   ";
    const { getOpenAIClient } = await import("./openai-client");
    expect(() => getOpenAIClient()).toThrow("OpenAI API is not configured");
    expect(OpenAI).not.toHaveBeenCalled();
  });
});
