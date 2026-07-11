import { anyApi } from "convex/server";
import { fetchAction, fetchMutation, fetchQuery } from "convex/nextjs";
import { uploadBlobToConvexStorage } from "@/convex/lib/storageUpload";
import { estimateDurationSeconds } from "@/convex/lib/articleAudioPipeline";
import {
  collectHomepageArticleRefs,
  HOMEPAGE_PREVIEW_LIMITS,
  type HomepageArticleRef,
} from "@/lib/homepage-articles";
import { getTodayWikipediaData, type TodayWikipediaData } from "@/lib/today-snapshot";
import {
  generateTtsAudioWithMetadata,
  type TtsAudioResult,
} from "@/lib/tts-client";
import { getTtsQuotaBypassHeaders } from "@/lib/tts-quota-bypass";
import {
  getActiveTtsProfile,
  getTtsMetadata,
  type TtsMetadata,
} from "@/lib/tts-profile";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_DEADLINE_MS = 240_000;
const MIN_SUMMARY_LENGTH = 10;

type CachedSummaryAudio = {
  url?: string;
  metadata?: Partial<TtsMetadata>;
};

type WarmArticle = {
  _id: string;
  summary?: string;
};

type SaveSummaryAudioArgs = {
  articleId: string;
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
  failures: HomepageAudioWarmFailure[];
};

export type HomepageAudioWarmDependencies = {
  fetchArticle: (article: HomepageArticleRef) => Promise<WarmArticle>;
  getCachedSummary: (
    articleId: string,
    expected: TtsMetadata,
  ) => Promise<CachedSummaryAudio>;
  verifyAudioUrl: (url: string) => Promise<void>;
  generateAudio: (text: string, expected: TtsMetadata) => Promise<TtsAudioResult>;
  saveSummary: (args: SaveSummaryAudioArgs) => Promise<void>;
  now: () => number;
};

export type HomepageAudioWarmOptions = {
  baseUrl: string;
  snapshot: TodayWikipediaData;
  maxArticles?: number;
  concurrency?: number;
  deadlineMs?: number;
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
): HomepageAudioWarmDependencies => ({
  async fetchArticle(article) {
    const result = article.wikiPageId
      ? await fetchAction(anyApi.articles.fetchAndCache, {
          wikiPageId: article.wikiPageId,
        })
      : await fetchAction(anyApi.articles.fetchAndCacheBySlug, {
          slug: article.slug,
        });
    return result as WarmArticle;
  },
  async getCachedSummary(articleId, expected) {
    const cached = (await fetchQuery(anyApi.audio.getAllSectionAudio, {
      articleId,
      ttsNormVersion: expected.ttsNormVersion,
      ttsCacheKey: expected.ttsCacheKey,
    })) as {
      urls?: Record<string, string>;
      metadata?: Record<string, Partial<TtsMetadata>>;
    };
    return {
      url: cached.urls?.summary,
      metadata: cached.metadata?.summary,
    };
  },
  async verifyAudioUrl(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Cached summary audio returned ${response.status}`);
    }
    await response.body?.cancel();
  },
  generateAudio(text, expected) {
    return generateTtsAudioWithMetadata(
      { text, provider: expected.provider },
      { apiBaseUrl: baseUrl, headers: getTtsQuotaBypassHeaders() },
    );
  },
  async saveSummary({ articleId, blob, durationSeconds, metadata }) {
    const uploadUrl = await fetchMutation(anyApi.audio.generateUploadUrl, {});
    const storageId = await uploadBlobToConvexStorage(uploadUrl as string, blob);
    await fetchMutation(anyApi.audio.saveSectionAudioRecord, {
      articleId,
      sectionKey: "summary",
      storageId,
      ttsNormVersion: metadata.ttsNormVersion,
      ttsCacheKey: metadata.ttsCacheKey,
      provider: metadata.provider,
      model: metadata.model,
      voiceId: metadata.voiceId,
      promptVersion: metadata.promptVersion,
      durationSeconds,
    });
  },
  now: Date.now,
});

export const warmHomepageArticleSummaries = async ({
  baseUrl,
  snapshot,
  maxArticles = HOMEPAGE_PREVIEW_LIMITS.warmedArticles,
  concurrency = DEFAULT_CONCURRENCY,
  deadlineMs = DEFAULT_DEADLINE_MS,
  dependencies = createProductionDependencies(baseUrl),
}: HomepageAudioWarmOptions): Promise<HomepageAudioWarmResult> => {
  const collection = collectHomepageArticleRefs(snapshot, maxArticles);
  const expected = getTtsMetadata(getActiveTtsProfile());
  const result: HomepageAudioWarmResult = {
    status: "completed",
    targets: collection.articles.length,
    reused: 0,
    generated: 0,
    degraded: 0,
    failed: 0,
    capped: collection.capped,
    deadlineSkipped: 0,
    failures: [],
  };
  const startedAt = dependencies.now();
  let nextIndex = 0;
  let processed = 0;

  const warmArticle = async (ref: HomepageArticleRef): Promise<void> => {
    try {
      const article = await dependencies.fetchArticle(ref);
      const summary = article.summary?.trim() ?? "";
      if (summary.length < MIN_SUMMARY_LENGTH) {
        throw new Error("Article summary is unavailable or too short for audio");
      }

      const cached = await dependencies.getCachedSummary(article._id, expected);
      if (cached.url && metadataMatches(cached.metadata, expected)) {
        try {
          await dependencies.verifyAudioUrl(cached.url);
          result.reused += 1;
          return;
        } catch (error) {
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

      const generated = await dependencies.generateAudio(summary, expected);
      await dependencies.saveSummary({
        articleId: article._id,
        blob: generated.blob,
        durationSeconds: estimateDurationSeconds(summary),
        metadata: generated.metadata,
      });
      result.generated += 1;
      if (!metadataMatches(generated.metadata, expected)) {
        result.degraded += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        slug: ref.slug,
        title: ref.title,
        source: ref.source,
        error: sanitizeError(error),
      });
    } finally {
      processed += 1;
    }
  };

  const worker = async (): Promise<void> => {
    while (true) {
      if (dependencies.now() - startedAt >= deadlineMs) return;
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
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  result.deadlineSkipped = Math.max(0, result.targets - processed);
  if (
    result.failed > 0 ||
    result.degraded > 0 ||
    result.capped > 0 ||
    result.deadlineSkipped > 0
  ) {
    result.status = "partial";
  }
  return result;
};

const emptyResult = (
  status: "disabled" | "missing_snapshot",
): HomepageAudioWarmResult => ({
  status,
  targets: 0,
  reused: 0,
  generated: 0,
  degraded: 0,
  failed: 0,
  capped: 0,
  deadlineSkipped: 0,
  failures: [],
});

export const warmLatestHomepageArticleSummaries = async ({
  baseUrl,
}: {
  baseUrl: string;
}): Promise<HomepageAudioWarmResult> => {
  if (!isHomepageAudioWarmEnabled()) return emptyResult("disabled");

  const snapshot = await getTodayWikipediaData({ allowLiveFallback: false });
  if (!snapshot) return emptyResult("missing_snapshot");

  const settings = getHomepageAudioWarmSettings();
  return warmHomepageArticleSummaries({
    baseUrl,
    snapshot,
    ...settings,
  });
};
