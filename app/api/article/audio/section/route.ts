import { auth } from "@clerk/nextjs/server";
import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { after, NextRequest, NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { buildCachedTtsResult } from "@/lib/article-audio-playback";
import { estimateAudioDurationSeconds } from "@/lib/article-audio-duration";
import { resolveCanonicalArticleNarrationTrack } from "@/lib/article-section-audio";
import { fetchArticleByTitle, slugToTitle } from "@/convex/lib/wikipedia";
import {
  createAudioCacheReadAttestation,
  createAudioCacheSaveAttestation,
  createAudioCacheUploadAttestation,
} from "@/lib/tts-quota-bypass";
import { getRequestAudioGenerationBaseUrl } from "@/lib/audio-generation-url";
import { isLocalMode } from "@/lib/runtime-mode";
import { generateTtsAudioWithMetadata } from "@/lib/tts-client";
import { resolveTtsProviderAccess } from "@/lib/tts-access-policy";
import {
  buildTtsMetadataHeaders,
  getTtsMetadata,
  getTtsProfile,
  normalizeTtsProvider,
  type TtsFallbackReason,
  type TtsMetadata,
} from "@/lib/tts-profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;
const MAX_SLUG_LENGTH = 500;
const MAX_SECTION_KEY_LENGTH = 500;
const MAX_SOURCE_HASH_LENGTH = 500;
const CACHE_READ_TIMEOUT_MS = 5_000;
const CACHE_UPLOAD_TIMEOUT_MS = 15_000;

type StoredArticle = {
  _id?: Id<"articles">;
  title: string;
  summary?: string;
  sections?: Parameters<
    typeof resolveCanonicalArticleNarrationTrack
  >[0]["sections"];
};

type CachedSectionAudio = {
  urls: Record<string, string>;
  metadata: Record<string, Record<string, string>>;
};

const getCanonicalArticle = async (
  slug: string,
): Promise<StoredArticle | null> => {
  if (isLocalMode()) {
    return await fetchArticleByTitle(slugToTitle(slug));
  }
  return (await fetchQuery(anyApi.articles.getBySlug, {
    slug,
  })) as StoredArticle | null;
};

const getSession = async (): Promise<{
  userId: string | null;
  convexToken?: string;
}> => {
  if (isLocalMode()) return { userId: null };

  try {
    const session = await auth();
    if (!session.userId) return { userId: null };
    const convexToken = await session
      .getToken({ template: "convex" })
      .catch(() => null);
    return {
      userId: session.userId,
      ...(convexToken ? { convexToken } : {}),
    };
  } catch (error) {
    console.warn(
      "[/api/article/audio/section] authentication unavailable; using Edge",
      error instanceof Error ? error.message : "Unknown authentication error",
    );
    return { userId: null };
  }
};

const getForwardedTtsHeaders = (req: NextRequest): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const name of [
    "authorization",
    "cookie",
    "cf-connecting-ip",
    "user-agent",
    "x-forwarded-for",
    "x-real-ip",
    "x-vercel-forwarded-for",
  ]) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }

  const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (protectionBypass) {
    headers["x-vercel-protection-bypass"] = protectionBypass;
  }
  return headers;
};

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const audioResponse = (
  blob: Blob,
  metadata: TtsMetadata,
  fallbackReason?: TtsFallbackReason,
): NextResponse =>
  new NextResponse(blob, {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      "Content-Type": blob.type || "audio/mpeg",
      "Content-Length": String(blob.size),
      ...buildTtsMetadataHeaders(metadata, {
        fallback: fallbackReason != null,
        fallbackReason,
      }),
    },
  });

