import { after, NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@clerk/nextjs/server";
import { track } from "@vercel/analytics/server";
import {
  TTS_MIN_TEXT_LENGTH,
  getServerTtsMaxWordsPerRequest,
  type TtsRequest,
} from "@/lib/tts-contract";
import {
  buildTtsMetadataHeaders,
  getTtsMetadata,
  getTtsProfile,
  isEdgeTtsVoice,
  isOpenAiTtsVoice,
  isTtsFallbackEnabled,
  normalizeTtsProvider,
  type TtsFallbackReason,
  type TtsMetadata,
  type TtsProfile,
  type TtsProvider,
} from "@/lib/tts-profile";
import { resolveTtsProviderAccess } from "@/lib/tts-access-policy";
import { isLocalMode } from "@/lib/runtime-mode";
import {
  isTtsQuotaBypassRequest,
  resolveOpenAiTtsQuota,
  type TtsQuotaDecision,
  type TtsQuotaMode,
} from "@/lib/tts-quota";
import { recordProviderAttemptFailOpen } from "@/lib/ai-cost-provider-recorder";
import {
  getAiCostLedgerMode,
  type AiCostFailureCategory,
  type AiCostProviderAttempt,
  type AiCostSource,
} from "@/lib/ai-cost-ledger-contract";
import { resolveTtsAiCostSource } from "@/lib/tts-source-attestation";

const OPENAI_SPEECH_ENDPOINT = "https://api.openai.com/v1/audio/speech";
const DEFAULT_TTS_UPSTREAM_TIMEOUT_MS = 45_000;
const DEFAULT_TTS_OPENAI_INTERACTIVE_FALLBACK_MS = 25_000;
const AI_COST_PROVIDER_IDENTIFIER_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,119}$/;

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const estimateSpeechDurationMs = (wordCount: number): number =>
  Math.round((wordCount / 2.5) * 1_000);

const boundedProviderIdentifier = (value: string): string | null => {
  const identifier = value.trim();
  return AI_COST_PROVIDER_IDENTIFIER_PATTERN.test(identifier)
    ? identifier
    : null;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Audio generation failed";

class TtsUpstreamTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsUpstreamTimeoutError";
  }
}

const classifyDispatchedTtsError = (error: unknown): AiCostFailureCategory => {
  if (error instanceof TtsUpstreamTimeoutError) return "timeout";
  if (error instanceof DOMException && error.name === "AbortError") {
    return "aborted";
  }
  if (error instanceof TypeError) return "network";
  return "unknown";
};

const createTtsLedgerId = (): string | null => {
  if (getAiCostLedgerMode() !== "observe") return null;
  try {
    return randomUUID();
  } catch {
    console.warn("[ai-cost-ledger] TTS attempt identity could not be created.");
    return null;
  }
};

const recordTtsAttempt = (attempt: AiCostProviderAttempt | null): void => {
  if (!attempt) return;
  try {
    const task = Promise.resolve(recordProviderAttemptFailOpen(attempt)).catch(
      () => {
        console.warn("[ai-cost-ledger] TTS attempt recording failed.");
      },
    );
    try {
      after(async () => await task);
    } catch {
      // The write is already in flight; accounting must never affect TTS.
    }
  } catch {
    console.warn("[ai-cost-ledger] TTS attempt recording failed.");
  }
};

type TtsAttemptIdentity = {
  correlationId: string | null;
  requestedProvider: TtsProvider;
  isFallbackAttempt: boolean;
  source: AiCostSource;
};

