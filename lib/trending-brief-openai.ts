import type OpenAI from "openai";
import { getOpenAIClient } from "@/lib/openai-client";

type TrendingOpenAIUsage = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
} | null;

export type TrendingBriefStructuredOutput = {
  headline: string;
  summary: string;
  podcastDescription: string;
  spokenSummary: string;
  keyPoints: string[];
};

type TrendingOpenAIRequestOptions = {
  signal: AbortSignal;
  timeout: number;
  maxRetries: number;
};

type TrendingOpenAIResearchRequest = {
  model: string;
  instructions: string;
  input: string;
  tools: Array<{
    type: "web_search";
    search_context_size: "medium" | "high";
  }>;
  tool_choice: "required";
  include: ["web_search_call.action.sources"];
  reasoning: { effort: "medium" };
  max_output_tokens: number;
  metadata: {
    workflow: "trending-brief";
    stage: "research" | "research-topic";
  };
  safety_identifier: "public-trending-brief";
  store: false;
};

type TrendingOpenAITextFormat = {
  name: string;
  schema: Record<string, unknown>;
  type: "json_schema";
  description?: string;
  strict?: boolean | null;
};

type TrendingOpenAIWritingRequest = {
  model: string;
  instructions: string;
  input: string;
  reasoning: { effort: "medium" };
  max_output_tokens: number;
  text: {
    format: TrendingOpenAITextFormat;
    verbosity: "low" | "medium";
  };
  metadata: {
    workflow: "trending-brief";
    stage: "writing" | "writing-repair";
  };
  safety_identifier: "public-trending-brief";
  store: false;
};

type TrendingOpenAIResearchResponse = {
  model?: string;
  output_text: string;
  output: Array<{ type: string }>;
  usage?: TrendingOpenAIUsage;
};

type TrendingOpenAIWritingResponse = {
  model?: string;
  output_parsed: TrendingBriefStructuredOutput | null;
  usage?: TrendingOpenAIUsage;
};

/**
 * The complete OpenAI surface used by trending-brief generation. Keeping the
 * port here prevents SDK-wide types from leaking into generation tests.
 */
export type TrendingOpenAIClient = {
  responses: {
    create(
      request: TrendingOpenAIResearchRequest,
      options: TrendingOpenAIRequestOptions,
    ): Promise<TrendingOpenAIResearchResponse>;
    parse(
      request: TrendingOpenAIWritingRequest,
      options: TrendingOpenAIRequestOptions,
    ): Promise<TrendingOpenAIWritingResponse>;
  };
};

/** Adapts the shared third-party SDK client to the trending generation port. */
export const createTrendingOpenAIClient = (
  client: OpenAI,
): TrendingOpenAIClient => ({
  responses: {
    create: async (request, options) =>
      await client.responses.create(request, options),
    parse: async (request, options) =>
      await client.responses.parse<
        TrendingOpenAIWritingRequest,
        TrendingBriefStructuredOutput
      >(request, options),
  },
});

export const getTrendingOpenAIClient = (): TrendingOpenAIClient =>
  createTrendingOpenAIClient(getOpenAIClient());
