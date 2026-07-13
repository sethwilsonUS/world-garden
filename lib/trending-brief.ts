import { randomUUID } from "node:crypto";
import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { addMp3MetadataToBlob } from "@/lib/audio-metadata";
import {
  TRENDING_AI_AUDIO_DISCLOSURE,
  TRENDING_PODCAST_TITLE,
} from "@/lib/podcast-feed";
import { getTodayWikipediaData } from "@/lib/today-snapshot";
import { getOpenAIClient, isOpenAIConfigured } from "@/lib/openai-client";
import { generateTtsAudioWithMetadata } from "@/lib/tts-client";
import { getTtsQuotaBypassHeaders } from "@/lib/tts-quota-bypass";
import {
  getActiveTtsCacheKey,
  getActiveTtsProfile,
  getTtsMetadata,
  type TtsMetadata,
} from "@/lib/tts-profile";
import {
  TRENDING_EPISODE_ARTWORK_VERSION,
  renderTrendingPodcastArtworkPng,
  type TrendingArtworkItem,
} from "@/lib/trending-podcast-artwork";

const TTS_WORDS_PER_SECOND = 2.5;
const DEFAULT_TRENDING_BRIEF_MODEL = "gpt-5.6-luna";
const MAX_ARTICLES_IN_PROMPT = 10;
const MAX_KEY_POINTS = 5;
const MAX_SOURCES = 6;
const JOB_LEASE_MS = 8 * 60 * 1000;
const TRENDING_AUDIO_SCRIPT_VERSION = "ai-disclosure-v1";
const inFlightTrendingBriefs = new Map<string, Promise<TrendingBriefSyncResult>>();

export const getTrendingAudioCacheKey = (): string =>
  `${getActiveTtsCacheKey()}:trending-script:${TRENDING_AUDIO_SCRIPT_VERSION}`;

export const getTrendingAudioScript = (spokenSummary: string): string =>
  `${TRENDING_AI_AUDIO_DISCLOSURE} ${spokenSummary.trim()}`;

export const getTrendingBriefModel = (): string => {
  const configuredModel = process.env.TRENDING_BRIEF_MODEL?.trim();
  if (!configuredModel) return DEFAULT_TRENDING_BRIEF_MODEL;

  // Smooth the transition from the Gateway's provider/model identifiers.
  if (configuredModel.startsWith("openai/")) {
    return configuredModel.slice("openai/".length);
  }
  if (configuredModel.includes("/")) {
    console.warn(
      `[podcast:trending] Ignoring non-OpenAI TRENDING_BRIEF_MODEL=${configuredModel}; using ${DEFAULT_TRENDING_BRIEF_MODEL}`,
    );
    return DEFAULT_TRENDING_BRIEF_MODEL;
  }

  return configuredModel;
};

type TrendingArticle = {
  title: string;
  extract: string;
  views: number;
  imageUrl?: string;
};

type TrendingBriefSource = {
  title: string;
  url: string;
};

type GeneratedTrendingBrief = {
  headline: string;
  summary: string;
  podcastDescription: string;
  spokenSummary: string;
  keyPoints: string[];
  sources: TrendingBriefSource[];
};

const TrimmedNonEmptyTextSchema = z.string().trim().min(1);

const TrendingBriefOutputSchema = z.object({
  headline: TrimmedNonEmptyTextSchema,
  summary: TrimmedNonEmptyTextSchema,
  podcastDescription: TrimmedNonEmptyTextSchema,
  spokenSummary: TrimmedNonEmptyTextSchema,
  keyPoints: z
    .array(TrimmedNonEmptyTextSchema)
    .min(3)
    .max(MAX_KEY_POINTS),
});

export type TrendingBriefRecord = {
  _id: string;
  trendingDate: string;
  status: "pending" | "ready" | "failed";
  headline?: string;
  summary?: string;
  podcastDescription?: string;
  spokenSummary?: string;
  keyPoints?: string[];
  articleTitles?: string[];
  imageUrls?: string[];
  artworkItems?: TrendingArtworkItem[];
  sources?: TrendingBriefSource[];
  storageId?: string;
  artworkStorageId?: string;
  artworkVersion?: number;
  audioUrl: string | null;
  artworkUrl?: string | null;
  durationSeconds?: number;
  byteLength?: number;
  model?: string;
  ttsModel?: string;
  ttsCacheKey?: string;
  provider?: string;
  voiceId?: string;
  promptVersion?: string;
  ttsNormVersion?: string;
  lastError?: string;
  updatedAt: number;
};