const createTtsAttempt = ({
  eventKey,
  identity,
  provider,
  profile,
  text,
  lifecycleVersion,
  state,
  failureCategory,
  dispatchedAt,
  completedAt,
  responseAudioBytes = null,
}: {
  eventKey: string | null;
  identity: TtsAttemptIdentity;
  provider: TtsProvider;
  profile: TtsProfile;
  text: string;
  lifecycleVersion: number;
  state: AiCostProviderAttempt["state"];
  failureCategory: AiCostFailureCategory | null;
  dispatchedAt: number | null;
  completedAt: number | null;
  responseAudioBytes?: number | null;
}): AiCostProviderAttempt | null => {
  if (!eventKey || !identity.correlationId) return null;
  const wordCount = countWords(text);
  const succeeded = state === "succeeded";
  return {
    eventKey,
    correlationId: identity.correlationId,
    lifecycleVersion,
    operation: "tts",
    source: identity.source,
    requestedProvider: identity.requestedProvider,
    effectiveProvider: provider,
    model: boundedProviderIdentifier(profile.model),
    serviceTier: null,
    profile: boundedProviderIdentifier(profile.voiceId),
    state,
    failureCategory,
    dispatchedAt,
    completedAt,
    inputCharacters: Array.from(text).length,
    inputWords: wordCount,
    inputTokens: null,
    cachedInputTokens: null,
    cacheWriteInputTokens: null,
    outputTokens: null,
    reasoningOutputTokens: null,
    audioInputTokens: null,
    audioOutputTokens: null,
    webSearchCalls: null,
    responseAudioBytes,
    audioDurationMs: succeeded ? estimateSpeechDurationMs(wordCount) : null,
    durationMeasurement: succeeded ? "estimated" : "unknown",
    isFallbackAttempt: identity.isFallbackAttempt,
  };
};

const updateTtsAttempt = (
  attempt: AiCostProviderAttempt | null,
  update: Partial<AiCostProviderAttempt>,
): AiCostProviderAttempt | null => (attempt ? { ...attempt, ...update } : null);

const getAuthenticatedUserId = async (): Promise<string | null> => {
  try {
    const { userId } = await auth();
    return userId ?? null;
  } catch (error) {
    console.warn(
      "[/api/tts] authentication unavailable; using Edge",
      getErrorMessage(error),
    );
    return null;
  }
};

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getTtsUpstreamTimeoutMs = (): number =>
  parsePositiveInt(process.env.TTS_UPSTREAM_TIMEOUT_MS) ??
  DEFAULT_TTS_UPSTREAM_TIMEOUT_MS;

const getOpenAiInteractiveFallbackMs = (): number =>
  parsePositiveInt(process.env.TTS_OPENAI_INTERACTIVE_FALLBACK_MS) ??
  DEFAULT_TTS_OPENAI_INTERACTIVE_FALLBACK_MS;

const getEdgeSpeechTarget = (
  req: NextRequest,
): { url: URL; protectionHeaders: Record<string, string> } => {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (!secret) {
    return {
      url: new URL("/api/tts/edge", req.url),
      protectionHeaders: {},
    };
  }

  const deploymentHost = process.env.VERCEL_URL?.trim().toLowerCase();
  if (
    !deploymentHost ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+vercel\.app$/.test(
      deploymentHost,
    )
  ) {
    throw new Error("Protected Edge TTS origin is unavailable");
  }

  return {
    url: new URL("/api/tts/edge", `https://${deploymentHost}`),
    protectionHeaders: { "x-vercel-protection-bypass": secret },
  };
};

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  options: { timeoutMs?: number; timeoutMessage?: string } = {},
): Promise<Response> => {
  const timeoutMs = options.timeoutMs ?? getTtsUpstreamTimeoutMs();
  const timeoutMessage =
    options.timeoutMessage ??
    `TTS upstream request timed out after ${timeoutMs}ms`;
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  let didTimeout = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const fetchPromise = fetch(input, {
    ...init,
    ...(controller ? { signal: controller.signal } : {}),
  });
  const timeoutPromise =
    timeoutMs > 0
      ? new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            didTimeout = true;
            controller?.abort();
            reject(new Error(timeoutMessage));
          }, timeoutMs);
        })
      : null;

  try {
    return await (timeoutPromise
      ? Promise.race([fetchPromise, timeoutPromise])
      : fetchPromise);
  } catch (error) {
    if (didTimeout) {
      throw new TtsUpstreamTimeoutError(timeoutMessage);
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    fetchPromise.catch(() => {});
  }
};

const readErrorBody = async (response: Response): Promise<string> => {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text().catch(() => "");

  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(text) as {
        error?: string | { message?: string };
      };
      if (typeof body.error === "string" && body.error.trim())
        return body.error;
      if (
        body.error &&
        typeof body.error === "object" &&
        body.error.message?.trim()
      ) {
        return body.error.message;
      }
    } catch {
      // Use the text fallback below.
    }
  }

  return text.replace(/\s+/g, " ").trim() || `HTTP ${response.status}`;
};

