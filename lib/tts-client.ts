import { normalizeTtsText } from "./tts-normalize";
import { concatenateMp3Blobs } from "./audio-metadata";
import {
  TTS_API_ROUTE,
  TTS_MIN_TEXT_LENGTH,
  getClientTtsMaxWordsPerRequest,
  type TtsRequest,
} from "./tts-contract";
import {
  getTtsMetadata,
  getTtsProfile,
  parseTtsMetadataFromHeaders,
  type TtsMetadata,
  type TtsFallbackReason,
  type TtsProvider,
} from "./tts-profile";

type TtsErrorBody = {
  error?: string;
};

type TtsClientOptions = {
  apiBaseUrl?: string;
  headers?: Record<string, string>;
};

type SingleTtsAudioResult = {
  blob: Blob;
  metadata: TtsMetadata;
  usedFallback: boolean;
  fallbackReason?: TtsFallbackReason;
};

export type TtsAudioResult = {
  blob: Blob;
  metadata: TtsMetadata;
  fallbackReason?: TtsFallbackReason;
};

export type TtsAudioUrlResult = {
  url: string;
  metadata: TtsMetadata;
  fallbackReason?: TtsFallbackReason;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const DEFAULT_TTS_CLIENT_TIMEOUT_MS = 65_000;
const DEFAULT_TTS_CHUNK_CONCURRENCY = 2;

const parsePositiveInt = (value: string | undefined): number | null => {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getClientTtsTimeoutMs = (): number =>
  parsePositiveInt(process.env.NEXT_PUBLIC_TTS_CLIENT_TIMEOUT_MS) ??
  DEFAULT_TTS_CLIENT_TIMEOUT_MS;

const getClientTtsChunkConcurrency = (): number =>
  parsePositiveInt(process.env.NEXT_PUBLIC_TTS_CHUNK_CONCURRENCY) ??
  DEFAULT_TTS_CHUNK_CONCURRENCY;

const countWords = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

const resolveTtsApiRoute = (apiBaseUrl?: string): string =>
  apiBaseUrl ? new URL(TTS_API_ROUTE, apiBaseUrl).toString() : TTS_API_ROUTE;

const parseFallbackReason = (
  value: string | null,
): TtsFallbackReason | undefined =>
  value === "openai_quota" || value === "openai_error" ? value : undefined;

const splitIntoParagraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

const splitIntoSentences = (text: string): string[] => {
  const matches = text.match(/[^.!?]+(?:[.!?]+|$)/g);
  if (!matches) return [text.trim()].filter(Boolean);
  return matches.map((part) => part.trim()).filter(Boolean);
};

const splitIntoWordChunks = (
  text: string,
  maxWords = getClientTtsMaxWordsPerRequest(),
): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];

  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push(words.slice(i, i + maxWords).join(" "));
  }

  return chunks;
};

const packSegments = (
  segments: string[],
  maxWords = getClientTtsMaxWordsPerRequest(),
): string[] => {
  const chunks: string[] = [];
  let current = "";
  let currentWords = 0;

  for (const segment of segments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    const words = countWords(trimmed);
    if (words > maxWords) {
      throw new Error("Segment exceeded TTS chunk limit during packing");
    }

    if (currentWords > 0 && currentWords + words > maxWords) {
      chunks.push(current);
      current = trimmed;
      currentWords = words;
      continue;
    }

    current = current ? `${current} ${trimmed}` : trimmed;
    currentWords += words;
  }

  if (current) chunks.push(current);

  return chunks;
};

const splitLongParagraph = (
  paragraph: string,
  maxWords = getClientTtsMaxWordsPerRequest(),
): string[] => {
  if (countWords(paragraph) <= maxWords) return [paragraph];

  const sentences = splitIntoSentences(paragraph);
  if (sentences.length > 1) {
    return packSegments(
      sentences.flatMap((sentence) =>
        countWords(sentence) <= maxWords
          ? [sentence]
          : splitIntoWordChunks(sentence, maxWords),
      ),
      maxWords,
    );
  }

  return splitIntoWordChunks(paragraph, maxWords);
};

export const splitTtsTextIntoChunks = (
  text: string,
  maxWords = getClientTtsMaxWordsPerRequest(),
): string[] => {
  const normalized = normalizeTtsText(text).trim();
  if (!normalized) return [];

  const paragraphs = splitIntoParagraphs(normalized);
  if (paragraphs.length > 1) {
    return packSegments(
      paragraphs.flatMap((paragraph) => splitLongParagraph(paragraph, maxWords)),
      maxWords,
    );
  }

  return splitLongParagraph(normalized, maxWords);
};

