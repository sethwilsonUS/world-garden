import { auth } from "@clerk/nextjs/server";
import { normalizeMediaWikiNumericId } from "@curio-garden/domain";
import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { after, NextRequest, NextResponse } from "next/server";
import type { Id } from "@/convex/_generated/dataModel";
import { buildCachedTtsResult } from "@/lib/article-audio-playback";
import { estimateAudioDurationSeconds } from "@/lib/article-audio-duration";
import { resolveCanonicalArticleNarrationTrack } from "@/lib/article-section-audio";
import { buildArticleNarrationTracks } from "@/lib/section-narration";
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
  createAudioCacheLedgerAssetKey,
  recordAudioCacheReadResultBestEffort,
  recordAudioCacheWriteFailureBestEffort,
  type AudioCacheReadResultInput,
} from "@/lib/audio-cache-ledger";
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
const MAX_REVISION_ID_RAW_LENGTH = 64;
const MAX_BEARER_TOKEN_LENGTH = 8_192;
const MAX_CLERK_AUTH_REASON_LENGTH = 128;
const CACHE_READ_TIMEOUT_MS = 5_000;
const CACHE_UPLOAD_TIMEOUT_MS = 15_000;

const isBoundedString = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= maxLength;

type StoredArticle = {
  _id?: Id<"articles">;
  title: string;
  revisionId?: string;
  narrationVersion?: number;
  summary?: string;
  sections?: Parameters<
    typeof resolveCanonicalArticleNarrationTrack
  >[0]["sections"];
};

type CachedSectionAudio = {
  urls: Record<string, string>;
  durations?: Record<string, number>;
  metadata: Record<string, Record<string, string>>;
  ledgerAssetKeys?: Record<string, string>;
};