const audioResponse = (
  audioBuffer: Buffer,
  metadata: TtsMetadata,
  options?: {
    fallback?: boolean;
    fallbackReason?: TtsFallbackReason;
    quotaMode?: TtsQuotaMode;
    quotaExceeded?: boolean;
  },
): NextResponse => {
  const headers = {
    "Content-Type": "audio/mpeg",
    "Content-Length": String(audioBuffer.length),
    ...buildTtsMetadataHeaders(metadata, options),
    ...(options?.quotaMode
      ? { "X-Curio-TTS-Quota-Mode": options.quotaMode }
      : {}),
    ...(options?.quotaExceeded != null
      ? { "X-Curio-TTS-Quota-Exceeded": String(options.quotaExceeded) }
      : {}),
  };

  return new NextResponse(new Uint8Array(audioBuffer), {
    status: 200,
    headers,
  });
};

const generateOpenAiSpeech = async (
  text: string,
  profile: TtsProfile,
  options: { timeoutMs?: number; attempt: TtsAttemptIdentity },
): Promise<Buffer> => {
  const eventKey = options.attempt.correlationId ? createTtsLedgerId() : null;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    recordTtsAttempt(
      createTtsAttempt({
        eventKey,
        identity: options.attempt,
        provider: "openai",
        profile,
        text,
        lifecycleVersion: 1,
        state: "failed_before_dispatch",
        failureCategory: "configuration",
        dispatchedAt: null,
        completedAt: Date.now(),
      }),
    );
    throw new Error("OPENAI_API_KEY is required for OpenAI TTS");
  }

  const timeoutMs = options.timeoutMs ?? getTtsUpstreamTimeoutMs();
  const dispatchedAt = Date.now();
  const boundaryAttempt = createTtsAttempt({
    eventKey,
    identity: options.attempt,
    provider: "openai",
    profile,
    text,
    lifecycleVersion: 0,
    state: "unknown_after_dispatch",
    failureCategory: null,
    dispatchedAt,
    completedAt: null,
  });
  recordTtsAttempt(boundaryAttempt);

  let response: Response;
  try {
    response = await fetchWithTimeout(
      OPENAI_SPEECH_ENDPOINT,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: profile.model,
          voice: profile.voiceId,
          input: text,
          instructions: profile.instructions,
          response_format: "mp3",
        }),
      },
      {
        timeoutMs,
        timeoutMessage: `OpenAI TTS request timed out after ${timeoutMs}ms`,
      },
    );
  } catch (error) {
    recordTtsAttempt(
      updateTtsAttempt(boundaryAttempt, {
        lifecycleVersion: 1,
        state: "unknown_after_dispatch",
        failureCategory: classifyDispatchedTtsError(error),
        completedAt: Date.now(),
      }),
    );
    throw error;
  }

  if (!response.ok) {
    recordTtsAttempt(
      updateTtsAttempt(boundaryAttempt, {
        lifecycleVersion: 1,
        state: "failed_after_dispatch",
        failureCategory:
          response.status >= 500 ? "provider_http_5xx" : "provider_http_4xx",
        completedAt: Date.now(),
      }),
    );
    throw new Error(await readErrorBody(response));
  }

  let audioBuffer: Buffer;
  try {
    audioBuffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    recordTtsAttempt(
      updateTtsAttempt(boundaryAttempt, {
        lifecycleVersion: 1,
        state: "unknown_after_dispatch",
        failureCategory: classifyDispatchedTtsError(error),
        completedAt: Date.now(),
      }),
    );
    throw error;
  }
  if (audioBuffer.length === 0) {
    recordTtsAttempt(
      updateTtsAttempt(boundaryAttempt, {
        lifecycleVersion: 1,
        state: "failed_after_dispatch",
        failureCategory: "empty_response",
        completedAt: Date.now(),
      }),
    );
    throw new Error("No audio was generated");
  }

  recordTtsAttempt(
    createTtsAttempt({
      eventKey,
      identity: options.attempt,
      provider: "openai",
      profile,
      text,
      lifecycleVersion: 1,
      state: "succeeded",
      failureCategory: null,
      dispatchedAt,
      completedAt: Date.now(),
      responseAudioBytes: audioBuffer.length,
    }),
  );

  return audioBuffer;
};

