import OpenAI from "openai";

const OPENAI_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;

let openAIClient: OpenAI | null = null;

export const isOpenAIConfigured = (): boolean =>
  Boolean(process.env.OPENAI_API_KEY?.trim());

/**
 * Returns the shared server-side OpenAI client. Construction stays lazy so
 * read-only routes and unit tests do not require API credentials at import time.
 */
export const getOpenAIClient = (): OpenAI => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OpenAI API is not configured.");
  }

  openAIClient ??= new OpenAI({
    apiKey,
    maxRetries: 2,
    timeout: OPENAI_REQUEST_TIMEOUT_MS,
  });

  return openAIClient;
};
