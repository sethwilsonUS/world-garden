import { after, NextRequest, NextResponse } from "next/server";
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
import {
  resolveOpenAiTtsQuota,
  type TtsQuotaDecision,
  type TtsQuotaMode,
} from "@/lib/tts-quota";

const OPENAI_SPEECH_ENDPOINT = "https://api.openai.com/v1/audio/speech";
const DEFAULT_TTS_UPSTREAM_TIMEOUT_MS = 45_000;
const DEFAULT_TTS_OPENAI_INTERACTIVE_FALLBACK_MS = 25_000;

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Audio generation failed";

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

const getVercelProtectionBypassHeaders = (): Record<string, string> => {
  const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  return secret ? { "x-vercel-protection-bypass": secret } : {};
};

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  options: { timeoutMs?: number; timeoutMessage?: string } = {},
): Promise<Response> => {
  const timeoutMs = options.timeoutMs ?? getTtsUpstreamTimeoutMs();
  const timeoutMessage =
    options.timeoutMessage ?? `TTS upstream request timed out after ${timeoutMs}ms`;
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
      throw new Error(timeoutMessage);
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
      if (typeof body.error === "string" && body.error.trim()) return body.error;
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
  options: { timeoutMs?: number } = {},
): Promise<Buffer> => {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI TTS");
  }

  const timeoutMs = options.timeoutMs ?? getTtsUpstreamTimeoutMs();
  const response = await fetchWithTimeout(
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

  if (!response.ok) {
    throw new Error(await readErrorBody(response));
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.length === 0) {
    throw new Error("No audio was generated");
  }

  return audioBuffer;
};

const generateEdgeSpeech = async (
  req: NextRequest,
  text: string,
  profile: TtsProfile,
): Promise<Buffer> => {
  const response = await fetchWithTimeout(new URL("/api/tts/edge", req.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getVercelProtectionBypassHeaders(),
    },
    body: JSON.stringify({
      text,
      voiceId: profile.voiceId,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorBody(response));
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  if (audioBuffer.length === 0) {
    throw new Error("No audio was generated");
  }

  return audioBuffer;
};

const resolveRequestedProvider = (body: TtsRequest): TtsProvider =>
  normalizeTtsProvider(body.provider) ?? getTtsProfile().provider;

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
  let provider: TtsProvider = "openai";
  let effectiveProvider: TtsProvider = "openai";
  let usedFallback = false;
  let effectiveFallbackReason: TtsFallbackReason | undefined;
  const startedAt = Date.now();
  let wordCount = 0;
  let quotaDecision: TtsQuotaDecision | undefined;

  try {
    const body = (await req.json()) as TtsRequest;
    const { text, voiceId } = body;

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

    provider = resolveRequestedProvider(body);
    effectiveProvider = provider;
    const voiceValidationError = getVoiceValidationError(provider, voiceId);
    if (voiceValidationError) {
      return NextResponse.json({ error: voiceValidationError }, { status: 400 });
    }

    const primaryProfile = getTtsProfile(provider, voiceId);
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
      const audioBuffer = await generateEdgeSpeech(req, text, primaryProfile);
      const response = audioResponse(audioBuffer, getTtsMetadata(primaryProfile), {
        quotaMode: quotaDecision.mode,
        quotaExceeded: quotaDecision.exceeded,
      });
      emitTtsRouteTelemetry({
        startedAt,
        requestedProvider: provider,
        provider: "edge",
        fallback: false,
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
      const audioBuffer = await generateEdgeSpeech(req, text, edgeProfile);
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
      });
      const response = audioResponse(audioBuffer, getTtsMetadata(primaryProfile), {
        quotaMode: quotaDecision.mode,
        quotaExceeded: quotaDecision.exceeded,
      });
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
      const audioBuffer = await generateEdgeSpeech(req, text, edgeProfile);
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