const generateEdgeSpeech = async (
  req: NextRequest,
  text: string,
  profile: TtsProfile,
  attempt: TtsAttemptIdentity,
): Promise<Buffer> => {
  const eventKey = attempt.correlationId ? createTtsLedgerId() : null;
  let target: ReturnType<typeof getEdgeSpeechTarget>;
  try {
    target = getEdgeSpeechTarget(req);
  } catch (error) {
    recordTtsAttempt(
      createTtsAttempt({
        eventKey,
        identity: attempt,
        provider: "edge",
        profile,
        text,
        lifecycleVersion: 1,
        state: "failed_before_dispatch",
        failureCategory: "configuration",
        dispatchedAt: null,
        completedAt: Date.now(),
      }),
    );
    throw error;
  }

  const dispatchedAt = Date.now();
  const boundaryAttempt = createTtsAttempt({
    eventKey,
    identity: attempt,
    provider: "edge",
    profile,
    text,
    lifecycleVersion: 0,
    state: "unknown_after_dispatch",
    failureCategory: null,
    dispatchedAt,
    completedAt: null,
  });
  recordTtsAttempt(boundaryAttempt);

  let response: Response;
  try {
    response = await fetchWithTimeout(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...target.protectionHeaders,
      },
      body: JSON.stringify({
        text,
        voiceId: profile.voiceId,
      }),
    });
  } catch (error) {
    recordTtsAttempt(
      updateTtsAttempt(boundaryAttempt, {
        lifecycleVersion: 1,
        state: "unknown_after_dispatch",
        failureCategory: classifyDispatchedTtsError(error),
        completedAt: Date.now(),
      }),
    );
    throw error;
  }

  if (!response.ok) {
    recordTtsAttempt(
      updateTtsAttempt(boundaryAttempt, {
        lifecycleVersion: 1,
        state: "failed_after_dispatch",
        failureCategory:
          response.status >= 500 ? "provider_http_5xx" : "provider_http_4xx",
        completedAt: Date.now(),
      }),
    );
    throw new Error(await readErrorBody(response));
  }

  let audioBuffer: Buffer;
  try {
    audioBuffer = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    recordTtsAttempt(
      updateTtsAttempt(boundaryAttempt, {
        lifecycleVersion: 1,
        state: "unknown_after_dispatch",
        failureCategory: classifyDispatchedTtsError(error),
        completedAt: Date.now(),
      }),
    );
    throw error;
  }
  if (audioBuffer.length === 0) {
    recordTtsAttempt(
      updateTtsAttempt(boundaryAttempt, {
        lifecycleVersion: 1,
        state: "failed_after_dispatch",
        failureCategory: "empty_response",
        completedAt: Date.now(),
      }),
    );
    throw new Error("No audio was generated");
  }

  recordTtsAttempt(
    createTtsAttempt({
      eventKey,
      identity: attempt,
      provider: "edge",
      profile,
      text,
      lifecycleVersion: 1,
      state: "succeeded",
      failureCategory: null,
      dispatchedAt,
      completedAt: Date.now(),
      responseAudioBytes: audioBuffer.length,
    }),
  );

  return audioBuffer;
};

const getVoiceValidationError = (
  provider: TtsProvider,
  voiceId: string | undefined,
): string | null => {
  if (!voiceId) return null;
  if (provider === "openai" && !isOpenAiTtsVoice(voiceId)) {
    return `Unsupported OpenAI TTS voice: ${voiceId}`;
  }
  if (provider === "edge" && !isEdgeTtsVoice(voiceId)) {
    return `Unsupported Edge TTS voice: ${voiceId}`;
  }
  return null;
};

const bucketWords = (words: number): string => {
  if (words < 50) return "<50";
  if (words < 150) return "50-149";
  if (words < 400) return "150-399";
  if (words < 800) return "400-799";
  return "800+";
};

const bucketDurationMs = (durationMs: number): string => {
  if (durationMs < 500) return "<500ms";
  if (durationMs < 1500) return "500-1499ms";
  if (durationMs < 5000) return "1.5-4.9s";
  if (durationMs < 15000) return "5-14.9s";
  return "15s+";
};