export type TrendingBriefSyncResult = {
  status: "created" | "already_exists";
  brief: TrendingBriefRecord;
  source: {
    trendingDate: string;
    articleTitles: string[];
  };
  publication: {
    reusedExisting: boolean;
    repairedExisting: boolean;
    regeneratedArtwork: boolean;
  };
};

export type DailyTrendingBriefState = {
  enabled: boolean;
  status: "disabled" | "missing" | "pending" | "failed" | "ready";
  trendingDate: string;
  sourceIsStale?: boolean;
  articleTitles: string[];
  brief: TrendingBriefRecord | null;
  lastError?: string;
};

const isNonEmptyString = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const getCachedTrendingBriefContent = (
  record: TrendingBriefRecord | null,
): GeneratedTrendingBrief | null => {
  if (
    !record ||
    !isNonEmptyString(record.headline) ||
    !isNonEmptyString(record.summary) ||
    !isNonEmptyString(record.podcastDescription) ||
    !isNonEmptyString(record.spokenSummary) ||
    !Array.isArray(record.keyPoints) ||
    !Array.isArray(record.sources)
  ) {
    return null;
  }

  return {
    headline: record.headline,
    summary: record.summary,
    podcastDescription: record.podcastDescription,
    spokenSummary: record.spokenSummary,
    keyPoints: record.keyPoints,
    sources: record.sources,
  };
};

export const hasCurrentTrendingArtworkVersion = (
  record: Pick<TrendingBriefRecord, "artworkVersion"> | null,
): boolean => record?.artworkVersion === TRENDING_EPISODE_ARTWORK_VERSION;

export const shouldReuseExistingTrendingBrief = (
  record: TrendingBriefRecord | null,
  options?: { force?: boolean; regenArt?: boolean },
): record is TrendingBriefRecord =>
  Boolean(
      record?.status === "ready" &&
      record.audioUrl &&
      record.ttsCacheKey === getTrendingAudioCacheKey() &&
      !(options?.force && options?.regenArt) &&
      (!options?.regenArt || hasCurrentTrendingArtworkVersion(record)),
  );

