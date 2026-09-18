import { anyApi } from "convex/server";
import {
  fetchConvexActionWithTimeout,
  fetchConvexMutationWithTimeout,
  fetchConvexQueryWithTimeout,
} from "@/lib/convex-request-timeout";
import {
  createRequestDeadline,
  runWithAbortSignal,
} from "@/lib/request-deadline";
import { uploadBlobToConvexStorage } from "@/convex/lib/storageUpload";
import { estimateDurationSeconds } from "@/convex/lib/articleAudioPipeline";
import {
  collectHomepageArticleRefs,
  HOMEPAGE_PREVIEW_LIMITS,
  type HomepageArticleRef,
} from "@/lib/homepage-articles";
import {
  getTodayWikipediaData,
  type TodayWikipediaData,
} from "@/lib/today-snapshot";
import {
  generateTtsAudioWithMetadata,
  type TtsAudioResult,
} from "@/lib/tts-client";
import {
  createAudioCacheReadAttestation,
  createAudioCacheSaveAttestation,
  createAudioCacheUploadAttestation,
  getTrustedTtsGenerationHeaders,
} from "@/lib/tts-quota-bypass";
import { buildArticleNarrationTracks } from "@/lib/section-narration";
import {
  recordAudioCacheReadResultBestEffort,
  recordAudioCacheWriteFailureBestEffort,
  type AudioCacheReadResultInput,
} from "@/lib/audio-cache-ledger";
import { createAudioCacheLedgerAssetKey } from "@/lib/audio-cache-ledger-key";
import {
  getTtsMetadata,
  getTtsProfile,
  type TtsMetadata,
} from "@/lib/tts-profile";

const DEFAULT_CONCURRENCY = 3;
export const HOMEPAGE_AUDIO_WARM_DEADLINE_MS = 240_000;
export const HOMEPAGE_AUDIO_WARM_DEADLINE_MESSAGE =
  "Homepage audio warm deadline exceeded";
const MIN_SUMMARY_LENGTH = 1;

type CachedSummaryAudio = {
  url?: string;
  metadata?: Partial<TtsMetadata>;
  durationSeconds?: number;
  byteLength?: number;
};

type WarmArticle = {
  _id: string;
  title: string;
  revisionId: string;
  narrationVersion: number;
  summary?: string;
};

type SaveSummaryAudioArgs = {
  articleId: string;
  sourceHash: string;
  blob: Blob;
  durationSeconds: number;
  metadata: TtsMetadata;
};

export type HomepageAudioWarmFailure = {
  slug: string;
  title: string;
  source: HomepageArticleRef["source"];
  error: string;
};

export type HomepageAudioWarmResult = {
  status: "completed" | "partial" | "disabled" | "missing_snapshot";
  targets: number;
  reused: number;
  generated: number;
  degraded: number;
  failed: number;
  capped: number;
  deadlineSkipped: number;
  deadlineExceeded: boolean;
  failures: HomepageAudioWarmFailure[];
};

export type HomepageAudioWarmDependencies = {
  fetchArticle: (article: HomepageArticleRef) => Promise<WarmArticle>;
  getCachedSummary: (
    articleId: string,
    sourceHash: string,
    expected: TtsMetadata,
  ) => Promise<CachedSummaryAudio>;
  verifyAudioUrl: (url: string) => Promise<void>;
  recordCacheReadResult: (input: AudioCacheReadResultInput) => Promise<void>;
  generateAudio: (
    text: string,
    expected: TtsMetadata,
  ) => Promise<TtsAudioResult>;
  saveSummary: (args: SaveSummaryAudioArgs) => Promise<void>;
  now: () => number;
};

export type HomepageAudioWarmOptions = {
  baseUrl: string;
  snapshot: TodayWikipediaData;
  maxArticles?: number;
  concurrency?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
  dependencies?: HomepageAudioWarmDependencies;
};

const parsePositiveInteger = (
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const isHomepageAudioWarmEnabled = (
  value = process.env.HOMEPAGE_AUDIO_WARM_ENABLED,
  nodeEnv = process.env.NODE_ENV,
): boolean => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "false" || normalized === "0") return false;
  if (normalized === "true" || normalized === "1") return true;
  return nodeEnv === "production";
};

