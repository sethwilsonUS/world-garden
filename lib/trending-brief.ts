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
import {
  createAiCostOperationContext,
  getOpenAIClient,
  isOpenAIConfigured,
  recordAiCostOperationSupplement,
  runWithAiCostOperationContext,
} from "@/lib/openai-client";
import { generateTtsAudioWithMetadata } from "@/lib/tts-client";
import { getTrustedTtsGenerationHeaders } from "@/lib/tts-quota-bypass";
import type { TtsMetadata } from "@/lib/tts-profile";
import {
  TRENDING_EPISODE_ARTWORK_VERSION,
  renderTrendingPodcastArtworkPng,
  type TrendingArtworkItem,
} from "@/lib/trending-podcast-artwork";
import {
  createPublicAudioWriteAttestation,
  type PublicAudioWriteOperation,
} from "@/lib/public-audio-write-attestation";
import {
  getTrendingAudioCacheKey,
  getTrendingTtsMetadata,
  getTrendingTtsProfile,
  isExactCurrentTrendingAudioMetadata,
} from "@/lib/trending-audio-profile";
import {
  createAudioCacheLedgerAssetKey,
  recordAudioCacheWriteFailureBestEffort,
} from "@/lib/audio-cache-ledger";

export { getTrendingAudioCacheKey } from "@/lib/trending-audio-profile";

const TTS_WORDS_PER_SECOND = 2.5;
const DEFAULT_TRENDING_BRIEF_MODEL = "gpt-5.6-luna";
const MAX_ARTICLES_IN_PROMPT = 10;
const MAX_KEY_POINTS = 5;
const MAX_CONTROL_SOURCES = 6;
const MAX_SOURCES = 15;
const MIN_SPOKEN_WORDS = 300;
const MAX_SPOKEN_WORDS = 420;
const JOB_LEASE_MS = 15 * 60 * 1000;
// This leaves four minutes of lease time and over two minutes of route time for
// artwork, speech synthesis, uploads, and finalization after the text workflow.
export const TRENDING_BRIEF_GENERATION_DEADLINE_MS = 11 * 60 * 1000;
export const TRENDING_BRIEF_OPENAI_REQUEST_TIMEOUT_MS = 2 * 60 * 1000;
const TRENDING_BRIEF_OPENAI_MAX_RETRIES = 0;
const inFlightTrendingBriefs = new Map<
  string,
  Promise<TrendingBriefSyncResult>
>();

type TrendingWriteOperation = Extract<
  PublicAudioWriteOperation,
  "claim-job" | "finalize-job" | "generate-upload-url" | "save-record"
>;

const withTrendingWriteAttestation = async <
  TArgs extends Record<string, unknown>,
>(
  operation: TrendingWriteOperation,
  args: TArgs,
): Promise<
  TArgs & {
    attestation: Awaited<ReturnType<typeof createPublicAudioWriteAttestation>>;
  }
> => ({
  ...args,
  attestation: await createPublicAudioWriteAttestation({
    pipeline: "trending",
    operation,
    args,
  }),
});

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

export type TrendingBriefGenerationProfile =
  | "control"
  | "depth-writing"
  | "deep-research";

const DEFAULT_TRENDING_BRIEF_PROFILE: TrendingBriefGenerationProfile =
  "deep-research";
const TRENDING_BRIEF_PROMPT_VERSIONS: Record<
  TrendingBriefGenerationProfile,
  string
> = {
  control: "trending-brief-control-v1",
  "depth-writing": "trending-brief-depth-writing-v1",
  "deep-research": "trending-brief-deep-research-v1",
};

export const getTrendingBriefGenerationProfile =
  (): TrendingBriefGenerationProfile => DEFAULT_TRENDING_BRIEF_PROFILE;

export const getTrendingBriefPromptVersion = (
  profile = getTrendingBriefGenerationProfile(),
): string => TRENDING_BRIEF_PROMPT_VERSIONS[profile];

export type TrendingArticle = {
  title: string;
  extract: string;
  views: number;
  imageUrl?: string;
};

export type TrendingBriefSource = {
  title: string;
  url: string;
};

export type GeneratedTrendingBrief = {
  headline: string;
  summary: string;
  podcastDescription: string;
  spokenSummary: string;
  keyPoints: string[];
  sources: TrendingBriefSource[];
};

export type TrendingBriefDraft = GeneratedTrendingBrief & {
  model: string;
  briefPromptVersion: string;
};

export type TrendingBriefResearchDraft = {
  text: string;
  sources: TrendingBriefSource[];
  model: string;
  briefPromptVersion: string;
  articleTitles: string[];
};

const TrimmedNonEmptyTextSchema = z.string().trim().min(1);

