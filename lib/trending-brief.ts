import { randomUUID } from "node:crypto";
import type { GatewayLanguageModelOptions } from "@ai-sdk/gateway";
import { gateway, generateText, stepCountIs } from "ai";
import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import type { Id } from "@/convex/_generated/dataModel";
import { addMp3MetadataToBlob } from "@/lib/audio-metadata";
import { fetchWikipediaFeaturedSnapshot } from "@/lib/featured-article";
import { filterSafeTitles } from "@/lib/nsfw-filter";
import { TRENDING_PODCAST_TITLE } from "@/lib/podcast-feed";
import { generateTtsAudio } from "@/lib/tts-client";
import {
  TRENDING_EPISODE_ARTWORK_VERSION,
  renderTrendingPodcastArtworkPng,
  type TrendingArtworkItem,
} from "@/lib/trending-podcast-artwork";

const TTS_WORDS_PER_SECOND = 2.5;
const DEFAULT_TRENDING_BRIEF_MODEL = "anthropic/claude-opus-4.5";
const DEFAULT_TRENDING_BRIEF_FALLBACK_MODEL = "openai/gpt-5.2";
const MAX_ARTICLES_IN_PROMPT = 10;
const MAX_KEY_POINTS = 5;
const MAX_SOURCES = 6;
const JOB_LEASE_MS = 8 * 60 * 1000;
const inFlightTrendingBriefs = new Map<string, Promise<TrendingBriefSyncResult>>();

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

const dedupeSources = (sources: TrendingBriefSource[]): TrendingBriefSource[] => {
  const seen = new Set<string>();
  const result: TrendingBriefSource[] = [];

  for (const source of sources) {
    const title = sanitizeText(source.title);
    const url = sanitizeText(source.url);
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    result.push({ title, url });
    if (result.length >= MAX_SOURCES) break;
  }

  return result;
};