export const getHomepageAudioWarmSettings = () => ({
  maxArticles: Math.min(
    HOMEPAGE_PREVIEW_LIMITS.warmedArticles,
    parsePositiveInteger(
      process.env.HOMEPAGE_AUDIO_WARM_MAX_ARTICLES,
      HOMEPAGE_PREVIEW_LIMITS.warmedArticles,
    ),
  ),
  concurrency: Math.min(
    6,
    parsePositiveInteger(
      process.env.HOMEPAGE_AUDIO_WARM_CONCURRENCY,
      DEFAULT_CONCURRENCY,
    ),
  ),
});

const metadataMatches = (
  actual: Partial<TtsMetadata> | undefined,
  expected: TtsMetadata,
): boolean =>
  actual?.provider === expected.provider &&
  actual.model === expected.model &&
  actual.voiceId === expected.voiceId &&
  actual.promptVersion === expected.promptVersion &&
  actual.ttsNormVersion === expected.ttsNormVersion &&
  actual.ttsCacheKey === expected.ttsCacheKey;

const sanitizeError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : "Unknown error";
  return message
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 240);
};

const createProductionDependencies = (
  baseUrl: string,
  signal: AbortSignal,
): HomepageAudioWarmDependencies => {
  const requestOptions = {
    signal,
    timeoutMs: 0,
    message: HOMEPAGE_AUDIO_WARM_DEADLINE_MESSAGE,
  };
  return {
    async fetchArticle(article) {
      const result = article.wikiPageId
        ? await fetchConvexActionWithTimeout(
            anyApi.articles.fetchAndCache,
            {
              wikiPageId: article.wikiPageId,
            },
            requestOptions,
          )
        : await fetchConvexActionWithTimeout(
            anyApi.articles.fetchAndCacheBySlug,
            {
              slug: article.slug,
            },
            requestOptions,
          );
      return result as WarmArticle;
    },
    async getCachedSummary(articleId, sourceHash, expected) {
      const cacheArgs = {
        articleId,
        ttsNormVersion: expected.ttsNormVersion,
        ttsCacheKey: expected.ttsCacheKey,
        sourceHashes: [{ sectionKey: "summary", sourceHash }],
      };
      const cached = (
        process.env.TTS_QUOTA_BYPASS_SECRET?.trim()
          ? await (async () => {
              const attestation =
                await createAudioCacheReadAttestation(cacheArgs);
              signal.throwIfAborted();
              return await fetchConvexMutationWithTimeout(
                anyApi.audio.getAllSectionAudioForServer,
                { ...cacheArgs, attestation },
                requestOptions,
              );
            })()
          : await fetchConvexQueryWithTimeout(
              anyApi.audio.getAllSectionAudio,
              cacheArgs,
              requestOptions,
            )
      ) as {
        urls?: Record<string, string>;
        metadata?: Record<string, Partial<TtsMetadata>>;
        durations?: Record<string, number>;
        byteLengths?: Record<string, number>;
      };
      return {
        url: cached.urls?.summary,
        metadata: cached.metadata?.summary,
        durationSeconds: cached.durations?.summary,
        byteLength: cached.byteLengths?.summary,
      };
    },
    async verifyAudioUrl(url) {
      signal.throwIfAborted();
      const response = await fetch(url, { cache: "no-store", signal });
      if (!response.ok) {
        throw new Error(`Cached summary audio returned ${response.status}`);
      }
      await response.body?.cancel();
    },
    recordCacheReadResult: (input) =>
      recordAudioCacheReadResultBestEffort(input, signal),
    async generateAudio(text, expected) {
      const headers = await getTrustedTtsGenerationHeaders(
        baseUrl,
        "featured_audio_warm",
      );
      signal.throwIfAborted();
      return generateTtsAudioWithMetadata(
        { text, provider: expected.provider },
        {
          apiBaseUrl: baseUrl,
          signal,
          headers,
        },
      );
    },
    async saveSummary({
      articleId,
      sourceHash,
      blob,
      durationSeconds,
      metadata,
    }) {
      const ledgerAssetKey = createAudioCacheLedgerAssetKey();
      const uploadAttestation = await createAudioCacheUploadAttestation();
      signal.throwIfAborted();
      const uploadUrl = await fetchConvexMutationWithTimeout(
        anyApi.audio.generateUploadUrl,
        {
          attestation: uploadAttestation,
        },
        requestOptions,
      );
      signal.throwIfAborted();
      const storageId = await uploadBlobToConvexStorage(
        uploadUrl as string,
        blob,
        signal,
      );
      signal.throwIfAborted();
      const record = {
        articleId,
        sectionKey: "summary",
        sourceHash,
        storageId,
        ttsNormVersion: metadata.ttsNormVersion,
        ttsCacheKey: metadata.ttsCacheKey,
        provider: metadata.provider,
        model: metadata.model,
        voiceId: metadata.voiceId,
        promptVersion: metadata.promptVersion,
        durationSeconds,
        ...(ledgerAssetKey
          ? {
              byteLength: blob.size,
              ledgerAssetKey,
              ledgerSource: "featured_audio_warm" as const,
            }
          : {}),
      };
      const saveAttestation = await createAudioCacheSaveAttestation(record);
      signal.throwIfAborted();
      try {
        await fetchConvexMutationWithTimeout(
          anyApi.audio.saveSectionAudioRecord,
          {
            ...record,
            attestation: saveAttestation,
          },
          requestOptions,
        );
      } catch (error) {
        if (ledgerAssetKey && !signal.aborted) {
          await recordAudioCacheWriteFailureBestEffort(
            {
              ledgerAssetKey,
              source: "featured_audio_warm",
              provider: metadata.provider,
            },
            signal,
          );
        }
        throw error;
      }
    },
    now: Date.now,
  };
};