const TrendingBriefOutputSchema = z.object({
  headline: TrimmedNonEmptyTextSchema,
  summary: TrimmedNonEmptyTextSchema,
  podcastDescription: TrimmedNonEmptyTextSchema,
  spokenSummary: TrimmedNonEmptyTextSchema,
  keyPoints: z.array(TrimmedNonEmptyTextSchema).min(3).max(MAX_KEY_POINTS),
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
  briefPromptVersion?: string;
  draftBrief?: TrendingBriefDraft;
  draftResearch?: TrendingBriefResearchDraft;
  ttsModel?: string;
  ttsCacheKey?: string;
  provider?: string;
  voiceId?: string;
  promptVersion?: string;
  ttsNormVersion?: string;
  lastError?: string;
  updatedAt: number;
};

type ReusableTrendingBriefRecord = TrendingBriefRecord & {
  status: "ready";
  audioUrl: string;
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
  identity?: { model: string; briefPromptVersion: string },
): GeneratedTrendingBrief | null => {
  if (
    !record ||
    (identity != null &&
      (record.model !== identity.model ||
        record.briefPromptVersion !== identity.briefPromptVersion)) ||
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

const getCachedTrendingBriefDraftContent = (
  record: TrendingBriefRecord | null,
  identity: { model: string; briefPromptVersion: string },
): GeneratedTrendingBrief | null => {
  const draft = record?.draftBrief;
  if (
    !draft ||
    draft.model !== identity.model ||
    draft.briefPromptVersion !== identity.briefPromptVersion ||
    !isNonEmptyString(draft.headline) ||
    !isNonEmptyString(draft.summary) ||
    !isNonEmptyString(draft.podcastDescription) ||
    !isNonEmptyString(draft.spokenSummary) ||
    !Array.isArray(draft.keyPoints) ||
    !Array.isArray(draft.sources)
  ) {
    return null;
  }

  return {
    headline: draft.headline,
    summary: draft.summary,
    podcastDescription: draft.podcastDescription,
    spokenSummary: draft.spokenSummary,
    keyPoints: draft.keyPoints,
    sources: draft.sources,
  };
};

const getCachedTrendingBriefResearch = (
  record: TrendingBriefRecord | null,
  identity: {
    model: string;
    briefPromptVersion: string;
    articleTitles: string[];
  },
): ResearchPassResult | null => {
  const draft = record?.draftResearch;
  if (
    !draft ||
    draft.model !== identity.model ||
    draft.briefPromptVersion !== identity.briefPromptVersion ||
    draft.articleTitles.length !== identity.articleTitles.length ||
    !draft.articleTitles.every(
      (title, index) => title === identity.articleTitles[index],
    ) ||
    !isNonEmptyString(draft.text) ||
    !Array.isArray(draft.sources) ||
    draft.sources.length === 0
  ) {
    return null;
  }

  return { text: draft.text, sources: draft.sources };
};

export const hasCurrentTrendingArtworkVersion = (
  record: Pick<TrendingBriefRecord, "artworkVersion"> | null,
): boolean => record?.artworkVersion === TRENDING_EPISODE_ARTWORK_VERSION;

export const shouldReuseExistingTrendingBrief = (
  record: TrendingBriefRecord | null,
  options?: {
    force?: boolean;
    regenArt?: boolean;
    model?: string;
    briefPromptVersion?: string;
  },
): record is ReusableTrendingBriefRecord =>
  Boolean(
    record?.status === "ready" &&
    record.audioUrl &&
    record.model === (options?.model ?? getTrendingBriefModel()) &&
    record.briefPromptVersion ===
      (options?.briefPromptVersion ?? getTrendingBriefPromptVersion()) &&
    isExactCurrentTrendingAudioMetadata(
      {
        provider: record.provider,
        model: record.ttsModel,
        voiceId: record.voiceId,
        promptVersion: record.promptVersion,
        ttsNormVersion: record.ttsNormVersion,
        ttsCacheKey: record.ttsCacheKey,
      },
      getTrendingAudioCacheKey(),
    ) &&
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

const sanitizeText = (text: string): string =>
  text.replace(/\r\n/g, "\n").trim();

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const stripUrlsFromSpeech = (text: string): string =>
  text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

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

const SOURCE_TRACKING_QUERY_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
  "sfmc_id",
  "skey_id",
]);

const getSourceDedupeKey = (url: string): string => {
  const parsed = new URL(url);
  parsed.hash = "";
  for (const parameter of [...parsed.searchParams.keys()]) {
    const normalizedParameter = parameter.toLowerCase();
    if (
      /^utm_/i.test(parameter) ||
      SOURCE_TRACKING_QUERY_PARAMETERS.has(normalizedParameter)
    ) {
      parsed.searchParams.delete(parameter);
    }
  }
  parsed.searchParams.sort();
  return parsed.toString();
};

const dedupeSources = (
  sources: readonly TrendingBriefSource[],
  maxSources = MAX_SOURCES,
): TrendingBriefSource[] => {
  if (maxSources <= 0) return [];

  const seen = new Set<string>();
  const result: TrendingBriefSource[] = [];

  for (const source of sources) {
    const title = sanitizeText(source.title);
    const url = normalizeHttpUrl(source.url);
    if (!title || !url) continue;
    const dedupeKey = getSourceDedupeKey(url);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push({ title, url });
    if (result.length >= maxSources) break;
  }

  return result;
};

/**
 * Keeps the capped reader-facing list representative of every researched
 * topic. Flattening topic results before truncation can otherwise spend all
 * 15 slots on the first broad story.
 */
export const mergeTrendingBriefSourceGroups = (
  sourceGroups: readonly (readonly TrendingBriefSource[])[],
  maxSources = MAX_SOURCES,
): TrendingBriefSource[] => {
  const interleaved: TrendingBriefSource[] = [];
  const longestGroup = Math.max(
    0,
    ...sourceGroups.map((sources) => sources.length),
  );

  for (let sourceIndex = 0; sourceIndex < longestGroup; sourceIndex += 1) {
    for (const sources of sourceGroups) {
      const source = sources[sourceIndex];
      if (source) interleaved.push(source);
    }
  }

  return dedupeSources(interleaved, maxSources);
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
  maxSources = MAX_CONTROL_SOURCES,
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

  return dedupeSources([...citations, ...consultedSources], maxSources);
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
  profile = "control",
}: {
  trendingDate: string;
  articles: TrendingArticle[];
  profile?: TrendingBriefGenerationProfile;
}): string => {
  const includedArticles = articles.slice(0, MAX_ARTICLES_IN_PROMPT);
  const articleList = includedArticles
    .map(
      (article, index) =>
        `${index + 1}. ${article.title} (${article.views.toLocaleString()} views)\n   Wikipedia extract: ${article.extract || "No extract available."}`,
    )
    .join("\n");

  const sharedInstructions = [
    `Today's Wikipedia trending date is ${trendingDate}.`,
    "You are preparing a daily Curio Garden trend briefing about why these English Wikipedia articles are trending.",
    "Use only the supplied web research and Wikipedia context. If the reason is uncertain, say that clearly.",
    "Do not claim that something is trending for a specific reason unless the research supports it.",
    "The response schema is enforced separately; write complete content for every requested field.",
    "For podcastDescription, write a compact 1-2 sentence episode description suitable for a podcast app listing. Keep it shorter than summary.",
  ];
  const writingInstructions =
    profile === "control"
      ? [
          "For spokenSummary, write natural audio-ready prose with no markdown, no bullets, and no URLs.",
          "For summary, keep it readable on-screen in 1-2 short paragraphs.",
          "For keyPoints, provide 3-5 short bullets explaining the most likely drivers across the list.",
        ]
      : [
          "For spokenSummary, write 300-420 words of natural audio-ready prose with no markdown, no bullets, and no URLs.",
          `Account for all ${includedArticles.length} topics. Give the strongest, best-supported stories the most time, but mention quieter or unexplained topics accurately instead of dropping them.`,
          "For each leading topic, explain the supported trigger, relevant background or timeline, and why now readers are seeking it out.",
          "Use natural transitions so the briefing sounds like one thoughtful podcast rather than ten disconnected blurbs.",
          "When evidence does not establish a driver, state that the cause is uncertain and separate known context from any plausible but unconfirmed explanation.",
          "For summary, keep it readable on-screen in 1-2 concise paragraphs while preserving the main supported drivers and caveats.",
          "For keyPoints, provide 3-5 short bullets that preserve the most important supported drivers and uncertainties across the list.",
        ];

  return [
    ...sharedInstructions,
    ...writingInstructions,
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

const buildTrendingTopicResearchPrompt = ({
  trendingDate,
  article,
}: {
  trendingDate: string;
  article: TrendingArticle;
}): string =>
  [
    `The Wikipedia trending date is ${trendingDate}.`,
    `Investigate why the English Wikipedia article "${article.title}" is receiving attention now.`,
    `Wikipedia context: ${article.extract || "No extract available."}`,
    `Recorded views: ${article.views.toLocaleString()}.`,
    "Use web search for recent, reputable reporting and distinguish evidence from inference.",
    "Return a compact plain-text research note with these labelled sections:",
    "Trigger: the supported event or coverage driver, or explicitly uncertain.",
    "Timeline: the relevant dates and sequence of events.",
    "Background: only the context needed to understand the trigger.",
    "Confidence: high, medium, or low, with a brief reason.",
    "Uncertainty: what the sources do not establish and any plausible explanation that must not be stated as fact.",
    "Use inline citations. Do not guess from the article title or view count.",
  ].join("\n");

type TrendingOpenAIClient = Pick<OpenAI, "responses">;

type TrendingResponseUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type TrendingBriefGenerationEvent =
  | {
      type: "research";
      profile: TrendingBriefGenerationProfile;
      topicIndex: number | null;
      topicTitle: string | null;
      researchText: string;
      sources: TrendingBriefSource[];
      webSearchCalls: number;
      latencyMs: number;
      model: string;
      usage: TrendingResponseUsage;
      /** Full provider response retained only by opt-in evaluation observers. */
      rawResponse?: unknown;
    }
  | {
      type: "writing";
      profile: TrendingBriefGenerationProfile;
      attempt: "initial" | "repair";
      brief: GeneratedTrendingBrief;
      latencyMs: number;
      model: string;
      usage: TrendingResponseUsage;
      /** Full provider response retained only by opt-in evaluation observers. */
      rawResponse?: unknown;
    };

export type ResearchPassResult = {
  text: string;
  sources: TrendingBriefSource[];
};

type TrendingGenerationRuntime = {
  signal: AbortSignal;
  abort: (reason: unknown) => void;
  getRequestTimeoutMs: () => number;
};

const getAbortReason = (signal: AbortSignal): Error => {
  if (signal.reason instanceof Error) return signal.reason;
  return new Error("Trending brief generation was cancelled");
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw getAbortReason(signal);
};

const createTrendingGenerationRuntime = (
  deadlineMs: number,
): {
  runtime: TrendingGenerationRuntime;
  dispose: () => void;
} => {
  const controller = new AbortController();
  const startedAt = Date.now();
  const deadlineError = new Error(
    `Trending brief generation exceeded its ${deadlineMs}ms deadline`,
  );
  const deadlineTimer = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(deadlineError);
  }, deadlineMs);

  return {
    runtime: {
      signal: controller.signal,
      abort: (reason) => {
        if (!controller.signal.aborted) controller.abort(reason);
      },
      getRequestTimeoutMs: () => {
        throwIfAborted(controller.signal);
        const remainingMs = deadlineMs - (Date.now() - startedAt);
        if (remainingMs <= 0) {
          if (!controller.signal.aborted) controller.abort(deadlineError);
          throw deadlineError;
        }
        return Math.min(TRENDING_BRIEF_OPENAI_REQUEST_TIMEOUT_MS, remainingMs);
      },
    },
    dispose: () => clearTimeout(deadlineTimer),
  };
};

const getResponseUsage = (response: {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | null;
}): TrendingResponseUsage => ({
  inputTokens: response.usage?.input_tokens ?? 0,
  outputTokens: response.usage?.output_tokens ?? 0,
  totalTokens: response.usage?.total_tokens ?? 0,
});

const mapWithConcurrency = async <TInput, TOutput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<TOutput>,
  abort: (reason: unknown) => void,
  signal: AbortSignal,
): Promise<TOutput[]> => {
  const results = new Array<TOutput>(items.length);
  let nextIndex = 0;
  let firstFailure: unknown;

  const runWorker = async () => {
    while (!signal.aborted && firstFailure === undefined) {
      const index = nextIndex;
      if (index >= items.length) return;
      nextIndex += 1;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        if (firstFailure === undefined) firstFailure = error;
        abort(error);
        return;
      }
    }
  };

  const settled = await Promise.allSettled(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      runWorker,
    ),
  );
  if (firstFailure !== undefined) throw firstFailure;
  const rejectedWorker = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejectedWorker) throw rejectedWorker.reason;
  throwIfAborted(signal);
  return results;
};

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