const fetchSingleTtsAudioWithMetadata = async ({
  text,
  voiceId,
  provider,
}: TtsRequest, options?: TtsClientOptions): Promise<SingleTtsAudioResult> => {
  const requestHeaders = new Headers(options?.headers);
  requestHeaders.set("Content-Type", "application/json");
  const timeoutMs = getClientTtsTimeoutMs();
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  let didTimeout = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const fetchPromise = fetch(resolveTtsApiRoute(options?.apiBaseUrl), {
    method: "POST",
    headers: requestHeaders,
    body: JSON.stringify({
      text,
      ...(voiceId ? { voiceId } : {}),
      ...(provider ? { provider } : {}),
    }),
    ...(controller ? { signal: controller.signal } : {}),
  });

  const timeoutPromise =
    timeoutMs > 0
      ? new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            didTimeout = true;
            controller?.abort();
            reject(new Error(`TTS request timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        })
      : null;

  let resp: Response;
  try {
    resp = await (timeoutPromise
      ? Promise.race([fetchPromise, timeoutPromise])
      : fetchPromise);
  } catch (error) {
    if (didTimeout) {
      throw new Error(`TTS request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    fetchPromise.catch(() => {});
  }

  if (!resp.ok) {
    const contentType = resp.headers.get("content-type") ?? "unknown";
    const bodyText = await resp.text().catch(() => "");

    if (contentType.includes("application/json")) {
      let body: TtsErrorBody | null = null;
      try {
        body = JSON.parse(bodyText) as TtsErrorBody;
      } catch {
        // Fall through to the structured fallback below.
      }

      if (body?.error?.trim()) {
        throw new Error(body.error);
      }
    }

    const preview = bodyText.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(
      preview
        ? `TTS request failed with ${resp.status} (${contentType}): ${preview}`
        : `TTS request failed with ${resp.status} (${contentType})`,
    );
  }

  const blob = await resp.blob();
  if (blob.size === 0) {
    throw new Error("TTS returned an empty audio payload");
  }

  const headers = resp.headers ?? new Headers();
  const metadata =
    parseTtsMetadataFromHeaders(headers) ??
    getTtsMetadata(getTtsProfile(provider, voiceId));
  const usedFallback = headers.get("X-Curio-TTS-Fallback") === "true";
  const fallbackReason = parseFallbackReason(
    headers.get("X-Curio-TTS-Fallback-Reason"),
  );

  return { blob, metadata, usedFallback, fallbackReason };
};

const generateTtsAudioForChunks = async ({
  chunks,
  voiceId,
  provider,
  options,
  fallbackReason,
}: {
  chunks: string[];
  voiceId?: string;
  provider?: TtsProvider;
  options?: TtsClientOptions;
  fallbackReason?: TtsFallbackReason;
}): Promise<TtsAudioResult> => {
  const fetchChunkResults = async (): Promise<SingleTtsAudioResult[]> => {
    const results: SingleTtsAudioResult[] = new Array(chunks.length);
    const workerCount = Math.min(getClientTtsChunkConcurrency(), chunks.length);
    let nextIndex = 0;

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < chunks.length) {
        const index = nextIndex;
        nextIndex += 1;
        const chunk = chunks[index];
        if (!chunk) continue;

        try {
          results[index] = await fetchSingleTtsAudioWithMetadata(
            { text: chunk, voiceId, provider },
            options,
          );
        } catch (error) {
          throw new Error(
            `TTS chunk ${index + 1}/${chunks.length} failed (${countWords(chunk)} words): ${getErrorMessage(error)}`,
          );
        }
      }
    });

    await Promise.all(workers);
    return results;
  };

  const results = await fetchChunkResults();
  let activeFallbackReason = fallbackReason;

  let metadata: TtsMetadata | null = null;
  for (const result of results) {
    activeFallbackReason ??= result.fallbackReason;

    if (
      chunks.length > 1 &&
      (result.usedFallback ||
        (metadata && metadata.provider !== result.metadata.provider) ||
        (provider && provider !== result.metadata.provider))
    ) {
      return generateTtsAudioForChunks({
        chunks,
        voiceId,
        provider: result.metadata.provider,
        options,
        fallbackReason: activeFallbackReason,
      });
    }

    metadata = result.metadata;
  }

  if (!metadata) {
    throw new Error("No audio was generated");
  }

  const audioChunks = results.map((result) => result.blob);

  if (audioChunks.length === 1) {
    return {
      blob: audioChunks[0],
      metadata,
      ...(activeFallbackReason ? { fallbackReason: activeFallbackReason } : {}),
    };
  }

  return {
    blob: await concatenateMp3Blobs(audioChunks, {
      stripId3Tags: "leading",
    }),
    metadata,
    ...(activeFallbackReason ? { fallbackReason: activeFallbackReason } : {}),
  };
};

export const generateTtsAudio = async ({
  text,
  voiceId,
  provider,
}: TtsRequest, options?: TtsClientOptions): Promise<Blob> => {
  const result = await generateTtsAudioWithMetadata(
    { text, voiceId, provider },
    options,
  );
  return result.blob;
};

export const generateTtsAudioWithMetadata = async ({
  text,
  voiceId,
  provider,
}: TtsRequest, options?: TtsClientOptions): Promise<TtsAudioResult> => {
  const chunks = splitTtsTextIntoChunks(text);
  const joinedText = chunks.join(" ");

  if (!joinedText || joinedText.length < TTS_MIN_TEXT_LENGTH) {
    throw new Error("Text is too short to generate audio");
  }

  return generateTtsAudioForChunks({
    chunks,
    voiceId,
    provider,
    options,
  });
};

export const generateTtsAudioUrl = async (
  request: TtsRequest,
  options?: TtsClientOptions,
): Promise<string> => URL.createObjectURL(await generateTtsAudio(request, options));

export const generateTtsAudioUrlWithMetadata = async (
  request: TtsRequest,
  options?: TtsClientOptions,
): Promise<TtsAudioUrlResult> => {
  const result = await generateTtsAudioWithMetadata(request, options);
  return {
    url: URL.createObjectURL(result.blob),
    metadata: result.metadata,
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
  };
};