export const warmHomepageArticleSummaries = async ({
  baseUrl,
  snapshot,
  maxArticles = HOMEPAGE_PREVIEW_LIMITS.warmedArticles,
  concurrency = DEFAULT_CONCURRENCY,
  deadlineMs = HOMEPAGE_AUDIO_WARM_DEADLINE_MS,
  signal: parentSignal,
  dependencies: providedDependencies,
}: HomepageAudioWarmOptions): Promise<HomepageAudioWarmResult> => {
  const deadline = createRequestDeadline(
    deadlineMs,
    HOMEPAGE_AUDIO_WARM_DEADLINE_MESSAGE,
    parentSignal,
  );
  const { signal } = deadline;
  const dependencies =
    providedDependencies ?? createProductionDependencies(baseUrl, signal);
  const run = <T>(operation: () => Promise<T>) =>
    runWithAbortSignal(signal, operation);
  const collection = collectHomepageArticleRefs(snapshot, maxArticles);
  const expected = getTtsMetadata(getTtsProfile("edge"));
  const result: HomepageAudioWarmResult = {
    status: "completed",
    targets: collection.articles.length,
    reused: 0,
    generated: 0,
    degraded: 0,
    failed: 0,
    capped: collection.capped,
    deadlineSkipped: 0,
    deadlineExceeded: false,
    failures: [],
  };
  const startedAt = dependencies.now();
  let nextIndex = 0;
  let processed = 0;

  const recordCacheReadResult = async (
    input: AudioCacheReadResultInput,
  ): Promise<void> => {
    try {
      await run(() => dependencies.recordCacheReadResult(input));
    } catch {
      console.warn(
        "[ai-cost-ledger] Homepage audio cache read was not recorded.",
      );
    }
  };

  const warmArticle = async (ref: HomepageArticleRef): Promise<void> => {
    try {
      const article = await run(() => dependencies.fetchArticle(ref));
      const summaryTrack = buildArticleNarrationTracks(article).find(
        (track) => track.sectionKey === "summary",
      );
      if (!summaryTrack || summaryTrack.text.length < MIN_SUMMARY_LENGTH) {
        throw new Error(
          "Article summary is unavailable or too short for audio",
        );
      }

      const summary = summaryTrack.text;
      const sourceHash = summaryTrack.sourceHash;
      const cached = await run(() =>
        dependencies.getCachedSummary(article._id, sourceHash, expected),
      );
      if (cached.url && metadataMatches(cached.metadata, expected)) {
        try {
          await run(() => dependencies.verifyAudioUrl(cached.url!));
          await recordCacheReadResult({
            source: "featured_audio_warm",
            provider: expected.provider,
            hit: true,
            byteLength:
              Number.isFinite(cached.byteLength) && (cached.byteLength ?? 0) > 0
                ? cached.byteLength!
                : 0,
            durationSeconds:
              Number.isFinite(cached.durationSeconds) &&
              (cached.durationSeconds ?? 0) >= 0
                ? cached.durationSeconds!
                : estimateDurationSeconds(summary),
          });
          signal.throwIfAborted();
          result.reused += 1;
          return;
        } catch (error) {
          signal.throwIfAborted();
          console.warn(
            "[homepage-audio-warm] cached summary unavailable; regenerating",
            {
              title: ref.title,
              source: ref.source,
              ttsCacheKey: expected.ttsCacheKey,
              error: sanitizeError(error),
            },
          );
        }
      }

      await recordCacheReadResult({
        source: "featured_audio_warm",
        provider: expected.provider,
        hit: false,
        byteLength: 0,
        durationSeconds: 0,
      });

      const generated = await run(() =>
        dependencies.generateAudio(summary, expected),
      );
      await run(() =>
        dependencies.saveSummary({
          articleId: article._id,
          sourceHash,
          blob: generated.blob,
          durationSeconds: estimateDurationSeconds(summary),
          metadata: generated.metadata,
        }),
      );
      signal.throwIfAborted();
      result.generated += 1;
      if (!metadataMatches(generated.metadata, expected)) {
        result.degraded += 1;
      }
    } catch (error) {
      if (signal.aborted) return;
      result.failed += 1;
      result.failures.push({
        slug: ref.slug,
        title: ref.title,
        source: ref.source,
        error: sanitizeError(error),
      });
    } finally {
      if (!signal.aborted) processed += 1;
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      if (signal.aborted || dependencies.now() - startedAt >= deadlineMs)
        return;
      const index = nextIndex;
      nextIndex += 1;
      const ref = collection.articles[index];
      if (!ref) return;
      await warmArticle(ref);
    }
  };

  const workerCount = Math.max(
    1,
    Math.min(Math.floor(concurrency), collection.articles.length || 1),
  );
  try {
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    deadline.dispose();
  }

  result.deadlineSkipped = Math.max(0, result.targets - processed);
  result.deadlineExceeded = signal.aborted || result.deadlineSkipped > 0;
  if (
    result.failed > 0 ||
    result.degraded > 0 ||
    result.capped > 0 ||
    result.deadlineExceeded
  ) {
    result.status = "partial";
  }
  return result;
};