const runTrendingResearchPass = async ({
  client,
  model,
  profile,
  prompt,
  topicIndex,
  topicTitle,
  runtime,
  onEvent,
}: {
  client: TrendingOpenAIClient;
  model: string;
  profile: TrendingBriefGenerationProfile;
  prompt: string;
  topicIndex: number | null;
  topicTitle: string | null;
  runtime: TrendingGenerationRuntime;
  onEvent?: (event: TrendingBriefGenerationEvent) => void;
}): Promise<ResearchPassResult> => {
  const researchContext = createAiCostOperationContext({
    operation: "trending_brief_research",
    source: "trending_brief",
    model,
  });
  const startedAt = Date.now();
  const deepResearch = profile === "deep-research";
  const researchResult = await runWithAiCostOperationContext(
    researchContext,
    () =>
      client.responses.create(
        {
          model,
          instructions:
            "You are a careful editorial researcher for an accessibility-first Wikipedia listening app. Use current, reputable reporting to investigate why topics are trending. Distinguish supported explanations from uncertainty.",
          input: prompt,
          tools: [
            {
              type: "web_search",
              search_context_size: deepResearch ? "high" : "medium",
            },
          ],
          tool_choice: "required",
          include: ["web_search_call.action.sources"],
          reasoning: { effort: "medium" },
          max_output_tokens: 4_000,
          metadata: {
            workflow: "trending-brief",
            stage: deepResearch ? "research-topic" : "research",
          },
          safety_identifier: "public-trending-brief",
          store: false,
        },
        {
          signal: runtime.signal,
          timeout: runtime.getRequestTimeoutMs(),
          maxRetries: TRENDING_BRIEF_OPENAI_MAX_RETRIES,
        },
      ),
  );

  const webSearchCalls = researchResult.output.filter(
    (item) => item.type === "web_search_call",
  ).length;
  recordAiCostOperationSupplement({
    context: researchContext,
    webSearchCalls,
  });
  logOpenAIUsage({
    stage: "research",
    response: researchResult,
    webSearchCalls,
  });

  if (webSearchCalls === 0) {
    throw new Error(
      topicTitle
        ? `Trending brief research did not perform a web search for ${topicTitle}`
        : "Trending brief research did not perform a web search",
    );
  }

  const researchText = researchResult.output_text.trim();
  if (!researchText) {
    throw new Error(
      topicTitle
        ? `Trending brief research returned empty text for ${topicTitle}`
        : "Trending brief research returned empty text",
    );
  }

  const sources = extractTrendingBriefSources(
    researchResult.output,
    deepResearch ? MAX_SOURCES : MAX_CONTROL_SOURCES,
  );
  if (sources.length === 0) {
    throw new Error(
      topicTitle
        ? `Trending brief research did not return cited web sources for ${topicTitle}`
        : "Trending brief research did not return cited web sources",
    );
  }

  onEvent?.({
    type: "research",
    profile,
    topicIndex,
    topicTitle,
    researchText,
    sources,
    webSearchCalls,
    latencyMs: Date.now() - startedAt,
    model: researchResult.model ?? model,
    usage: getResponseUsage(researchResult),
    rawResponse: researchResult,
  });

  return { text: researchText, sources };
};

