import { AsyncLocalStorage } from "node:async_hooks";
import OpenAI from "openai";
import {
  type AiCostFailureCategory,
  type AiCostOperation,
  type AiCostProviderAttempt,
  type AiCostServiceTier,
  type AiCostSource,
} from "./ai-cost-ledger-contract";
import { recordProviderAttemptFailOpen } from "./ai-cost-provider-recorder";

const OPENAI_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const AI_COST_PROVIDER_IDENTIFIER_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,119}$/;

const normalizeProviderIdentifier = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const identifier = value.trim();
  return AI_COST_PROVIDER_IDENTIFIER_PATTERN.test(identifier)
    ? identifier
    : null;
};

export type AiCostAttemptRecorder = (
  attempt: AiCostProviderAttempt,
) => void | Promise<void>;

type ActiveAiCostOperationContext = {
  operation: AiCostOperation;
  source: AiCostSource;
  model: string | null;
  correlationId: string | null;
  latestSuccessfulAttempt: AiCostProviderAttempt | null;
  latestTerminalObservation: Promise<void> | null;
  recorder: AiCostAttemptRecorder | null;
};

export type AiCostOperationContext = ActiveAiCostOperationContext;

const operationContextStorage =
  new AsyncLocalStorage<ActiveAiCostOperationContext>();

const createRandomId = (): string => globalThis.crypto.randomUUID();

export const createAiCostOperationContext = ({
  operation,
  source,
  model = null,
}: {
  operation: AiCostOperation;
  source: AiCostSource;
  model?: string | null;
}): AiCostOperationContext => ({
  operation,
  source,
  model: normalizeProviderIdentifier(model),
  correlationId: null,
  latestSuccessfulAttempt: null,
  latestTerminalObservation: null,
  recorder: null,
});

export const runWithAiCostOperationContext = async <T>(
  context: AiCostOperationContext,
  operation: () => Promise<T>,
): Promise<T> => await operationContextStorage.run(context, operation);

export const recordAiCostOperationSupplement = ({
  context,
  webSearchCalls,
}: {
  context: AiCostOperationContext;
  webSearchCalls: number;
}): void => {
  const observation = context.latestTerminalObservation;
  const record = context.recorder;
  if (!observation || !record) return;

  void observation.then(() => {
    const latest = context.latestSuccessfulAttempt;
    if (
      !latest ||
      !Number.isSafeInteger(webSearchCalls) ||
      webSearchCalls < 0
    ) {
      return;
    }
    notifyRecorder(record, {
      ...latest,
      lifecycleVersion: Math.max(2, latest.lifecycleVersion + 1),
      webSearchCalls,
    });
  });
};

const nullableNonNegativeInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;

const boundedModel = (
  value: unknown,
  fallback: string | null,
): string | null => {
  return (
    normalizeProviderIdentifier(value) ?? normalizeProviderIdentifier(fallback)
  );
};

const normalizeServiceTier = (value: unknown): AiCostServiceTier | null => {
  if (typeof value !== "string") return null;
  if (
    value === "default" ||
    value === "auto" ||
    value === "flex" ||
    value === "priority" ||
    value === "scale"
  ) {
    return value;
  }
  return "unknown";
};

const emptyAttemptMeasurements = {
  inputCharacters: null,
  inputWords: null,
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
} as const;

const notifyRecorder = (
  record: AiCostAttemptRecorder,
  attempt: AiCostProviderAttempt,
): void => {
  try {
    void Promise.resolve(record(attempt)).catch(() => {
      console.warn("[ai-cost-ledger] Provider attempt recording failed.");
    });
  } catch {
    console.warn("[ai-cost-ledger] Provider attempt recording failed.");
  }
};

const classifyFetchError = (error: unknown): AiCostFailureCategory => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "aborted";
  }
  if (error instanceof TypeError) return "network";
  return "unknown";
};

type OpenAiUsageResponse = {
  model?: unknown;
  service_tier?: unknown;
  usage?: {
    input_tokens?: unknown;
    input_tokens_details?: {
      cached_tokens?: unknown;
      cache_write_tokens?: unknown;
    } | null;
    output_tokens?: unknown;
    output_tokens_details?: { reasoning_tokens?: unknown } | null;
  } | null;
};