const fetchBlobFromUrl = async (url: string): Promise<Blob> => {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Fetching cached audio failed: ${response.status}`);
  }
  return await response.blob();
};

const estimateDurationSeconds = (text: string): number =>
  Math.round(text.split(/\s+/).filter(Boolean).length / TTS_WORDS_PER_SECOND);

const sanitizeText = (text: string): string => text.replace(/\r\n/g, "\n").trim();

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const stripUrlsFromSpeech = (text: string): string =>
  text.replace(/https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();

const normalizeHttpUrl = (value: string): string | null => {
  const normalized = value.trim();
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return normalized;
  } catch {
    return null;
  }
};

const dedupeSources = (sources: TrendingBriefSource[]): TrendingBriefSource[] => {
  const seen = new Set<string>();
  const result: TrendingBriefSource[] = [];

  for (const source of sources) {
    const title = sanitizeText(source.title);
    const url = normalizeHttpUrl(source.url);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    result.push({ title, url });
    if (result.length >= MAX_SOURCES) break;
  }

  return result;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object";

const getSourceTitleFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Web source";
  }
};

/**
 * Builds the reader-facing source list from Responses API web-search metadata.
 * Citation annotations take precedence because they include useful page titles;
 * the complete consulted-source list fills any remaining slots.
 */
export const extractTrendingBriefSources = (
  output: unknown,
): TrendingBriefSource[] => {
  if (!Array.isArray(output)) return [];

  const citations: TrendingBriefSource[] = [];
  const consultedSources: TrendingBriefSource[] = [];

  for (const item of output) {
    if (!isRecord(item)) continue;

    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (!isRecord(content) || !Array.isArray(content.annotations)) continue;
        for (const annotation of content.annotations) {
          if (
            !isRecord(annotation) ||
            annotation.type !== "url_citation" ||
            typeof annotation.url !== "string"
          ) {
            continue;
          }
          citations.push({
            title:
              typeof annotation.title === "string" && annotation.title.trim()
                ? annotation.title
                : getSourceTitleFromUrl(annotation.url),
            url: annotation.url,
          });
        }
      }
    }

    if (item.type === "web_search_call" && isRecord(item.action)) {
      const sources = item.action.sources;
      if (!Array.isArray(sources)) continue;
      for (const source of sources) {
        if (!isRecord(source) || typeof source.url !== "string") continue;
        consultedSources.push({
          title: getSourceTitleFromUrl(source.url),
          url: source.url,
        });
      }
    }
  }

  return dedupeSources([...citations, ...consultedSources]);
};

export const normalizeTrendingBrief = (
  input: GeneratedTrendingBrief,
): GeneratedTrendingBrief => {
  const headline = sanitizeText(input.headline);
  const summary = sanitizeText(input.summary);
  const podcastDescription = sanitizeText(input.podcastDescription);
  const spokenSummary = stripUrlsFromSpeech(sanitizeText(input.spokenSummary));
  const keyPoints = input.keyPoints
    .map((item) => sanitizeText(item))
    .filter(Boolean)
    .slice(0, MAX_KEY_POINTS);
  const sources = dedupeSources(input.sources);

  return {
    headline,
    summary,
    podcastDescription: podcastDescription || summary,
    spokenSummary: spokenSummary || summary,
    keyPoints,
    sources,
  };
};

export const buildTrendingBriefPrompt = ({
  trendingDate,
  articles,
}: {
  trendingDate: string;
  articles: TrendingArticle[];
}): string => {
  const articleList = articles
    .slice(0, MAX_ARTICLES_IN_PROMPT)
    .map(
      (article, index) =>
        `${index + 1}. ${article.title} (${article.views.toLocaleString()} views)\n   Wikipedia extract: ${article.extract || "No extract available."}`,
    )
    .join("\n");

  return [
    `Today's Wikipedia trending date is ${trendingDate}.`,
    "You are preparing a daily Curio Garden trend briefing about why these English Wikipedia articles are trending.",
    "Use only the supplied web research and Wikipedia context. If the reason is uncertain, say that clearly.",
    "Do not claim that something is trending for a specific reason unless the research supports it.",
    "The response schema is enforced separately; write complete content for every requested field.",
    "For podcastDescription, write a compact 1-2 sentence episode description suitable for a podcast app listing. Keep it shorter than summary.",
    "For spokenSummary, write natural audio-ready prose with no markdown, no bullets, and no URLs.",
    "For summary, keep it readable on-screen in 1-2 short paragraphs.",
    "For keyPoints, provide 3-5 short bullets explaining the most likely drivers across the list.",
    "",
    "Trending Wikipedia articles:",
    articleList,
  ].join("\n");
};

const buildTrendingResearchPrompt = ({
  trendingDate,
  articles,
}: {
  trendingDate: string;
  articles: TrendingArticle[];
}): string => {
  const articleTitles = articles.map((article) => article.title).join(", ");

  return [
    `Today's Wikipedia trending date is ${trendingDate}.`,
    `Search recent news coverage for likely reasons these topics are trending: ${articleTitles}.`,
    "Use web search and gather the most relevant recent reporting.",
    "Focus on timely events, deaths, announcements, releases, sports moments, political developments, and media coverage spikes.",
    "Return a short plain-text research note summarizing the strongest explanations you found, with inline citations.",
    "If no credible recent source explains an item, explicitly mark its cause as uncertain rather than guessing.",
  ].join("\n");
};

type TrendingOpenAIClient = Pick<OpenAI, "responses">;

const logOpenAIUsage = ({
  stage,
  response,
  webSearchCalls = 0,
}: {
  stage: "research" | "writing";
  response: {
    model?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    } | null;
  };
  webSearchCalls?: number;
}) => {
  console.info(
    `[podcast:trending:openai] stage=${stage} model=${response.model ?? "unknown"} inputTokens=${response.usage?.input_tokens ?? 0} outputTokens=${response.usage?.output_tokens ?? 0} totalTokens=${response.usage?.total_tokens ?? 0} webSearchCalls=${webSearchCalls}`,
  );
};