const recordInteractiveCacheReadAfterResponse = (
  result: Omit<AudioCacheReadResultInput, "source">,
): void => {
  try {
    after(async () => {
      await recordAudioCacheReadResultBestEffort({
        source: "interactive_article",
        ...result,
      });
    });
  } catch {
    console.warn("[ai-cost-ledger] Audio cache read result was not scheduled.");
  }
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

type ArticleAudioSession = {
  userId: string | null;
  convexToken?: string;
};

const getCookieSession = async (): Promise<ArticleAudioSession> => {
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

const bearerErrorResponse = (status: 401 | 503): NextResponse =>
  NextResponse.json(
    {
      error:
        status === 401
          ? "Authentication is required."
          : "Authentication is temporarily unavailable.",
    },
    { status, headers: NO_STORE_HEADERS },
  );

const CLERK_SESSION_COOKIE_NAME = /^__session(?:_[A-Za-z0-9_-]{8})?$/u;

const hasClerkSessionCookie = (req: NextRequest): boolean => {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return false;
  return cookieHeader.split(";").some((segment) => {
    const separator = segment.indexOf("=");
    const name = (separator < 0 ? segment : segment.slice(0, separator)).trim();
    return CLERK_SESSION_COOKIE_NAME.test(name);
  });
};

const bearerAuthenticationUnavailable = (error: unknown): NextResponse => {
  void error;
  return bearerErrorResponse(503);
};

const CLERK_INFRASTRUCTURE_AUTH_REASONS = new Set([
  "secret-key-invalid",
  "jwk-local-missing",
  "jwk-remote-failed-to-load",
  "jwk-remote-invalid",
  "jwk-remote-missing",
  "jwk-failed-to-resolve",
  "unexpected-error",
]);

const malformedBearerDebugStatus = (error: unknown): 401 => {
  void error;
  return 401;
};

const getSignedOutBearerStatus = (debug: unknown): 401 | 503 => {
  if (typeof debug !== "function") return 401;
  try {
    const details: unknown = debug();
    if (!details || typeof details !== "object") return 401;
    const rawReason =
      "authReason" in details
        ? (details as Record<string, unknown>).authReason
        : (details as Record<string, unknown>).reason;
    if (!isBoundedString(rawReason, MAX_CLERK_AUTH_REASON_LENGTH)) return 401;
    return CLERK_INFRASTRUCTURE_AUTH_REASONS.has(rawReason) ? 503 : 401;
  } catch (error) {
    return malformedBearerDebugStatus(error);
  }
};

const getBearerSession = async (
  req: NextRequest,
  authorization: string,
): Promise<ArticleAudioSession | NextResponse> => {
  const match = /^Bearer ([^\s,]+)$/iu.exec(authorization);
  const token = match?.[1];
  if (!token || token.length > MAX_BEARER_TOKEN_LENGTH) {
    return bearerErrorResponse(401);
  }
  if (isLocalMode() || hasClerkSessionCookie(req)) {
    return bearerErrorResponse(401);
  }

  try {
    const session = await auth({ treatPendingAsSignedOut: true });
    if (!isBoundedString(session.userId, MAX_SLUG_LENGTH)) {
      return bearerErrorResponse(getSignedOutBearerStatus(session.debug));
    }
    return { userId: session.userId };
  } catch (error) {
    return bearerAuthenticationUnavailable(error);
  }
};

const getForwardedTtsHeaders = (req: NextRequest): Record<string, string> => {
  const headers: Record<string, string> = {};
  const identityHeaders = req.headers.has("authorization")
    ? ["authorization"]
    : ["cookie"];
  for (const name of [
    ...identityHeaders,
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

type PersistGeneratedAudioArgs = {
  articleId: Id<"articles">;
  sectionKey: string;
  sourceHash: string;
  blob: Blob;
  text: string;
  metadata: TtsMetadata;
  expectedExistingLedgerAssetKey?: string;
};

const persistGeneratedAudioAttempt = async ({
  articleId,
  sectionKey,
  sourceHash,
  blob,
  text,
  metadata,
  ledgerAssetKey,
  expectedExistingLedgerAssetKey,
}: PersistGeneratedAudioArgs & { ledgerAssetKey?: string }): Promise<void> => {
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

  const ledgerArgs = ledgerAssetKey
    ? {
        byteLength: blob.size,
        ledgerAssetKey,
        expectedExistingLedgerAssetKey,
        ledgerSource: "interactive_article" as const,
      }
    : {};
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
    ...ledgerArgs,
  };
  const saveAttestation = await createAudioCacheSaveAttestation(saveArgs);
  await fetchMutation(anyApi.audio.saveSectionAudioRecord, {
    ...saveArgs,
    attestation: saveAttestation,
  });
};

const persistGeneratedAudio = async (
  args: PersistGeneratedAudioArgs,
): Promise<void> => {
  const ledgerAssetKey = createAudioCacheLedgerAssetKey();
  try {
    await persistGeneratedAudioAttempt({ ...args, ledgerAssetKey });
  } catch (error) {
    if (ledgerAssetKey) {
      await recordAudioCacheWriteFailureBestEffort({
        ledgerAssetKey,
        source: "interactive_article",
        provider: args.metadata.provider,
      });
    }
    throw error;
  }
};

type ArticleAudioIdentity =
  | { kind: "legacy"; sourceHash: string }
  | { kind: "native"; revisionId: string; narrationVersion: number };

const parseArticleAudioIdentity = (body: {
  sourceHash?: unknown;
  revisionId?: unknown;
  narrationVersion?: unknown;
}): ArticleAudioIdentity | null => {
  const hasLegacyIdentity = body.sourceHash !== undefined;
  const hasNativeIdentity =
    body.revisionId !== undefined || body.narrationVersion !== undefined;
  const normalizedRevisionId =
    typeof body.revisionId === "string" &&
    body.revisionId.length <= MAX_REVISION_ID_RAW_LENGTH
      ? normalizeMediaWikiNumericId(body.revisionId)
      : null;

  if (
    hasLegacyIdentity &&
    !hasNativeIdentity &&
    isBoundedString(body.sourceHash, MAX_SOURCE_HASH_LENGTH)
  ) {
    return { kind: "legacy", sourceHash: body.sourceHash };
  }
  if (
    hasNativeIdentity &&
    !hasLegacyIdentity &&
    normalizedRevisionId !== null &&
    typeof body.narrationVersion === "number" &&
    Number.isSafeInteger(body.narrationVersion) &&
    body.narrationVersion > 0
  ) {
    return {
      kind: "native",
      revisionId: normalizedRevisionId,
      narrationVersion: body.narrationVersion,
    };
  }
  return null;
};

export const POST = async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => null)) as {
      slug?: unknown;
      sectionKey?: unknown;
      sourceHash?: unknown;
      revisionId?: unknown;
      narrationVersion?: unknown;
      provider?: unknown;
    } | null;
    const identity = body ? parseArticleAudioIdentity(body) : null;
    if (
      !body ||
      !isBoundedString(body.slug, MAX_SLUG_LENGTH) ||
      !isBoundedString(body.sectionKey, MAX_SECTION_KEY_LENGTH) ||
      !identity
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

    const authorization = req.headers.get("authorization");
    let article: StoredArticle | null;
    let session: ArticleAudioSession;
    if (authorization === null) {
      [article, session] = await Promise.all([
        getCanonicalArticle(body.slug),
        getCookieSession(),
      ]);
    } else {
      const bearerSession = await getBearerSession(req, authorization);
      if (bearerSession instanceof NextResponse) return bearerSession;
      session = bearerSession;
      article = await getCanonicalArticle(body.slug);
    }
    if (!article) {
      return NextResponse.json(
        { error: "Article not found." },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const storedRevisionId = normalizeMediaWikiNumericId(article.revisionId);
    const nativeIdentityIsCurrent =
      identity.kind !== "native" ||
      (storedRevisionId !== null &&
        storedRevisionId === identity.revisionId &&
        article.narrationVersion === identity.narrationVersion);
    const track = nativeIdentityIsCurrent
      ? identity.kind === "legacy"
        ? resolveCanonicalArticleNarrationTrack(
            article,
            body.sectionKey,
            identity.sourceHash,
          )
        : (buildArticleNarrationTracks({
            ...article,
            revisionId: storedRevisionId ?? identity.revisionId,
          }).find((candidate) => candidate.sectionKey === body.sectionKey) ??
          null)
      : null;
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

    let expectedExistingLedgerAssetKey: string | undefined;
    if (cacheArgs) {
      try {
        const readAttestation =
          await createAudioCacheReadAttestation(cacheArgs);
        const cached = (await fetchMutation(
          anyApi.audio.getAllSectionAudioForServer,
          { ...cacheArgs, attestation: readAttestation },
          session.convexToken ? { token: session.convexToken } : {},
        )) as CachedSectionAudio;
        expectedExistingLedgerAssetKey =
          cached.ledgerAssetKeys?.[track.sectionKey];
        const cachedResult = buildCachedTtsResult(
          cached.urls[track.sectionKey],
          cached.metadata[track.sectionKey],
          expectedMetadata,
        );
        if (cachedResult) {
          const cachedBlob = await fetchCachedAudioBlob(cachedResult.url);
          if (cachedBlob) {
            const cachedDurationSeconds = cached.durations?.[track.sectionKey];
            recordInteractiveCacheReadAfterResponse({
              provider: expectedMetadata.provider,
              hit: true,
              byteLength: cachedBlob.size,
              durationSeconds:
                typeof cachedDurationSeconds === "number" &&
                Number.isFinite(cachedDurationSeconds) &&
                cachedDurationSeconds > 0
                  ? cachedDurationSeconds
                  : estimateAudioDurationSeconds(track.text),
            });
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
      recordInteractiveCacheReadAfterResponse({
        provider: expectedMetadata.provider,
        hit: false,
        byteLength: 0,
        durationSeconds: 0,
      });
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
            expectedExistingLedgerAssetKey,
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
    void error;
    console.error("[/api/article/audio/section] request failed");
    return NextResponse.json(
      { error: "Article audio generation failed." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
};
