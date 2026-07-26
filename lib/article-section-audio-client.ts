import {
  getTtsMetadata,
  getTtsProfile,
  parseTtsFallbackReason,
  parseTtsMetadataFromHeaders,
  type TtsProvider,
} from "./tts-profile";
import {
  generateTtsAudioUrlWithMetadata,
  type TtsAudioUrlResult,
} from "./tts-client";

export const ARTICLE_SECTION_AUDIO_ROUTE = "/api/article/audio/section";
const DEFAULT_ARTICLE_SECTION_AUDIO_TIMEOUT_MS = 180_000;

type ArticleSectionAudioRequest = {
  slug: string;
  sectionKey: string;
  sourceHash: string;
  provider: TtsProvider;
  /** Local mode has no shared cache, so it can use already-fetched text. */
  localText?: string;
};

const getRequestTimeoutMs = (): number => {
  const parsed = Number.parseInt(
    process.env.NEXT_PUBLIC_ARTICLE_SECTION_AUDIO_TIMEOUT_MS ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_ARTICLE_SECTION_AUDIO_TIMEOUT_MS;
};

export const generateArticleSectionAudioUrlWithMetadata = async (
  request: ArticleSectionAudioRequest,
): Promise<TtsAudioUrlResult> => {
  if (process.env.NEXT_PUBLIC_LOCAL_MODE === "true") {
    return await generateTtsAudioUrlWithMetadata({
      text: request.localText ?? "",
      provider: "edge",
    });
  }

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutMs = getRequestTimeoutMs();
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  let response: Response;
  try {
    response = await fetch(ARTICLE_SECTION_AUDIO_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: request.slug,
        sectionKey: request.sectionKey,
        sourceHash: request.sourceHash,
        provider: request.provider,
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(`Article audio request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      body?.error?.trim() ||
        `Article audio request failed with ${response.status}`,
    );
  }

  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Article audio response was empty");

  const metadata =
    parseTtsMetadataFromHeaders(response.headers) ??
    getTtsMetadata(getTtsProfile(request.provider));
  const fallbackReason = parseTtsFallbackReason(
    response.headers.get("X-Curio-TTS-Fallback-Reason"),
  );

  return {
    url: URL.createObjectURL(blob),
    metadata,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
};