export const generateTrendingBriefContent = async ({
  client,
  model,
  trendingDate,
  articles,
}: {
  client: TrendingOpenAIClient;
  model: string;
  trendingDate: string;
  articles: TrendingArticle[];
}): Promise<GeneratedTrendingBrief> => {
  const researchResult = await client.responses.create({
    model,
    instructions:
      "You are a careful editorial researcher for an accessibility-first Wikipedia listening app. Use current, reputable reporting to investigate why topics are trending. Distinguish supported explanations from uncertainty.",
    input: buildTrendingResearchPrompt({ trendingDate, articles }),
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    reasoning: { effort: "medium" },
    max_output_tokens: 4_000,
    metadata: { workflow: "trending-brief", stage: "research" },
    safety_identifier: "public-trending-brief",
    store: false,
  });

  const webSearchCalls = researchResult.output.filter(
    (item) => item.type === "web_search_call",
  ).length;
  logOpenAIUsage({
    stage: "research",
    response: researchResult,
    webSearchCalls,
  });

  if (webSearchCalls === 0) {
    throw new Error("Trending brief research did not perform a web search");
  }

  const researchText = researchResult.output_text.trim();
  if (!researchText) {
    throw new Error("Trending brief research returned empty text");
  }

  const sources = extractTrendingBriefSources(researchResult.output);
  if (sources.length === 0) {
    throw new Error("Trending brief research did not return cited web sources");
  }

  const writingResult = await client.responses.parse({
    model,
    instructions:
      "You are a careful editorial analyst for an accessibility-first Wikipedia listening app. Explain why topics are trending using only the supplied research and article context, never speculation. Write clean prose for sighted and screen-reader audiences.",
    input: [
      buildTrendingBriefPrompt({ trendingDate, articles }),
      "",
      "Research context from OpenAI web search:",
      researchText,
      "",
      "Verified source list:",
      ...sources.map((source) => `- ${source.title}: ${source.url}`),
    ].join("\n"),
    reasoning: { effort: "medium" },
    max_output_tokens: 4_000,
    text: {
      format: zodTextFormat(TrendingBriefOutputSchema, "trending_brief"),
      verbosity: "low",
    },
    metadata: { workflow: "trending-brief", stage: "writing" },
    safety_identifier: "public-trending-brief",
    store: false,
  });

  logOpenAIUsage({ stage: "writing", response: writingResult });

  if (!writingResult.output_parsed) {
    throw new Error("Trending brief writing pass returned no structured output");
  }

  const normalized = normalizeTrendingBrief({
    ...writingResult.output_parsed,
    sources,
  });
  const validated = TrendingBriefOutputSchema.parse(normalized);
  return { ...validated, sources: normalized.sources };
};

export const selectTrendingArtworkItems = (
  articles: Array<Pick<TrendingArticle, "title" | "imageUrl">>,
): TrendingArtworkItem[] =>
  articles
    .map((article) => ({
      title: article.title.trim(),
      imageUrl: article.imageUrl?.trim() ?? "",
    }))
    .filter((article) => article.title && article.imageUrl)
    .slice(0, 4);

export const getCurrentTrendingBriefSource = async (): Promise<{
  trendingDateIso: string;
  sourceIsStale: boolean;
  articles: TrendingArticle[];
  artworkItems: TrendingArtworkItem[];
}> => {
  const snapshot = await getTodayWikipediaData({ allowLiveFallback: true });
  if (!snapshot) {
    throw new Error("Today on Wikipedia snapshot is not available");
  }

  const articles = snapshot.trending
    .slice(0, MAX_ARTICLES_IN_PROMPT)
    .map((candidate) => ({
      title: candidate.title,
      extract: candidate.extract,
      views: candidate.views,
      imageUrl: candidate.thumbnail?.source,
    }));

  const artworkItems = selectTrendingArtworkItems(articles);

  return {
    trendingDateIso:
      snapshot.trendingDate?.replace(/Z$/, "") || snapshot.feedDate,
    sourceIsStale: snapshot.trendingIsStale || snapshot.snapshotIsStale,
    articles,
    artworkItems,
  };
};

const uploadBlobToConvexStorage = async (
  uploadUrl: string,
  blob: Blob,
): Promise<Id<"_storage">> => {
  const result = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type || "audio/mpeg" },
    body: blob,
  });

  if (!result.ok) {
    throw new Error(`Convex storage upload failed: ${result.status}`);
  }

  const body = (await result.json()) as { storageId?: Id<"_storage"> };
  if (!body.storageId) {
    throw new Error("Convex storage upload did not return a storageId");
  }

  return body.storageId;
};