const emitTtsRouteTelemetry = ({
  startedAt,
  requestedProvider,
  provider,
  fallback,
  fallbackReason,
  status,
  statusCode,
  quotaMode,
  quotaExceeded,
  wordCount,
}: {
  startedAt: number;
  requestedProvider: TtsProvider;
  provider: TtsProvider;
  fallback: boolean;
  fallbackReason?: TtsFallbackReason;
  status: "success" | "error";
  statusCode: number;
  quotaMode?: TtsQuotaMode;
  quotaExceeded?: boolean;
  wordCount: number;
}) => {
  const event = {
    provider,
    requestedProvider,
    fallback,
    fallbackReason: fallbackReason ?? "none",
    status,
    statusCode,
    quotaMode: quotaMode ?? "unknown",
    quotaExceeded: quotaExceeded ?? false,
    wordCount: bucketWords(wordCount),
    duration: bucketDurationMs(Date.now() - startedAt),
  };

  console.info("[/api/tts] route", event);

  try {
    after(() => {
      void track("TTS Route", event);
    });
  } catch {
    void track("TTS Route", event);
  }
};

export const POST = async (req: NextRequest) => {
  let provider: TtsProvider = "edge";
  let effectiveProvider: TtsProvider = "edge";
  let usedFallback = false;
  let effectiveFallbackReason: TtsFallbackReason | undefined;
  const startedAt = Date.now();
  let wordCount = 0;
  let quotaDecision: TtsQuotaDecision | undefined;
  const attemptCorrelationId = createTtsLedgerId();

  try {
    const body = (await req.json()) as TtsRequest;
    const { text, voiceId } = body;
    const expectedTtsCacheKey =
      typeof body.expectedTtsCacheKey === "string"
        ? body.expectedTtsCacheKey.trim()
        : "";

    if (!text || text.length < TTS_MIN_TEXT_LENGTH) {
      return NextResponse.json(
        { error: "Text is too short to generate audio" },
        { status: 400 },
      );
    }

    const maxWordsPerRequest = getServerTtsMaxWordsPerRequest();
    wordCount = countWords(text);

    if (wordCount > maxWordsPerRequest) {
      return NextResponse.json(
        {
          error: `Text exceeds ${maxWordsPerRequest} words; split it into smaller chunks before requesting TTS`,
        },
        { status: 400 },
      );
    }

    if (expectedTtsCacheKey.length > 500) {
      return NextResponse.json(
        { error: "Expected TTS profile key is invalid" },
        { status: 400 },
      );
    }

    const aiCostSource = await resolveTtsAiCostSource(req.headers);
    const localMode = isLocalMode();
    const isTrustedRequest =
      !localMode && (await isTtsQuotaBypassRequest(req.headers));
    const userId =
      localMode || isTrustedRequest ? null : await getAuthenticatedUserId();
    const providerAccess = resolveTtsProviderAccess({
      audience: userId ? "authenticated" : "public",
      requestedProvider: normalizeTtsProvider(body.provider) ?? undefined,
      localMode,
      trusted: isTrustedRequest,
    });
    provider = providerAccess.requestedProvider;
    const voiceValidationError = getVoiceValidationError(provider, voiceId);
    if (voiceValidationError) {
      return NextResponse.json(
        { error: voiceValidationError },
        { status: 400 },
      );
    }

    const requestedProfile = getTtsProfile(provider, voiceId);
    if (
      expectedTtsCacheKey &&
      requestedProfile.ttsCacheKey !== expectedTtsCacheKey
    ) {
      return NextResponse.json(
        {
          error:
            "The requested TTS profile is no longer active; retry with the current profile.",
        },
        { status: 409 },
      );
    }

    effectiveProvider = providerAccess.provider;
    if (providerAccess.fallbackReason) {
      usedFallback = true;
      effectiveFallbackReason = providerAccess.fallbackReason;
    }

    const primaryProfile =
      effectiveProvider === provider
        ? requestedProfile
        : getTtsProfile(effectiveProvider);
    quotaDecision = await resolveOpenAiTtsQuota({
      headers: req.headers,
      provider: primaryProfile.provider,
    });

    if (quotaDecision.quotaError) {
      console.warn("[/api/tts] quota check failed; using Edge fallback", {
        quotaMode: quotaDecision.mode,
        quotaError: quotaDecision.quotaError,
      });
    }

    if (primaryProfile.provider === "edge") {
      effectiveProvider = "edge";
      const audioBuffer = await generateEdgeSpeech(req, text, primaryProfile, {
        correlationId: attemptCorrelationId,
        requestedProvider: provider,
        isFallbackAttempt: usedFallback,
        source: aiCostSource,
      });
      const response = audioResponse(
        audioBuffer,
        getTtsMetadata(primaryProfile),
        {
          fallback: usedFallback,
          fallbackReason: effectiveFallbackReason,
          quotaMode: quotaDecision.mode,
          quotaExceeded: quotaDecision.exceeded,
        },
      );
      emitTtsRouteTelemetry({
        startedAt,
        requestedProvider: provider,
        provider: "edge",
        fallback: usedFallback,
        fallbackReason: effectiveFallbackReason,
        status: "success",
        statusCode: 200,
        quotaMode: quotaDecision.mode,
        quotaExceeded: quotaDecision.exceeded,
        wordCount,
      });
      return response;
    }

    if (quotaDecision.exceeded) {
      const edgeProfile = getTtsProfile("edge", voiceId);
      effectiveProvider = "edge";
      usedFallback = true;
      effectiveFallbackReason = quotaDecision.fallbackReason ?? "openai_quota";
      const audioBuffer = await generateEdgeSpeech(req, text, edgeProfile, {
        correlationId: attemptCorrelationId,
        requestedProvider: provider,
        isFallbackAttempt: true,
        source: aiCostSource,
      });
      const response = audioResponse(audioBuffer, getTtsMetadata(edgeProfile), {
        fallback: true,
        fallbackReason: effectiveFallbackReason,
        quotaMode: quotaDecision.mode,
        quotaExceeded: true,
      });
      emitTtsRouteTelemetry({
        startedAt,
        requestedProvider: provider,
        provider: "edge",
        fallback: true,
        fallbackReason: effectiveFallbackReason,
        status: "success",
        statusCode: 200,
        quotaMode: quotaDecision.mode,
        quotaExceeded: true,
        wordCount,
      });
      return response;
    }

    try {
      const openAiTimeoutMs = Math.min(
        getOpenAiInteractiveFallbackMs(),
        getTtsUpstreamTimeoutMs(),
      );
      const audioBuffer = await generateOpenAiSpeech(text, primaryProfile, {
        timeoutMs: openAiTimeoutMs,
        attempt: {
          correlationId: attemptCorrelationId,
          requestedProvider: provider,
          isFallbackAttempt: false,
          source: aiCostSource,
        },
      });
      const response = audioResponse(
        audioBuffer,
        getTtsMetadata(primaryProfile),
        {
          quotaMode: quotaDecision.mode,
          quotaExceeded: quotaDecision.exceeded,
        },
      );
      emitTtsRouteTelemetry({
        startedAt,
        requestedProvider: provider,
        provider: "openai",
        fallback: false,
        status: "success",
        statusCode: 200,
        quotaMode: quotaDecision.mode,
        quotaExceeded: quotaDecision.exceeded,
        wordCount,
      });
      return response;
    } catch (error) {
      if (!isTtsFallbackEnabled()) {
        throw error;
      }

      const edgeProfile = getTtsProfile("edge", voiceId);
      effectiveProvider = "edge";
      usedFallback = true;
      effectiveFallbackReason = "openai_error";
      const audioBuffer = await generateEdgeSpeech(req, text, edgeProfile, {
        correlationId: attemptCorrelationId,
        requestedProvider: provider,
        isFallbackAttempt: true,
        source: aiCostSource,
      });
      const response = audioResponse(audioBuffer, getTtsMetadata(edgeProfile), {
        fallback: true,
        fallbackReason: effectiveFallbackReason,
        quotaMode: quotaDecision.mode,
        quotaExceeded: quotaDecision.exceeded,
      });
      emitTtsRouteTelemetry({
        startedAt,
        requestedProvider: provider,
        provider: "edge",
        fallback: true,
        fallbackReason: effectiveFallbackReason,
        status: "success",
        statusCode: 200,
        quotaMode: quotaDecision.mode,
        quotaExceeded: quotaDecision.exceeded,
        wordCount,
      });
      return response;
    }
  } catch (err) {
    console.error(
      `${effectiveProvider === "edge" ? "Edge" : "OpenAI"} TTS generation failed:`,
      err,
    );
    emitTtsRouteTelemetry({
      startedAt,
      requestedProvider: provider,
      provider: effectiveProvider,
      fallback: usedFallback,
      fallbackReason: effectiveFallbackReason,
      status: "error",
      statusCode: 500,
      quotaMode: quotaDecision?.mode,
      quotaExceeded: quotaDecision?.exceeded,
      wordCount,
    });
    return NextResponse.json({ error: getErrorMessage(err) }, { status: 500 });
  }
};