export const countTrendingSpokenWords = (text: string): number =>
  text.trim().split(/\s+/u).filter(Boolean).length;

const runTrendingWritingPass = async ({
  client,
  model,
  profile,
  attempt,
  input,
  sources,
  runtime,
  onEvent,
}: {
  client: TrendingOpenAIClient;
  model: string;
  profile: TrendingBriefGenerationProfile;
  attempt: "initial" | "repair";
  input: string;
  sources: TrendingBriefSource[];
  runtime: TrendingGenerationRuntime;
  onEvent?: (event: TrendingBriefGenerationEvent) => void;
}): Promise<GeneratedTrendingBrief> => {
  const startedAt = Date.now();
  const writingResult = await runWithAiCostOperationContext(
    createAiCostOperationContext({
      operation: "trending_brief_writing",
      source: "trending_brief",
      model,
    }),
    () =>
      client.responses.parse(
        {
          model,
          instructions:
            attempt === "repair"
              ? "You are repairing a sourced podcast script that missed a strict spoken-word target. Preserve every supported fact and uncertainty label, never add a claim, and return the complete structured brief."
              : "You are a careful editorial analyst for an accessibility-first Wikipedia listening app. Explain why topics are trending using only the supplied research and article context, never speculation. Write clean prose for sighted and screen-reader audiences.",
          input,
          reasoning: { effort: "medium" },
          max_output_tokens: 4_000,
          text: {
            format: zodTextFormat(TrendingBriefOutputSchema, "trending_brief"),
            verbosity: profile === "control" ? "low" : "medium",
          },
          metadata: {
            workflow: "trending-brief",
            stage: attempt === "repair" ? "writing-repair" : "writing",
          },
          safety_identifier: "public-trending-brief",
          store: false,
        },
        {
          signal: runtime.signal,
          timeout: runtime.getRequestTimeoutMs(),
          maxRetries: TRENDING_BRIEF_OPENAI_MAX_RETRIES,
        },
      ),
  );

  logOpenAIUsage({ stage: "writing", response: writingResult });

  if (!writingResult.output_parsed) {
    throw new Error(
      attempt === "repair"
        ? "Trending brief writing repair returned no structured output"
        : "Trending brief writing pass returned no structured output",
    );
  }

  const normalized = normalizeTrendingBrief({
    ...writingResult.output_parsed,
    sources,
  });
  const validated = TrendingBriefOutputSchema.parse(normalized);
  const brief = { ...validated, sources: normalized.sources };
  onEvent?.({
    type: "writing",
    profile,
    attempt,
    brief,
    latencyMs: Date.now() - startedAt,
    model: writingResult.model ?? model,
    usage: getResponseUsage(writingResult),
    rawResponse: writingResult,
  });
  return brief;
};