export const isTrendingBriefEnabled = (): boolean =>
  isOpenAIConfigured();

const canReadTrendingBriefsFromConvex = (): boolean =>
  process.env.NEXT_PUBLIC_LOCAL_MODE !== "true" &&
  Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.trim());

const generateTrendingBriefRecord = async ({
  baseUrl,
  force = false,
  regenArt = false,
}: {
  baseUrl: string;
  force?: boolean;
  regenArt?: boolean;
}): Promise<TrendingBriefSyncResult> => {
  const { trendingDateIso, articles, artworkItems } =
    await getCurrentTrendingBriefSource();

  if (articles.length === 0) {
    throw new Error("No safe trending articles available for the daily brief");
  }

  const existing = (await fetchQuery(anyApi.trending.getTrendingBriefByDate, {
    trendingDate: trendingDateIso,
  })) as TrendingBriefRecord | null;
  const existingReadyBrief = shouldReuseExistingTrendingBrief(existing, {
    force,
    regenArt,
  })
    ? existing
    : null;
  const owner = randomUUID();
  const runId = owner.slice(0, 8);
  const imageUrls = artworkItems.map((item) => item.imageUrl);
  const articleTitles = articles.map((article) => article.title);
  let stage = "initializing";

  if (existingReadyBrief) {
    return {
      status: "already_exists",
      brief: existingReadyBrief,
      source: {
        trendingDate: trendingDateIso,
        articleTitles,
      },
      publication: {
        reusedExisting: true,
        repairedExisting: false,
        regeneratedArtwork: false,
      },
    };
  }

  if (!isTrendingBriefEnabled()) {
    throw new Error("AI trend briefing is not configured.");
  }

  const claim = await fetchMutation(anyApi.trending.claimTrendingBriefJob, {
    trendingDate: trendingDateIso,
    owner,
    leaseMs: JOB_LEASE_MS,
  });

  if (!claim.claimed) {
    const latest = (await fetchQuery(anyApi.trending.getTrendingBriefByDate, {
      trendingDate: trendingDateIso,
    })) as TrendingBriefRecord | null;

    if (shouldReuseExistingTrendingBrief(latest, { force, regenArt })) {
      return {
        status: "already_exists",
        brief: latest,
        source: {
          trendingDate: trendingDateIso,
          articleTitles,
        },
        publication: {
          reusedExisting: true,
          repairedExisting: false,
          regeneratedArtwork: false,
        },
      };
    }

    throw new Error(`Trending brief sync already running for ${trendingDateIso}`);
  }

  const model = getTrendingBriefModel();

  if (!existingReadyBrief) {
    await fetchMutation(anyApi.trending.saveTrendingBrief, {
      trendingDate: trendingDateIso,
      status: "pending",
      articleTitles,
      imageUrls,
      artworkItems,
    });
  }

  const cachedBriefContent = getCachedTrendingBriefContent(existing);
  let committedReady = false;

  try {
    console.info(
      `[podcast:trending ${trendingDateIso} run=${runId}] start force=${force} regenArt=${regenArt} existingStatus=${existing?.status ?? "missing"} cachedBrief=${Boolean(cachedBriefContent)}`,
    );

    stage = cachedBriefContent ? "reusing_cached_brief" : "generating_brief_content";
    const brief = cachedBriefContent
      ? normalizeTrendingBrief(cachedBriefContent)
      : await generateTrendingBriefContent({
          client: getOpenAIClient(),
          model,
          trendingDate: trendingDateIso,
          articles,
        });

    const canReuseStoredAssets = Boolean(
      !regenArt &&
      existing?.storageId &&
        existing?.artworkStorageId &&
        existing?.durationSeconds != null &&
        existing?.byteLength != null &&
        existing?.ttsCacheKey === getTrendingAudioCacheKey(),
    );
    const canReuseExistingAudioForArtwork = Boolean(
      regenArt &&
        existing?.audioUrl &&
        existing.ttsCacheKey === getTrendingAudioCacheKey(),
    );

    const assetState = canReuseStoredAssets
      ? {
          storageId: existing?.storageId as Id<"_storage">,
          artworkStorageId: existing?.artworkStorageId as Id<"_storage">,
          durationSeconds: existing?.durationSeconds as number,
          byteLength: existing?.byteLength as number,
          metadata: getTtsMetadata(getActiveTtsProfile()),
        }
      : await (async () => {
          stage = "rendering_artwork";
          const artwork = await renderTrendingPodcastArtworkPng({
            trendingDate: trendingDateIso,
            headline: brief.headline,
            artworkItems,
            articleTitles,
            imageUrls,
          });
          stage = canReuseExistingAudioForArtwork
            ? "reusing_existing_audio"
            : "generating_tts_audio";
          const audioScript = getTrendingAudioScript(brief.spokenSummary);
          let ttsMetadata: TtsMetadata | null = null;
          const existingAudioUrl =
            canReuseExistingAudioForArtwork && existing?.audioUrl
              ? existing.audioUrl
              : null;
          const sourceAudioBlob = existingAudioUrl
            ? await fetchBlobFromUrl(existingAudioUrl)
            : await (async () => {
                const generatedAudio = await generateTtsAudioWithMetadata(
                  { text: audioScript },
                  { apiBaseUrl: baseUrl, headers: getTtsQuotaBypassHeaders() },
                );
                ttsMetadata = generatedAudio.metadata;
                return generatedAudio.blob;
              })();
          const metadata = {
            ...(ttsMetadata ?? getTtsMetadata(getActiveTtsProfile())),
            ttsCacheKey: getTrendingAudioCacheKey(),
          };
          const artworkBlob = new Blob([Buffer.from(artwork.data)], {
            type: artwork.mimeType,
          });
          stage = "tagging_audio";
          const taggedAudioBlob = await addMp3MetadataToBlob(sourceAudioBlob, {
            title: brief.headline || `Wikipedia Trending Brief: ${trendingDateIso}`,
            artist: "Curio Garden",
            album: TRENDING_PODCAST_TITLE,
            artwork,
          });
          stage = "requesting_upload_urls";
          const [audioUploadUrl, artworkUploadUrl] = await Promise.all([
            fetchMutation(anyApi.trending.generateUploadUrl, {}),
            fetchMutation(anyApi.trending.generateUploadUrl, {}),
          ]);
          stage = "uploading_assets";
          const [newStorageId, newArtworkStorageId] = await Promise.all([
            uploadBlobToConvexStorage(audioUploadUrl, taggedAudioBlob),
            uploadBlobToConvexStorage(artworkUploadUrl, artworkBlob),
          ]);

          return {
            storageId: newStorageId,
            artworkStorageId: newArtworkStorageId,
            durationSeconds: estimateDurationSeconds(audioScript),
            byteLength: taggedAudioBlob.size,
            metadata,
          };
        })();

    stage = "saving_brief";
    await fetchMutation(anyApi.trending.saveTrendingBrief, {
      trendingDate: trendingDateIso,
      status: "ready",
      headline: brief.headline,
      summary: brief.summary,
      podcastDescription: brief.podcastDescription,
      spokenSummary: brief.spokenSummary,
      keyPoints: brief.keyPoints,
      articleTitles,
      imageUrls,
      artworkItems,
      sources: brief.sources,
      storageId: assetState.storageId,
      artworkStorageId: assetState.artworkStorageId,
      artworkVersion: TRENDING_EPISODE_ARTWORK_VERSION,
      durationSeconds: assetState.durationSeconds,
      byteLength: assetState.byteLength,
      model,
      ttsModel: assetState.metadata.model,
      ttsCacheKey: assetState.metadata.ttsCacheKey,
      provider: assetState.metadata.provider,
      voiceId: assetState.metadata.voiceId,
      promptVersion: assetState.metadata.promptVersion,
      ttsNormVersion: assetState.metadata.ttsNormVersion,
    });
    committedReady = true;

    stage = "reloading_saved_brief";
    const saved = (await fetchQuery(anyApi.trending.getTrendingBriefByDate, {
      trendingDate: trendingDateIso,
    })) as TrendingBriefRecord | null;

    if (!saved || saved.status !== "ready" || !saved.audioUrl) {
      throw new Error("Trending brief was saved but could not be reloaded");
    }

    stage = "finalizing_job";
    await fetchMutation(anyApi.trending.finalizeTrendingBriefJob, {
      trendingDate: trendingDateIso,
      owner,
      status: "ready",
    });

    console.info(
      `[podcast:trending ${trendingDateIso} run=${runId}] success reusedAssets=${canReuseStoredAssets} sources=${brief.sources.length}`,
    );

    return {
      status: "created",
      brief: saved,
      source: {
        trendingDate: trendingDateIso,
        articleTitles,
      },
      publication: {
        reusedExisting: false,
        repairedExisting: false,
        regeneratedArtwork: regenArt,
      },
    };
  } catch (error) {
    const message = getErrorMessage(error);
    const detailedMessage = `[${stage}] ${message}`;

    console.error(
      `[podcast:trending ${trendingDateIso} run=${runId}] failed at stage=${stage}: ${message}`,
      error,
    );

    await fetchMutation(anyApi.trending.finalizeTrendingBriefJob, {
      trendingDate: trendingDateIso,
      owner,
      status: "failed",
      lastError: detailedMessage,
    });

    if (!existingReadyBrief && !committedReady) {
      await fetchMutation(anyApi.trending.saveTrendingBrief, {
        trendingDate: trendingDateIso,
        status: "failed",
        headline: cachedBriefContent?.headline,
        summary: cachedBriefContent?.summary,
        podcastDescription: cachedBriefContent?.podcastDescription,
        spokenSummary: cachedBriefContent?.spokenSummary,
        keyPoints: cachedBriefContent?.keyPoints,
        articleTitles,
        imageUrls,
        artworkItems,
        sources: cachedBriefContent?.sources,
        lastError: detailedMessage,
      });
    }
    throw new Error(detailedMessage);
  }
};