const fetchCachedAudioBlob = async (url: string): Promise<Blob | null> => {
  try {
    const response = await fetchWithTimeout(
      url,
      { cache: "no-store" },
      CACHE_READ_TIMEOUT_MS,
    );
    if (!response.ok) return null;
    const blob = await response.blob();
    return blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
};

const persistGeneratedAudio = async ({
  articleId,
  sectionKey,
  sourceHash,
  blob,
  text,
  metadata,
}: {
  articleId: Id<"articles">;
  sectionKey: string;
  sourceHash: string;
  blob: Blob;
  text: string;
  metadata: TtsMetadata;
}): Promise<void> => {
  const uploadAttestation = await createAudioCacheUploadAttestation();
  const uploadUrl = (await fetchMutation(anyApi.audio.generateUploadUrl, {
    attestation: uploadAttestation,
  })) as string;
  const uploadResponse = await fetchWithTimeout(
    uploadUrl,
    {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/mpeg" },
      body: blob,
    },
    CACHE_UPLOAD_TIMEOUT_MS,
  );
  if (!uploadResponse.ok) {
    throw new Error(`Audio cache upload failed with ${uploadResponse.status}`);
  }
  const uploadResult = (await uploadResponse.json()) as {
    storageId?: Id<"_storage">;
  };
  if (!uploadResult.storageId) {
    throw new Error("Audio cache upload did not return a storage ID.");
  }

  const saveArgs = {
    articleId,
    sectionKey,
    sourceHash,
    storageId: uploadResult.storageId,
    ttsNormVersion: metadata.ttsNormVersion,
    ttsCacheKey: metadata.ttsCacheKey,
    provider: metadata.provider,
    model: metadata.model,
    voiceId: metadata.voiceId,
    promptVersion: metadata.promptVersion,
    durationSeconds: estimateAudioDurationSeconds(text),
  };
  const saveAttestation = await createAudioCacheSaveAttestation(saveArgs);
  await fetchMutation(anyApi.audio.saveSectionAudioRecord, {
    ...saveArgs,
    attestation: saveAttestation,
  });
};

const isBoundedString = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= maxLength;

export const POST = async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => null)) as {
      slug?: unknown;
      sectionKey?: unknown;
      sourceHash?: unknown;
      provider?: unknown;
    } | null;
    if (
      !body ||
      !isBoundedString(body.slug, MAX_SLUG_LENGTH) ||
      !isBoundedString(body.sectionKey, MAX_SECTION_KEY_LENGTH) ||
      !isBoundedString(body.sourceHash, MAX_SOURCE_HASH_LENGTH)
    ) {
      return NextResponse.json(
        { error: "A valid article audio request is required." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const requestedProvider = normalizeTtsProvider(
      typeof body.provider === "string" ? body.provider : undefined,
    );
    if (!requestedProvider) {
      return NextResponse.json(
        { error: "A supported TTS provider is required." },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }

    const [article, session] = await Promise.all([
      getCanonicalArticle(body.slug),
      getSession(),
    ]);
    if (!article) {
      return NextResponse.json(
        { error: "Article not found." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const track = resolveCanonicalArticleNarrationTrack(
      article,
      body.sectionKey,
      body.sourceHash,
    );
    if (!track) {
      return NextResponse.json(
        { error: "Article narration changed; refresh and try again." },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }

    const providerAccess = resolveTtsProviderAccess({
      audience: session.userId ? "authenticated" : "public",
      requestedProvider,
      localMode: isLocalMode(),
    });
    const expectedMetadata = getTtsMetadata(
      getTtsProfile(providerAccess.provider),
    );
    const cacheArgs = article._id
      ? {
          articleId: article._id,
          ttsNormVersion: expectedMetadata.ttsNormVersion,
          ttsCacheKey: expectedMetadata.ttsCacheKey,
          sourceHashes: [
            { sectionKey: track.sectionKey, sourceHash: track.sourceHash },
          ],
        }
      : null;

    if (cacheArgs) {
      try {
        const readAttestation =
          await createAudioCacheReadAttestation(cacheArgs);
        const cached = (await fetchMutation(
          anyApi.audio.getAllSectionAudioForServer,
          { ...cacheArgs, attestation: readAttestation },
          session.convexToken ? { token: session.convexToken } : {},
        )) as CachedSectionAudio;
        const cachedResult = buildCachedTtsResult(
          cached.urls[track.sectionKey],
          cached.metadata[track.sectionKey],
          expectedMetadata,
        );
        if (cachedResult) {
          const cachedBlob = await fetchCachedAudioBlob(cachedResult.url);
          if (cachedBlob) {
            return audioResponse(
              cachedBlob,
              cachedResult.metadata,
              providerAccess.fallbackReason,
            );
          }
        }
      } catch (error) {
        console.warn(
          "[article-audio-cache] Failed to read canonical section audio:",
          error,
        );
      }
    }

    const generated = await generateTtsAudioWithMetadata(
      { text: track.text, provider: providerAccess.provider },
      {
        apiBaseUrl: getRequestAudioGenerationBaseUrl(req.url),
        headers: getForwardedTtsHeaders(req),
      },
    );
    const fallbackReason =
      providerAccess.fallbackReason ?? generated.fallbackReason;

    if (article._id) {
      after(async () => {
        try {
          await persistGeneratedAudio({
            articleId: article._id!,
            sectionKey: track.sectionKey,
            sourceHash: track.sourceHash,
            blob: generated.blob,
            text: track.text,
            metadata: generated.metadata,
          });
        } catch (error) {
          console.warn(
            "[article-audio-cache] Failed to persist canonical section audio:",
            error,
          );
        }
      });
    }

    return audioResponse(generated.blob, generated.metadata, fallbackReason);
  } catch (error) {
    console.error("[/api/article/audio/section] request failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Article audio generation failed.",
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
};