type GenerateTrendingBriefContentOptions = {
  client: TrendingOpenAIClient;
  model: string;
  trendingDate: string;
  articles: TrendingArticle[];
  profile?: TrendingBriefGenerationProfile;
  onEvent?: (event: TrendingBriefGenerationEvent) => void;
  research?: ResearchPassResult;
  onWordBandRepairRequired?: (
    research: ResearchPassResult,
  ) => void | Promise<void>;
  /** An injectable deadline seam for tests and callers with tighter budgets. */
  deadlineMs?: number;
};

const generateTrendingBriefContentWithinDeadline = async ({
  client,
  model,
  trendingDate,
  articles,
  profile = "control",
  onEvent,
  research: cachedResearch,
  onWordBandRepairRequired,
  runtime,
}: {
  runtime: TrendingGenerationRuntime;
} & Omit<
  GenerateTrendingBriefContentOptions,
  "deadlineMs"
>): Promise<GeneratedTrendingBrief> => {
  const includedArticles = articles.slice(0, MAX_ARTICLES_IN_PROMPT);
  const research =
    cachedResearch ??
    (await (async (): Promise<ResearchPassResult> => {
      const researchPasses =
        profile === "deep-research"
          ? await mapWithConcurrency(
              includedArticles,
              4,
              async (article, topicIndex) =>
                await runTrendingResearchPass({
                  client,
                  model,
                  profile,
                  prompt: buildTrendingTopicResearchPrompt({
                    trendingDate,
                    article,
                  }),
                  topicIndex,
                  topicTitle: article.title,
                  runtime,
                  onEvent,
                }),
              runtime.abort,
              runtime.signal,
            )
          : [
              await runTrendingResearchPass({
                client,
                model,
                profile,
                prompt: buildTrendingResearchPrompt({
                  trendingDate,
                  articles: includedArticles,
                }),
                topicIndex: null,
                topicTitle: null,
                runtime,
                onEvent,
              }),
            ];
      return {
        text: researchPasses
          .map((pass, index) =>
            profile === "deep-research"
              ? `Topic ${index + 1}: ${includedArticles[index]?.title ?? "Unknown"}\n${pass.text}`
              : pass.text,
          )
          .join("\n\n"),
        sources: mergeTrendingBriefSourceGroups(
          researchPasses.map((pass) => pass.sources),
          profile === "deep-research" ? MAX_SOURCES : MAX_CONTROL_SOURCES,
        ),
      };
    })());
  const researchText = research.text;
  const sources = research.sources;

  const sharedWritingInput = [
    buildTrendingBriefPrompt({
      trendingDate,
      articles: includedArticles,
      profile,
    }),
    "",
    "Research context from OpenAI web search:",
    researchText,
    "",
    "Verified source list:",
    ...sources.map((source) => `- ${source.title}: ${source.url}`),
  ].join("\n");
  const initialBrief = await runTrendingWritingPass({
    client,
    model,
    profile,
    attempt: "initial",
    input: sharedWritingInput,
    sources,
    runtime,
    onEvent,
  });

  if (profile === "control") return initialBrief;

  const initialWordCount = countTrendingSpokenWords(initialBrief.spokenSummary);
  if (
    initialWordCount >= MIN_SPOKEN_WORDS &&
    initialWordCount <= MAX_SPOKEN_WORDS
  ) {
    return initialBrief;
  }

  if (onWordBandRepairRequired) {
    try {
      await onWordBandRepairRequired(research);
    } catch (error) {
      console.warn(
        "[podcast:trending] caching research before repair failed; continuing with the repair",
        error,
      );
    }
  }
  throwIfAborted(runtime.signal);

  const repairedBrief = await runTrendingWritingPass({
    client,
    model,
    profile,
    attempt: "repair",
    input: [
      sharedWritingInput,
      "",
      `The first structured brief is below. Its spokenSummary is ${initialWordCount} words, outside the required ${MIN_SPOKEN_WORDS}-${MAX_SPOKEN_WORDS} word band.`,
      "Rewrite spokenSummary into that band while preserving its supported facts, coverage of every topic, uncertainty labels, and natural spoken flow.",
      "Return every schema field. Preserve the other fields unless a small consistency edit is necessary.",
      JSON.stringify(initialBrief),
    ].join("\n"),
    sources,
    runtime,
    onEvent,
  });
  const repairedWordCount = countTrendingSpokenWords(
    repairedBrief.spokenSummary,
  );
  if (
    repairedWordCount < MIN_SPOKEN_WORDS ||
    repairedWordCount > MAX_SPOKEN_WORDS
  ) {
    throw new Error(
      `Trending brief spokenSummary remained outside ${MIN_SPOKEN_WORDS}-${MAX_SPOKEN_WORDS} words after one repair (first ${initialWordCount}, repaired ${repairedWordCount})`,
    );
  }
  return repairedBrief;
};