export const syncDailyTrendingBrief = async ({
  baseUrl,
  force = false,
  regenArt = false,
}: {
  baseUrl: string;
  force?: boolean;
  regenArt?: boolean;
}): Promise<TrendingBriefSyncResult> => {
  const { trendingDateIso, articles } = await getCurrentTrendingBriefSource();

  if (articles.length === 0) {
    throw new Error("No safe trending articles available for the daily brief");
  }

  const existing = (await fetchQuery(anyApi.trending.getTrendingBriefByDate, {
    trendingDate: trendingDateIso,
  })) as TrendingBriefRecord | null;
  const existingReadyBrief = shouldReuseExistingTrendingBrief(existing, {
    force,
    regenArt,
  })
    ? existing
    : null;

  if (existingReadyBrief) {
    return {
      status: "already_exists",
      brief: existingReadyBrief,
      source: {
        trendingDate: trendingDateIso,
        articleTitles: articles.map((article) => article.title),
      },
      publication: {
        reusedExisting: true,
        repairedExisting: false,
        regeneratedArtwork: false,
      },
    };
  }

  const inFlight = inFlightTrendingBriefs.get(trendingDateIso);
  if (inFlight) {
    return inFlight;
  }
  const generationPromise = generateTrendingBriefRecord({
    baseUrl,
    force,
    regenArt,
  }).finally(() => {
    inFlightTrendingBriefs.delete(trendingDateIso);
  });

  inFlightTrendingBriefs.set(trendingDateIso, generationPromise);
  return generationPromise;
};

export const getDailyTrendingBriefState = async (): Promise<DailyTrendingBriefState> => {
  const { trendingDateIso, sourceIsStale, articles } =
    await getCurrentTrendingBriefSource();

  if (!isTrendingBriefEnabled() || !canReadTrendingBriefsFromConvex()) {
    return {
      enabled: false,
      status: "disabled",
      trendingDate: trendingDateIso,
      sourceIsStale,
      articleTitles: articles.map((article) => article.title),
      brief: null,
    };
  }

  const brief = (await fetchQuery(anyApi.trending.getTrendingBriefByDate, {
    trendingDate: trendingDateIso,
  })) as TrendingBriefRecord | null;

  if (brief?.status === "ready" && brief.audioUrl) {
    return {
      enabled: true,
      status: "ready",
      trendingDate: trendingDateIso,
      sourceIsStale,
      articleTitles: articles.map((article) => article.title),
      brief,
    };
  }

  return {
    enabled: true,
    status: brief?.status ?? "missing",
    trendingDate: trendingDateIso,
    sourceIsStale,
    articleTitles: articles.map((article) => article.title),
    brief: null,
    lastError: brief?.lastError,
  };
};