export const parseGeneratedTrendingBrief = (
  rawText: string,
): GeneratedTrendingBrief => {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Trending brief model returned empty text");
  }

  const jsonMatch = trimmed.match(/```json\s*([\s\S]*?)```/i);
  const candidate = (jsonMatch?.[1] ?? trimmed).trim();

  const parsed = JSON.parse(candidate) as Partial<GeneratedTrendingBrief>;

  if (
    typeof parsed.headline !== "string" ||
    typeof parsed.summary !== "string" ||
    typeof parsed.podcastDescription !== "string" ||
    typeof parsed.spokenSummary !== "string" ||
    !Array.isArray(parsed.keyPoints) ||
    !Array.isArray(parsed.sources)
  ) {
    throw new Error("Trending brief model output was not valid JSON");
  }

  return {
    headline: parsed.headline,
    summary: parsed.summary,
    podcastDescription: parsed.podcastDescription,
    spokenSummary: parsed.spokenSummary,
    keyPoints: parsed.keyPoints.filter(
      (item): item is string => typeof item === "string",
    ),
    sources: parsed.sources.filter(
      (item): item is TrendingBriefSource =>
        Boolean(
          item &&
            typeof item === "object" &&
            typeof item.title === "string" &&
            typeof item.url === "string",
        ),
    ),
  };
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
    "You must use the news/web search tool before writing the briefing.",
    "Base the explanation on recent reporting when possible. If the reason is uncertain, say that clearly.",
    "Do not claim that something is trending for a specific reason unless the search results support it.",
    "Return only valid JSON. Do not wrap it in markdown unless necessary.",
    'Use this exact shape: {"headline":"...","summary":"...","podcastDescription":"...","spokenSummary":"...","keyPoints":["..."],"sources":[{"title":"...","url":"..."}]}.',
    "For podcastDescription, write a compact 1-2 sentence episode description suitable for a podcast app listing. Keep it shorter than summary.",
    "For spokenSummary, write natural audio-ready prose with no markdown, no bullets, and no URLs.",
    "For summary, keep it readable on-screen in 1-2 short paragraphs.",
    "For keyPoints, provide 3-5 short bullets explaining the most likely drivers across the list.",
    "For sources, include 3-6 reputable source links you actually relied on.",
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
    "Return a short plain-text research note summarizing the strongest explanations you found. Include source names and URLs in the note.",
  ].join("\n");
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
  const snapshot = await fetchWikipediaFeaturedSnapshot();
  const candidateTitles = snapshot.trendingCandidates.map((candidate) => candidate.title);
  const safeTitles = await filterSafeTitles(candidateTitles);
  const filteredArticles = snapshot.trendingCandidates.filter((candidate) =>
    safeTitles.has(candidate.title),
  );
  const articles = (filteredArticles.length > 0
    ? filteredArticles
    : snapshot.trendingCandidates)
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
      snapshot.trendingDate?.replace(/Z$/, "") || snapshot.feedDateIso,
    sourceIsStale: snapshot.trendingIsStale,
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
  Boolean(process.env.AI_GATEWAY_API_KEY);

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

  const model =
    process.env.TRENDING_BRIEF_MODEL || DEFAULT_TRENDING_BRIEF_MODEL;
  const fallbackModel =
    process.env.TRENDING_BRIEF_FALLBACK_MODEL ||
    DEFAULT_TRENDING_BRIEF_FALLBACK_MODEL;

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

  try {
    console.info(
      `[podcast:trending ${trendingDateIso} run=${runId}] start force=${force} regenArt=${regenArt} existingStatus=${existing?.status ?? "missing"} cachedBrief=${Boolean(cachedBriefContent)}`,
    );

    stage = cachedBriefContent ? "reusing_cached_brief" : "generating_brief_content";
    const brief = cachedBriefContent
      ? normalizeTrendingBrief(cachedBriefContent)
      : await (async (): Promise<GeneratedTrendingBrief> => {
          const researchResult = await generateText({
            model,
            system:
              "You are a careful editorial researcher for an accessibility-first Wikipedia listening app. Use web search to gather recent reporting about why topics are trending.",
            prompt: buildTrendingResearchPrompt({
              trendingDate: trendingDateIso,
              articles,
            }),
            maxOutputTokens: 1200,
            stopWhen: stepCountIs(3),
            toolChoice: "required",
            tools: {
              news_search: gateway.tools.perplexitySearch({
                searchRecencyFilter: "week",
                searchLanguageFilter: ["en"],
                maxResults: 8,
                maxTokensPerPage: 1024,
              }),
            },
            providerOptions: {
              gateway: {
                models: [fallbackModel],
                user: "public-trending-brief",
                tags: ["trending-brief", "daily-audio"],
              } satisfies GatewayLanguageModelOptions,
            },
          });

          if (researchResult.toolResults.length === 0) {
            throw new Error("Trending brief research did not return any search results");
          }

          const researchContext = [
            researchResult.text.trim(),
            ...researchResult.toolResults.map((toolResult) =>
              JSON.stringify(toolResult.output),
            ),
          ]
            .filter(Boolean)
            .join("\n\n");

          const writingResult = await generateText({
            model,
            system:
              "You are a careful editorial analyst for an accessibility-first Wikipedia listening app. Explain why topics are trending using recent reporting, not speculation. Return only valid JSON.",
            prompt: [
              buildTrendingBriefPrompt({
                trendingDate: trendingDateIso,
                articles,
              }),
              "",
              "Research context from recent news search:",
              researchContext,
            ].join("\n"),
            maxOutputTokens: 1400,
            providerOptions: {
              gateway: {
                models: [fallbackModel],
                user: "public-trending-brief",
                tags: ["trending-brief", "daily-audio"],
              } satisfies GatewayLanguageModelOptions,
            },
          });

          if (!writingResult.text.trim()) {
            throw new Error("Trending brief writing pass returned empty text");
          }

          return normalizeTrendingBrief(
            parseGeneratedTrendingBrief(writingResult.text),
          );
        })();

    const canReuseStoredAssets = Boolean(
      !regenArt &&
      existing?.storageId &&
        existing?.artworkStorageId &&
        existing?.durationSeconds != null &&
        existing?.byteLength != null,
    );

    const assetState = canReuseStoredAssets
      ? {
          storageId: existing?.storageId as Id<"_storage">,
          artworkStorageId: existing?.artworkStorageId as Id<"_storage">,
          durationSeconds: existing?.durationSeconds as number,
          byteLength: existing?.byteLength as number,
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
          stage = regenArt && existing?.audioUrl
            ? "reusing_existing_audio"
            : "generating_tts_audio";
          const sourceAudioBlob =
            regenArt && existing?.audioUrl
              ? await fetchBlobFromUrl(existing.audioUrl)
              : await generateTtsAudio(
                  { text: brief.spokenSummary },
                  { apiBaseUrl: baseUrl },
                );
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
            durationSeconds: estimateDurationSeconds(brief.spokenSummary),
            byteLength: taggedAudioBlob.size,
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
    });

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

    if (!existingReadyBrief) {
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
  const brief = (await fetchQuery(anyApi.trending.getTrendingBriefByDate, {
    trendingDate: trendingDateIso,
  })) as TrendingBriefRecord | null;

  if (!isTrendingBriefEnabled()) {
    return {
      enabled: false,
      status: "disabled",
      trendingDate: trendingDateIso,
      sourceIsStale,
      articleTitles: articles.map((article) => article.title),
      brief: null,
    };
  }

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