const observeSuccessfulOpenAiResponse = async ({
  response,
  boundaryAttempt,
  context,
  record,
  now,
}: {
  response: Response;
  boundaryAttempt: AiCostProviderAttempt;
  context: ActiveAiCostOperationContext;
  record: AiCostAttemptRecorder;
  now: () => number;
}): Promise<void> => {
  let payload: OpenAiUsageResponse;
  try {
    payload = (await response.json()) as OpenAiUsageResponse;
  } catch {
    notifyRecorder(record, {
      ...boundaryAttempt,
      lifecycleVersion: 1,
      state: "failed_after_dispatch",
      failureCategory: "invalid_response",
      completedAt: now(),
    });
    return;
  }

  const usage = payload.usage;
  const terminalAttempt: AiCostProviderAttempt = {
    ...boundaryAttempt,
    lifecycleVersion: 1,
    model: boundedModel(payload.model, boundaryAttempt.model),
    serviceTier: normalizeServiceTier(payload.service_tier),
    state: "succeeded",
    failureCategory: null,
    completedAt: now(),
    inputTokens: nullableNonNegativeInteger(usage?.input_tokens),
    cachedInputTokens: nullableNonNegativeInteger(
      usage?.input_tokens_details?.cached_tokens,
    ),
    cacheWriteInputTokens: nullableNonNegativeInteger(
      usage?.input_tokens_details?.cache_write_tokens,
    ),
    outputTokens: nullableNonNegativeInteger(usage?.output_tokens),
    reasoningOutputTokens: nullableNonNegativeInteger(
      usage?.output_tokens_details?.reasoning_tokens,
    ),
  };
  context.latestSuccessfulAttempt = terminalAttempt;
  notifyRecorder(record, terminalAttempt);
};

export const createInstrumentedOpenAiFetch =
  ({
    fetch: providerFetch,
    record,
    now = Date.now,
    createId = createRandomId,
  }: {
    fetch: typeof fetch;
    record: AiCostAttemptRecorder;
    now?: () => number;
    createId?: () => string;
  }): typeof fetch =>
  async (input, init) => {
    const context = operationContextStorage.getStore();
    if (!context) return await providerFetch(input, init);

    let boundaryAttempt: AiCostProviderAttempt;
    try {
      context.recorder = record;
      context.correlationId ??= createId();
      boundaryAttempt = {
        eventKey: createId(),
        correlationId: context.correlationId,
        lifecycleVersion: 0,
        operation: context.operation,
        source: context.source,
        requestedProvider: "openai",
        effectiveProvider: "openai",
        model: context.model,
        serviceTier: null,
        profile: null,
        state: "unknown_after_dispatch",
        failureCategory: null,
        dispatchedAt: now(),
        completedAt: null,
        ...emptyAttemptMeasurements,
        durationMeasurement: "unknown",
        isFallbackAttempt: false,
      };
    } catch {
      console.warn(
        "[ai-cost-ledger] Provider attempt identity could not be created.",
      );
      return await providerFetch(input, init);
    }

    notifyRecorder(record, boundaryAttempt);

    let response: Response;
    try {
      response = await providerFetch(input, init);
    } catch (error) {
      notifyRecorder(record, {
        ...boundaryAttempt,
        lifecycleVersion: 1,
        state: "unknown_after_dispatch",
        failureCategory: classifyFetchError(error),
        completedAt: now(),
      });
      throw error;
    }

    if (!response.ok) {
      notifyRecorder(record, {
        ...boundaryAttempt,
        lifecycleVersion: 1,
        state: "failed_after_dispatch",
        failureCategory:
          response.status >= 500 ? "provider_http_5xx" : "provider_http_4xx",
        completedAt: now(),
      });
      context.latestTerminalObservation = Promise.resolve();
      return response;
    }

    let observationResponse: Response;
    try {
      observationResponse = response.clone();
    } catch {
      console.warn(
        "[ai-cost-ledger] Provider response could not be observed for usage.",
      );
      context.latestTerminalObservation = Promise.resolve();
      return response;
    }

    const terminalObservation = observeSuccessfulOpenAiResponse({
      response: observationResponse,
      boundaryAttempt,
      context,
      record,
      now,
    }).catch(() => {
      notifyRecorder(record, {
        ...boundaryAttempt,
        lifecycleVersion: 1,
        state: "failed_after_dispatch",
        failureCategory: "invalid_response",
        completedAt: now(),
      });
    });
    context.latestTerminalObservation = terminalObservation;
    void terminalObservation;
    return response;
  };

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
    fetch: createInstrumentedOpenAiFetch({
      fetch: globalThis.fetch,
      record: recordProviderAttemptFailOpen,
    }),
  });

  return openAIClient;
};