const emptyResult = (
  status: "disabled" | "missing_snapshot" | "partial",
): HomepageAudioWarmResult => ({
  status,
  targets: 0,
  reused: 0,
  generated: 0,
  degraded: 0,
  failed: 0,
  capped: 0,
  deadlineSkipped: 0,
  deadlineExceeded: status === "partial",
  failures: [],
});

export const warmLatestHomepageArticleSummaries = async ({
  baseUrl,
  signal,
  deadlineMs = HOMEPAGE_AUDIO_WARM_DEADLINE_MS,
}: {
  baseUrl: string;
  signal?: AbortSignal;
  deadlineMs?: number;
}): Promise<HomepageAudioWarmResult> => {
  if (!isHomepageAudioWarmEnabled()) return emptyResult("disabled");

  const deadline = createRequestDeadline(
    deadlineMs,
    HOMEPAGE_AUDIO_WARM_DEADLINE_MESSAGE,
    signal,
  );
  try {
    const snapshot = await runWithAbortSignal(deadline.signal, () =>
      getTodayWikipediaData({
        allowLiveFallback: false,
        signal: deadline.signal,
      }),
    );
    if (!snapshot) return emptyResult("missing_snapshot");
    return await warmHomepageArticleSummaries({
      baseUrl,
      snapshot,
      signal: deadline.signal,
      ...getHomepageAudioWarmSettings(),
    });
  } catch (error) {
    if (deadline.signal.aborted) return emptyResult("partial");
    throw error;
  } finally {
    deadline.dispose();
  }
};