export const generateTrendingBriefContent = async ({
  deadlineMs,
  ...options
}: GenerateTrendingBriefContentOptions): Promise<GeneratedTrendingBrief> => {
  const requestedDeadlineMs =
    typeof deadlineMs === "number" && Number.isFinite(deadlineMs)
      ? deadlineMs
      : TRENDING_BRIEF_GENERATION_DEADLINE_MS;
  const boundedDeadlineMs = Math.max(
    1,
    Math.min(requestedDeadlineMs, TRENDING_BRIEF_GENERATION_DEADLINE_MS),
  );
  const deadline = createTrendingGenerationRuntime(boundedDeadlineMs);
  try {
    return await generateTrendingBriefContentWithinDeadline({
      ...options,
      runtime: deadline.runtime,
    });
  } finally {
    deadline.dispose();
  }
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

export const isTrendingBriefEnabled = (): boolean => isOpenAIConfigured();

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

  const model = getTrendingBriefModel();
  const profile = getTrendingBriefGenerationProfile();
  const briefPromptVersion = getTrendingBriefPromptVersion(profile);

  const existing = (await fetchQuery(anyApi.trending.getTrendingBriefByDate, {
    trendingDate: trendingDateIso,
  })) as TrendingBriefRecord | null;
  const existingContentMatchesCurrent = Boolean(
    existing?.model === model &&
    existing?.briefPromptVersion === briefPromptVersion,
  );
  const existingAudioMatchesCurrentTrending =
    isExactCurrentTrendingAudioMetadata(
      {
        provider: existing?.provider,
        model: existing?.ttsModel,
        voiceId: existing?.voiceId,
        promptVersion: existing?.promptVersion,
        ttsNormVersion: existing?.ttsNormVersion,
        ttsCacheKey: existing?.ttsCacheKey,
      },
      getTrendingAudioCacheKey(),
    );
  const existingReadyBrief = shouldReuseExistingTrendingBrief(existing, {
    force,
    regenArt,
  })
    ? existing
    : null;
  const previousReadyBrief =
    existing?.status === "ready" &&
    existing.audioUrl &&
    existingAudioMatchesCurrentTrending
      ? existing
      : null;
  const owner = randomUUID();
  const runId = owner.slice(0, 8);
  const imageUrls = artworkItems.map((item) => item.imageUrl);
  const articleTitles = articles.map((article) => article.title);
  let stage = "initializing";
  let generatedLedgerAssetKey: string | undefined;
  let generatedLedgerGeneratedAt: number | undefined;
  let generatedAudioReady = false;
  let generatedAudioProvider: TtsMetadata["provider"] | undefined;

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

  const claim = await fetchMutation(
    anyApi.trending.claimTrendingBriefJob,
    await withTrendingWriteAttestation("claim-job", {
      trendingDate: trendingDateIso,
      owner,
      leaseMs: JOB_LEASE_MS,
    }),
  );

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

    throw new Error(
      `Trending brief sync already running for ${trendingDateIso}`,
    );
  }

  const currentContentIdentity = { model, briefPromptVersion };
  const cachedBriefContent =
    getCachedTrendingBriefContent(existing, currentContentIdentity) ??
    getCachedTrendingBriefDraftContent(existing, currentContentIdentity);
  const cachedBriefResearch = getCachedTrendingBriefResearch(existing, {
    ...currentContentIdentity,
    articleTitles,
  });

  if (!previousReadyBrief) {
    await fetchMutation(
      anyApi.trending.saveTrendingBrief,
      await withTrendingWriteAttestation("save-record", {
        trendingDate: trendingDateIso,
        owner,
        status: "pending",
        headline: cachedBriefContent?.headline,
        summary: cachedBriefContent?.summary,
        podcastDescription: cachedBriefContent?.podcastDescription,
        spokenSummary: cachedBriefContent?.spokenSummary,
        keyPoints: cachedBriefContent?.keyPoints,
        articleTitles,
        imageUrls,
        artworkItems,
        sources: cachedBriefContent?.sources,
        model,
        briefPromptVersion,
      }),
    );
  }

  let briefContentForRetry = cachedBriefContent;
  let committedReady = false;

  try {
    console.info(
      `[podcast:trending ${trendingDateIso} run=${runId}] start force=${force} regenArt=${regenArt} existingStatus=${existing?.status ?? "missing"} cachedBrief=${Boolean(cachedBriefContent)} cachedResearch=${Boolean(cachedBriefResearch)}`,
    );

    stage = cachedBriefContent
      ? "reusing_cached_brief"
      : cachedBriefResearch
        ? "writing_cached_research"
        : "generating_brief_content";
    const brief = cachedBriefContent
      ? normalizeTrendingBrief(cachedBriefContent)
      : await generateTrendingBriefContent({
          client: getOpenAIClient(),
          model,
          trendingDate: trendingDateIso,
          articles,
          profile,
          research: cachedBriefResearch ?? undefined,
          onWordBandRepairRequired: async (research) => {
            stage = "caching_research_for_repair";
            try {
              await fetchMutation(
                anyApi.trending.saveTrendingBriefResearchDraft,
                await withTrendingWriteAttestation("save-record", {
                  trendingDate: trendingDateIso,
                  owner,
                  draftResearch: {
                    ...research,
                    model,
                    briefPromptVersion,
                    articleTitles,
                  },
                }),
              );
            } finally {
              stage = "repairing_brief_content";
            }
          },
        });
    briefContentForRetry = brief;

    if (!cachedBriefContent && !previousReadyBrief) {
      stage = "caching_generated_brief";
      await fetchMutation(
        anyApi.trending.saveTrendingBrief,
        await withTrendingWriteAttestation("save-record", {
          trendingDate: trendingDateIso,
          owner,
          status: "pending",
          headline: brief.headline,
          summary: brief.summary,
          podcastDescription: brief.podcastDescription,
          spokenSummary: brief.spokenSummary,
          keyPoints: brief.keyPoints,
          articleTitles,
          imageUrls,
          artworkItems,
          sources: brief.sources,
          model,
          briefPromptVersion,
        }),
      );
    }
    if (!cachedBriefContent && previousReadyBrief) {
      stage = "caching_generated_brief_draft";
      await fetchMutation(
        anyApi.trending.saveTrendingBriefDraft,
        await withTrendingWriteAttestation("save-record", {
          trendingDate: trendingDateIso,
          owner,
          draftBrief: {
            ...brief,
            model,
            briefPromptVersion,
          },
        }),
      );
    }

    const canReuseStoredAssets = Boolean(
      !regenArt &&
      existing?.storageId &&
      existing?.artworkStorageId &&
      existing?.durationSeconds != null &&
      existing?.byteLength != null &&
      existingContentMatchesCurrent &&
      existingAudioMatchesCurrentTrending,
    );
    const canReuseExistingAudioForArtwork = Boolean(
      regenArt &&
      existing?.audioUrl &&
      existingContentMatchesCurrent &&
      existingAudioMatchesCurrentTrending,
    );

    const assetState = canReuseStoredAssets
      ? {
          storageId: existing?.storageId as Id<"_storage">,
          artworkStorageId: existing?.artworkStorageId as Id<"_storage">,
          durationSeconds: existing?.durationSeconds as number,
          byteLength: existing?.byteLength as number,
          metadata: {
            ...getTrendingTtsMetadata(),
            ttsCacheKey: getTrendingAudioCacheKey(),
          },
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
                generatedLedgerAssetKey = createAudioCacheLedgerAssetKey();
                const trendingTtsProfile = getTrendingTtsProfile();
                const generatedAudio = await generateTtsAudioWithMetadata(
                  {
                    text: audioScript,
                    provider: trendingTtsProfile.provider,
                    voiceId: trendingTtsProfile.voiceId,
                    fallbackPolicy: "forbid",
                    expectedTtsCacheKey: trendingTtsProfile.ttsCacheKey,
                  },
                  {
                    apiBaseUrl: baseUrl,
                    headers: await getTrustedTtsGenerationHeaders(
                      baseUrl,
                      "trending_podcast",
                      { bypassOpenAiQuota: true },
                    ),
                  },
                );
                if (
                  !isExactCurrentTrendingAudioMetadata(generatedAudio.metadata)
                ) {
                  throw new Error(
                    "Trending narration returned a non-Mini TTS profile.",
                  );
                }
                ttsMetadata = generatedAudio.metadata;
                generatedAudioProvider = generatedAudio.metadata.provider;
                generatedLedgerGeneratedAt = Date.now();
                generatedAudioReady = true;
                return generatedAudio.blob;
              })();
          const metadata = {
            ...(ttsMetadata ?? getTrendingTtsMetadata()),
            ttsCacheKey: getTrendingAudioCacheKey(),
          };
          const artworkBlob = new Blob([Buffer.from(artwork.data)], {
            type: artwork.mimeType,
          });
          stage = "tagging_audio";
          const taggedAudioBlob = await addMp3MetadataToBlob(sourceAudioBlob, {
            title:
              brief.headline || `Wikipedia Trending Brief: ${trendingDateIso}`,
            artist: "Curio Garden",
            album: TRENDING_PODCAST_TITLE,
            artwork,
          });
          stage = "requesting_upload_urls";
          const [audioUploadUrl, artworkUploadUrl] = await Promise.all([
            fetchMutation(
              anyApi.trending.generateUploadUrl,
              await withTrendingWriteAttestation("generate-upload-url", {}),
            ),
            fetchMutation(
              anyApi.trending.generateUploadUrl,
              await withTrendingWriteAttestation("generate-upload-url", {}),
            ),
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
    await fetchMutation(
      anyApi.trending.saveTrendingBrief,
      await withTrendingWriteAttestation("save-record", {
        trendingDate: trendingDateIso,
        owner,
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
        briefPromptVersion,
        ttsModel: assetState.metadata.model,
        ttsCacheKey: assetState.metadata.ttsCacheKey,
        provider: assetState.metadata.provider,
        voiceId: assetState.metadata.voiceId,
        promptVersion: assetState.metadata.promptVersion,
        ttsNormVersion: assetState.metadata.ttsNormVersion,
        ...(generatedLedgerAssetKey && generatedLedgerGeneratedAt != null
          ? {
              ledgerAssetKey: generatedLedgerAssetKey,
              ledgerGeneratedAt: generatedLedgerGeneratedAt,
            }
          : {}),
      }),
    );
    committedReady = true;

    stage = "reloading_saved_brief";
    const saved = (await fetchQuery(anyApi.trending.getTrendingBriefByDate, {
      trendingDate: trendingDateIso,
    })) as TrendingBriefRecord | null;

    if (!saved || saved.status !== "ready" || !saved.audioUrl) {
      throw new Error("Trending brief was saved but could not be reloaded");
    }

    stage = "finalizing_job";
    const finalization = await fetchMutation(
      anyApi.trending.finalizeTrendingBriefJob,
      await withTrendingWriteAttestation("finalize-job", {
        trendingDate: trendingDateIso,
        owner,
        status: "ready",
      }),
    );
    if (!finalization.updated) {
      throw new Error("Trending audio publication lease was lost.");
    }

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

    if (generatedAudioReady && generatedLedgerAssetKey && !committedReady) {
      await recordAudioCacheWriteFailureBestEffort({
        ledgerAssetKey: generatedLedgerAssetKey,
        source: "trending_podcast",
        provider: generatedAudioProvider ?? "openai",
      });
    }

    if (!previousReadyBrief && !committedReady) {
      try {
        await fetchMutation(
          anyApi.trending.saveTrendingBrief,
          await withTrendingWriteAttestation("save-record", {
            trendingDate: trendingDateIso,
            owner,
            status: "failed",
            headline: briefContentForRetry?.headline,
            summary: briefContentForRetry?.summary,
            podcastDescription: briefContentForRetry?.podcastDescription,
            spokenSummary: briefContentForRetry?.spokenSummary,
            keyPoints: briefContentForRetry?.keyPoints,
            articleTitles,
            imageUrls,
            artworkItems,
            sources: briefContentForRetry?.sources,
            model,
            briefPromptVersion,
            lastError: detailedMessage,
          }),
        );
      } catch (saveError) {
        console.warn(
          `[podcast:trending ${trendingDateIso} run=${runId}] failed to persist failure state`,
          saveError,
        );
      }
    }

    try {
      const finalization = await fetchMutation(
        anyApi.trending.finalizeTrendingBriefJob,
        await withTrendingWriteAttestation("finalize-job", {
          trendingDate: trendingDateIso,
          owner,
          status: "failed",
          lastError: detailedMessage,
        }),
      );
      if (!finalization.updated) {
        console.warn(
          `[podcast:trending ${trendingDateIso} run=${runId}] failure finalization skipped after lease loss`,
        );
      }
    } catch (finalizeError) {
      console.warn(
        `[podcast:trending ${trendingDateIso} run=${runId}] failed to finalize failed job`,
        finalizeError,
      );
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

export const getDailyTrendingBriefState =
  async (): Promise<DailyTrendingBriefState> => {
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

    if (shouldReuseExistingTrendingBrief(brief)) {
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
      status:
        brief?.status === "ready" ? "failed" : (brief?.status ?? "missing"),
      trendingDate: trendingDateIso,
      sourceIsStale,
      articleTitles: articles.map((article) => article.title),
      brief: null,
      lastError: brief?.lastError,
    };
  };
