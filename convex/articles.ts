import {
  query,
  internalQuery,
  internalMutation,
  action,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  fetchArticleBadgeKeys,
  fetchArticleByPageId,
  fetchArticleByTitle,
  fetchParsedPageData,
  fetchSectionLinksByIndex,
  cleanContentForTts,
  titleToSlug,
  slugToTitle,
  WikiArticle,
  WikiSection,
  WikiLinkedArticle,
  WikiArticleImage,
  WikiSectionLinkCount,
  WikiCitation,
  ParsedPageData,
} from "./lib/wikipedia";
import { BADGE_TOPIC_CACHE_VERSION, type BadgeKey } from "../lib/badges";
import {
  ARTICLE_SECTION_NARRATION_VERSION,
  createSectionNarrations,
  type SectionNarration,
} from "../lib/section-narration";
import type { WikipediaRevisionIdentity } from "../lib/wikipedia-contracts";
import {
  findWikipediaSectionMetadata,
  normalizeWikipediaSectionTitle,
  normalizeWikipediaTitle,
} from "../lib/wikipedia-utils";
import { normalizeMediaWikiNumericId } from "../lib/mediawiki-document/types";
import { normalizeMediaWikiSpecialSectionKey } from "../lib/mediawiki-section-key";

const sectionNarrationMode = v.union(
  v.literal("verbatim"),
  v.literal("structured"),
  v.literal("transition"),
  v.literal("none"),
);

const sectionNarrationSourceFormat = v.union(
  v.literal("prose"),
  v.literal("table"),
  v.literal("list"),
  v.literal("mixed"),
  v.literal("heading"),
);

const sectionNarration = v.object({
  mode: sectionNarrationMode,
  text: v.string(),
  sourceFormat: sectionNarrationSourceFormat,
  adapted: v.boolean(),
  usedRawFallback: v.boolean(),
  remainingSourceItems: v.optional(v.number()),
  sourceHash: v.string(),
});

const narratedWikiSection = v.object({
  wikiSectionIndex: v.string(),
  title: v.string(),
  level: v.number(),
  content: v.string(),
  narration: sectionNarration,
});

const badgeKey = v.union(
  v.literal("history"),
  v.literal("geography"),
  v.literal("biography"),
  v.literal("society_politics"),
  v.literal("arts_culture"),
  v.literal("science"),
  v.literal("technology"),
  v.literal("nature"),
);

const wikimediaMediaAttribution = v.object({
  creator: v.optional(v.string()),
  credit: v.optional(v.string()),
  licenseName: v.optional(v.string()),
  licenseUrl: v.optional(v.string()),
  sourceTitle: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
});

const wikipediaRevisionIdentityArgs = {
  wikiPageId: v.string(),
  revisionId: v.string(),
  title: v.string(),
  language: v.string(),
};

type WikipediaActionCtx = Pick<ActionCtx, "runQuery" | "runMutation">;

export const canonicalizeWikipediaRevisionIdentity = (
  identity: WikipediaRevisionIdentity,
): WikipediaRevisionIdentity => {
  const wikiPageId = normalizeMediaWikiNumericId(identity.wikiPageId);
  const revisionId = normalizeMediaWikiNumericId(identity.revisionId);
  const title = identity.title.replaceAll("_", " ").replace(/\s+/g, " ").trim();
  const language = identity.language.trim().toLowerCase();

  if (!wikiPageId) {
    throw new Error("wikiPageId must be a positive numeric ID.");
  }
  if (!revisionId) {
    throw new Error("revisionId must be a positive numeric ID.");
  }
  if (!title || title.length > 300) {
    throw new Error("Wikipedia title must contain 1 to 300 characters.");
  }
  if (!language || language.length > 32) {
    throw new Error("Wikipedia language must contain 1 to 32 characters.");
  }

  return { wikiPageId, revisionId, title, language };
};

export const normalizeWikipediaSectionIndex = (
  sectionIndex: string | undefined,
): string | undefined => {
  if (sectionIndex === undefined) return undefined;
  const normalized = sectionIndex.trim();
  const specialSectionKey = normalizeMediaWikiSpecialSectionKey(normalized);
  if (specialSectionKey) return specialSectionKey;
  if (!normalized || normalized.length > 16) {
    throw new Error("sectionIndex must be a non-negative integer.");
  }
  const containsOnlyDigits = [...normalized].every(
    (character) => character >= "0" && character <= "9",
  );
  const numericIndex = Number(normalized);

  if (
    !containsOnlyDigits ||
    !Number.isSafeInteger(numericIndex) ||
    numericIndex < 0
  ) {
    throw new Error("sectionIndex must be a non-negative integer.");
  }

  return String(numericIndex);
};

export const getWikipediaSectionLinksCacheKey = (
  sectionTitle: string | null,
  normalizedSectionIndex: string | undefined,
): string =>
  JSON.stringify(
    normalizedSectionIndex !== undefined
      ? ["index", normalizedSectionIndex]
      : sectionTitle === null
        ? ["summary"]
        : ["title", normalizeWikipediaSectionTitle(sectionTitle)],
  );

type CachedWikipediaRevisionIdentity = {
  wikiPageId?: string;
  revisionId?: string;
  title?: string;
  language?: string;
};

export const isWikipediaRevisionCacheIdentityCompatible = (
  cached: CachedWikipediaRevisionIdentity | null | undefined,
  requested: WikipediaRevisionIdentity,
): boolean => {
  if (!cached?.title || !cached.language) return false;
  const cachedPageId = normalizeMediaWikiNumericId(cached.wikiPageId);
  const cachedRevisionId = normalizeMediaWikiNumericId(cached.revisionId);
  const requestedPageId = normalizeMediaWikiNumericId(requested.wikiPageId);
  const requestedRevisionId = normalizeMediaWikiNumericId(requested.revisionId);

  return (
    cachedPageId !== null &&
    cachedPageId === requestedPageId &&
    cachedRevisionId !== null &&
    cachedRevisionId === requestedRevisionId &&
    normalizeWikipediaTitle(cached.title) ===
      normalizeWikipediaTitle(requested.title) &&
    cached.language.trim().toLowerCase() ===
      requested.language.trim().toLowerCase()
  );
};

/* ── Article CRUD ── */

export const getByWikiPageId = query({
  args: { wikiPageId: v.string() },
  async handler(ctx, args) {
    return await ctx.db
      .query("articles")
      .withIndex("by_wikiPageId", (q) => q.eq("wikiPageId", args.wikiPageId))
      .first();
  },
});

export const getBySlug = query({
  args: { slug: v.string() },
  async handler(ctx, args) {
    return await ctx.db
      .query("articles")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

export const getCachedArticleByWikiPageId = internalQuery({
  args: { wikiPageId: v.string() },
  async handler(ctx, args) {
    return await ctx.db
      .query("articles")
      .withIndex("by_wikiPageId", (q) => q.eq("wikiPageId", args.wikiPageId))
      .first();
  },
});

export const getCachedArticleBySlug = internalQuery({
  args: { slug: v.string() },
  async handler(ctx, args) {
    return await ctx.db
      .query("articles")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
  },
});

export const upsertArticle = internalMutation({
  args: {
    wikiPageId: v.string(),
    title: v.string(),
    slug: v.string(),
    language: v.string(),
    revisionId: v.string(),
    narrationVersion: v.number(),
    lastFetchedAt: v.number(),
    summary: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    thumbnailWidth: v.optional(v.number()),
    thumbnailHeight: v.optional(v.number()),
    thumbnailAttribution: v.optional(wikimediaMediaAttribution),
    badgeKeys: v.optional(v.array(badgeKey)),
    badgeTopicVersion: v.optional(v.number()),
    badgeTopicsCachedAt: v.optional(v.number()),
    sections: v.optional(v.array(narratedWikiSection)),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("articles")
      .withIndex("by_wikiPageId", (q) => q.eq("wikiPageId", args.wikiPageId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        title: args.title,
        slug: args.slug,
        language: args.language,
        revisionId: args.revisionId,
        narrationVersion: args.narrationVersion,
        lastFetchedAt: args.lastFetchedAt,
        summary: args.summary,
        thumbnailUrl: args.thumbnailUrl,
        thumbnailWidth: args.thumbnailWidth,
        thumbnailHeight: args.thumbnailHeight,
        thumbnailAttribution: args.thumbnailAttribution,
        ...(args.badgeKeys !== undefined
          ? {
              badgeKeys: args.badgeKeys,
              badgeTopicVersion: args.badgeTopicVersion,
              badgeTopicsCachedAt: args.badgeTopicsCachedAt,
            }
          : {}),
        sections: args.sections,
      });
      return existing._id;
    }

    return await ctx.db.insert("articles", {
      wikiPageId: args.wikiPageId,
      title: args.title,
      slug: args.slug,
      language: args.language,
      revisionId: args.revisionId,
      narrationVersion: args.narrationVersion,
      lastFetchedAt: args.lastFetchedAt,
      summary: args.summary,
      thumbnailUrl: args.thumbnailUrl,
      thumbnailWidth: args.thumbnailWidth,
      thumbnailHeight: args.thumbnailHeight,
      thumbnailAttribution: args.thumbnailAttribution,
      badgeKeys: args.badgeKeys,
      badgeTopicVersion: args.badgeTopicVersion,
      badgeTopicsCachedAt: args.badgeTopicsCachedAt,
      sections: args.sections,
    });
  },
});

export const persistNormalizedCachedNarration = internalMutation({
  args: {
    articleId: v.id("articles"),
    expectedRevisionId: v.string(),
    expectedNarrationVersion: v.union(v.number(), v.null()),
    expectedLastFetchedAt: v.number(),
    narrationVersion: v.number(),
    sections: v.array(narratedWikiSection),
  },
  async handler(ctx, args) {
    const article = await ctx.db.get(args.articleId);
    if (!article || !canPersistNormalizedCachedNarration(article, args)) {
      return { persisted: false };
    }
    await ctx.db.patch(args.articleId, {
      narrationVersion: args.narrationVersion,
      sections: args.sections,
    });
    return { persisted: true };
  },
});

export type FetchAndCacheResult = WikiArticle & {
  _id: Id<"articles">;
  sections: WikiSection[];
  badgeKeys?: BadgeKey[];
};

export const ARTICLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StoredArticle = {
  _id: Id<"articles">;
  wikiPageId: string;
  title: string;
  slug?: string;
  language: string;
  revisionId: string;
  narrationVersion?: number;
  lastFetchedAt: number;
  summary?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  thumbnailAttribution?: WikiArticle["thumbnailAttribution"];
  badgeKeys?: BadgeKey[];
  sections?: Array<{
    wikiSectionIndex?: string;
    title: string;
    level: number;
    content: string;
    narration?: SectionNarration;
    audioMode?: "full" | "summary_only" | "unavailable";
    audioReason?:
      | "eligible"
      | "too_short"
      | "list_like"
      | "table_like"
      | "metadata_heavy"
      | "low_prose_density";
  }>;
};

type CachedNarrationWriteExpectation = {
  expectedRevisionId: string;
  expectedNarrationVersion: number | null;
  expectedLastFetchedAt: number;
};

export const canPersistNormalizedCachedNarration = (
  article: Pick<
    StoredArticle,
    "revisionId" | "narrationVersion" | "lastFetchedAt"
  >,
  expected: CachedNarrationWriteExpectation,
): boolean =>
  article.revisionId === expected.expectedRevisionId &&
  (article.narrationVersion ?? null) === expected.expectedNarrationVersion &&
  article.lastFetchedAt === expected.expectedLastFetchedAt;

export const isCachedArticleFresh = (
  article: Pick<StoredArticle, "lastFetchedAt">,
  now = Date.now(),
): boolean => now - article.lastFetchedAt < ARTICLE_CACHE_TTL_MS;

export const isCachedArticleNarrationCompatible = (
  article: Pick<StoredArticle, "narrationVersion" | "sections">,
): boolean =>
  article.narrationVersion === ARTICLE_SECTION_NARRATION_VERSION &&
  (article.sections ?? []).every((section) =>
    Boolean(section.wikiSectionIndex && section.narration),
  );

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const normalizeCachedSections = (
  sections: StoredArticle["sections"],
  narrationVersion: StoredArticle["narrationVersion"],
  sourceIdentity: string,
): WikiSection[] => {
  if (
    narrationVersion === ARTICLE_SECTION_NARRATION_VERSION &&
    (sections ?? []).every((section) =>
      Boolean(section.wikiSectionIndex && section.narration),
    )
  ) {
    return (sections ?? []).map((section) => ({
      wikiSectionIndex: section.wikiSectionIndex!,
      title: section.title,
      level: section.level,
      content: section.content,
      narration: section.narration!,
    }));
  }

  const legacyNarrations = createSectionNarrations({
    sections: (sections ?? []).map((section, index) => ({
      wikiSectionIndex: section.wikiSectionIndex ?? String(index + 1),
      title: section.title,
      level: section.level,
      content: section.content,
    })),
    sourceIdentity,
  });

  return legacyNarrations;
};

export const cachedArticleToFetchResult = (
  article: StoredArticle,
): FetchAndCacheResult => {
  const sections = normalizeCachedSections(
    article.sections,
    article.narrationVersion,
    [article.wikiPageId, article.revisionId, article.title].join(":"),
  );
  const summary = article.summary ?? "";
  const contentText = cleanContentForTts(
    [
      summary,
      ...sections.map(
        (section) =>
          `${"=".repeat(section.level)} ${section.title} ${"=".repeat(section.level)}\n${section.content}`,
      ),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );

  return {
    _id: article._id,
    wikiPageId: article.wikiPageId,
    title: article.title,
    language: article.language,
    revisionId: article.revisionId,
    narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
    lastEdited: new Date(article.lastFetchedAt).toISOString(),
    summary,
    contentText,
    sections,
    thumbnailUrl: article.thumbnailUrl,
    thumbnailWidth: article.thumbnailWidth,
    thumbnailHeight: article.thumbnailHeight,
    thumbnailAttribution: article.thumbnailAttribution,
    badgeKeys: article.badgeKeys,
  };
};

export const normalizeCachedArticleForPersistence = (
  article: StoredArticle,
): {
  result: FetchAndCacheResult;
  mutationArgs: {
    articleId: Id<"articles">;
    expectedRevisionId: string;
    expectedNarrationVersion: number | null;
    expectedLastFetchedAt: number;
    narrationVersion: number;
    sections: WikiSection[];
  };
} => {
  const result = cachedArticleToFetchResult(article);
  return {
    result,
    mutationArgs: {
      articleId: article._id,
      expectedRevisionId: article.revisionId,
      expectedNarrationVersion: article.narrationVersion ?? null,
      expectedLastFetchedAt: article.lastFetchedAt,
      narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
      sections: result.sections,
    },
  };
};

export const persistCachedNarrationFallback = async (
  ctx: ActionCtx,
  cached: StoredArticle,
): Promise<FetchAndCacheResult> => {
  let candidate = cached;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (isCachedArticleNarrationCompatible(candidate)) {
      return cachedArticleToFetchResult(candidate);
    }
    const normalized = normalizeCachedArticleForPersistence(candidate);
    let persistence: { persisted: boolean };
    try {
      persistence = await ctx.runMutation(
        internal.articles.persistNormalizedCachedNarration,
        normalized.mutationArgs,
      );
    } catch {
      return normalized.result;
    }
    if (persistence.persisted) return normalized.result;

    let current: StoredArticle | null;
    try {
      current = await ctx.runQuery(
        internal.articles.getCachedArticleByWikiPageId,
        { wikiPageId: cached.wikiPageId },
      );
    } catch {
      return normalized.result;
    }
    if (!current) return normalized.result;
    if (isCachedArticleNarrationCompatible(current)) {
      return cachedArticleToFetchResult(current);
    }
    candidate = current;
  }
  return cachedArticleToFetchResult(candidate);
};

export const getExistingArticleForRefresh = internalQuery({
  args: { wikiPageId: v.string() },
  async handler(ctx, args) {
    return await ctx.db
      .query("articles")
      .withIndex("by_wikiPageId", (q) => q.eq("wikiPageId", args.wikiPageId))
      .first();
  },
});

const resolveBadgeCacheUpdate = async (
  ctx: ActionCtx,
  wikiPageId: string,
): Promise<{
  badgeKeys?: BadgeKey[];
  badgeTopicVersion?: number;
  badgeTopicsCachedAt?: number;
}> => {
  const existing = await ctx.runQuery(
    internal.articles.getExistingArticleForRefresh,
    {
      wikiPageId,
    },
  );

  if (
    existing?.badgeKeys &&
    existing.badgeTopicVersion === BADGE_TOPIC_CACHE_VERSION
  ) {
    return {
      badgeKeys: existing.badgeKeys as BadgeKey[],
      badgeTopicVersion: existing.badgeTopicVersion,
      badgeTopicsCachedAt: existing.badgeTopicsCachedAt,
    };
  }

  try {
    const badgeKeys = await fetchArticleBadgeKeys(wikiPageId);
    return {
      badgeKeys,
      badgeTopicVersion: BADGE_TOPIC_CACHE_VERSION,
      badgeTopicsCachedAt: Date.now(),
    };
  } catch {
    return existing?.badgeKeys
      ? {
          badgeKeys: existing.badgeKeys as BadgeKey[],
          badgeTopicVersion:
            existing.badgeTopicVersion ?? BADGE_TOPIC_CACHE_VERSION,
          badgeTopicsCachedAt: existing.badgeTopicsCachedAt,
        }
      : {};
  }
};

export const fetchAndCache = action({
  args: { wikiPageId: v.string() },
  async handler(ctx, args): Promise<FetchAndCacheResult> {
    const cached = await ctx.runQuery(
      internal.articles.getCachedArticleByWikiPageId,
      {
        wikiPageId: args.wikiPageId,
      },
    );

    if (
      cached &&
      isCachedArticleFresh(cached) &&
      isCachedArticleNarrationCompatible(cached)
    ) {
      return cachedArticleToFetchResult(cached);
    }

    let data: WikiArticle;
    try {
      data = await fetchArticleByPageId(args.wikiPageId);
    } catch (error) {
      if (cached) {
        console.warn(
          `Returning cached article ${args.wikiPageId} after Wikipedia fetch failed: ${getErrorMessage(error)}`,
        );
        return await persistCachedNarrationFallback(ctx, cached);
      }
      throw error;
    }
    const badgeCacheUpdate = await resolveBadgeCacheUpdate(
      ctx,
      data.wikiPageId,
    );

    const articleId: Id<"articles"> = await ctx.runMutation(
      internal.articles.upsertArticle,
      {
        wikiPageId: data.wikiPageId,
        title: data.title,
        slug: titleToSlug(data.title),
        language: data.language,
        revisionId: data.revisionId,
        narrationVersion: data.narrationVersion,
        lastFetchedAt: Date.now(),
        summary: data.summary,
        thumbnailUrl: data.thumbnailUrl,
        thumbnailWidth: data.thumbnailWidth,
        thumbnailHeight: data.thumbnailHeight,
        thumbnailAttribution: data.thumbnailAttribution,
        badgeKeys: badgeCacheUpdate.badgeKeys,
        badgeTopicVersion: badgeCacheUpdate.badgeTopicVersion,
        badgeTopicsCachedAt: badgeCacheUpdate.badgeTopicsCachedAt,
        sections: data.sections,
      },
    );

    return {
      _id: articleId,
      badgeKeys: badgeCacheUpdate.badgeKeys,
      ...data,
    };
  },
});

export const fetchAndCacheBySlug = action({
  args: { slug: v.string() },
  async handler(ctx, args): Promise<FetchAndCacheResult> {
    const cached = await ctx.runQuery(
      internal.articles.getCachedArticleBySlug,
      {
        slug: args.slug,
      },
    );

    if (
      cached &&
      isCachedArticleFresh(cached) &&
      isCachedArticleNarrationCompatible(cached)
    ) {
      return cachedArticleToFetchResult(cached);
    }

    const title = slugToTitle(args.slug);
    let data: WikiArticle;
    try {
      data = await fetchArticleByTitle(title);
    } catch (error) {
      if (cached) {
        console.warn(
          `Returning cached article "${args.slug}" after Wikipedia fetch failed: ${getErrorMessage(error)}`,
        );
        return await persistCachedNarrationFallback(ctx, cached);
      }
      throw error;
    }
    const badgeCacheUpdate = await resolveBadgeCacheUpdate(
      ctx,
      data.wikiPageId,
    );

    const articleId: Id<"articles"> = await ctx.runMutation(
      internal.articles.upsertArticle,
      {
        wikiPageId: data.wikiPageId,
        title: data.title,
        slug: titleToSlug(data.title),
        language: data.language,
        revisionId: data.revisionId,
        narrationVersion: data.narrationVersion,
        lastFetchedAt: Date.now(),
        summary: data.summary,
        thumbnailUrl: data.thumbnailUrl,
        thumbnailWidth: data.thumbnailWidth,
        thumbnailHeight: data.thumbnailHeight,
        thumbnailAttribution: data.thumbnailAttribution,
        badgeKeys: badgeCacheUpdate.badgeKeys,
        badgeTopicVersion: badgeCacheUpdate.badgeTopicVersion,
        badgeTopicsCachedAt: badgeCacheUpdate.badgeTopicsCachedAt,
        sections: data.sections,
      },
    );

    return {
      _id: articleId,
      badgeKeys: badgeCacheUpdate.badgeKeys,
      ...data,
    };
  },
});

/* ── Parse cache (link counts + citations + section index map) ── */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Bump whenever the semantic document projection changes. This forces legacy
// regex-derived metadata to become a lazy miss without a destructive migration.
export const ARTICLE_PARSE_MEDIA_CACHE_VERSION = 2;

type CachedParseImageMetadata = {
  src: string;
  lightboxSrc?: string;
  lightboxWidth?: number;
  lightboxHeight?: number;
  videoSrc?: string;
};

type CachedParseSectionIdentityMetadata = {
  linkCounts: readonly { index?: string; title: string; count: number }[];
  sectionCitations: readonly {
    index?: string;
    title: string;
    count: number;
    citationIds: readonly string[];
  }[];
};

export const hasCompleteArticleParseSectionIdentity = (
  metadata: CachedParseSectionIdentityMetadata,
): boolean =>
  metadata.linkCounts.every((section) => section.index !== undefined) &&
  metadata.sectionCitations.every((section) => section.index !== undefined);

/**
 * Keeps legacy cache rows that are already complete while forcing every
 * pre-lightbox photo through the parser once. The version marker prevents
 * repeated refreshes when Wikimedia legitimately cannot supply a rendition.
 */
export const isArticleParseMediaCacheCompatible = (
  images: readonly CachedParseImageMetadata[] | undefined,
  mediaMetadataVersion?: number,
): boolean => {
  if (!images) return false;

  // Preserve the pre-existing invalidation for thumbnails that were rewritten
  // to 800px instead of trusting the URL returned by Wikimedia.
  if (images.some((image) => image.src.includes("/800px-"))) return false;

  if (mediaMetadataVersion !== undefined) {
    return mediaMetadataVersion === ARTICLE_PARSE_MEDIA_CACHE_VERSION;
  }

  return images.every((image) => {
    const hasCompleteLightboxMetadata =
      Boolean(image.lightboxSrc) &&
      (image.lightboxWidth ?? 0) > 0 &&
      (image.lightboxHeight ?? 0) > 0;
    if (hasCompleteLightboxMetadata) return true;

    // Videos do not use the image lightbox. Every legacy photo gets one
    // refresh, including English-Wikipedia-local and otherwise unqueryable
    // media; the current version then accepts the result even without a
    // rendition, so these cases do not create a re-parse loop.
    return Boolean(image.videoSrc);
  });
};

export const getParseCache = internalQuery({
  args: wikipediaRevisionIdentityArgs,
  async handler(ctx, args) {
    const cached = await ctx.db
      .query("articleParseCache")
      .withIndex("by_wikiPageId_revisionId", (q) =>
        q.eq("wikiPageId", args.wikiPageId).eq("revisionId", args.revisionId),
      )
      .first();
    return isWikipediaRevisionCacheIdentityCompatible(cached, args)
      ? cached
      : null;
  },
});

export const upsertParseCache = internalMutation({
  args: {
    ...wikipediaRevisionIdentityArgs,
    linkCounts: v.array(
      v.object({
        index: v.optional(v.string()),
        title: v.string(),
        count: v.number(),
      }),
    ),
    citations: v.array(
      v.object({
        id: v.string(),
        index: v.number(),
        text: v.string(),
        url: v.optional(v.string()),
      }),
    ),
    sectionCitations: v.array(
      v.object({
        index: v.optional(v.string()),
        title: v.string(),
        count: v.number(),
        citationIds: v.array(v.string()),
      }),
    ),
    sectionIndexMap: v.array(
      v.object({ title: v.string(), index: v.string() }),
    ),
    images: v.optional(
      v.array(
        v.object({
          src: v.string(),
          originalSrc: v.optional(v.string()),
          lightboxSrc: v.optional(v.string()),
          lightboxWidth: v.optional(v.number()),
          lightboxHeight: v.optional(v.number()),
          alt: v.string(),
          caption: v.string(),
          width: v.optional(v.number()),
          height: v.optional(v.number()),
          videoSrc: v.optional(v.string()),
          attribution: v.optional(wikimediaMediaAttribution),
        }),
      ),
    ),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("articleParseCache")
      .withIndex("by_wikiPageId_revisionId", (q) =>
        q.eq("wikiPageId", args.wikiPageId).eq("revisionId", args.revisionId),
      )
      .first();

    const data = {
      wikiPageId: args.wikiPageId,
      revisionId: args.revisionId,
      title: args.title,
      language: args.language,
      linkCounts: args.linkCounts,
      citations: args.citations,
      sectionCitations: args.sectionCitations,
      sectionIndexMap: args.sectionIndexMap,
      images: args.images,
      mediaMetadataVersion: ARTICLE_PARSE_MEDIA_CACHE_VERSION,
      cachedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("articleParseCache", data);
    }
  },
});

const getOrFetchParsedData = async (
  ctx: WikipediaActionCtx,
  identity: WikipediaRevisionIdentity,
): Promise<ParsedPageData> => {
  if (identity.language !== "en") {
    return {
      linkCounts: [],
      citations: [],
      sectionCitations: [],
      sectionIndexMap: [],
      images: [],
    };
  }
  const cached = await ctx.runQuery(internal.articles.getParseCache, {
    ...identity,
  });
  const hasCitationCounts =
    cached?.sectionCitations?.some((s: { count: number }) => s.count > 0) ??
    false;
  const citationsPopulated = (cached?.citations?.length ?? 0) > 0;
  const imagesPopulated = isArticleParseMediaCacheCompatible(
    cached?.images,
    cached?.mediaMetadataVersion,
  );
  const sectionIdentityPopulated = cached
    ? hasCompleteArticleParseSectionIdentity(cached)
    : false;
  const cacheValid =
    cached &&
    isWikipediaRevisionCacheIdentityCompatible(cached, identity) &&
    Date.now() - cached.cachedAt < CACHE_TTL_MS &&
    (!hasCitationCounts || citationsPopulated) &&
    imagesPopulated &&
    sectionIdentityPopulated;
  if (cacheValid) {
    return {
      linkCounts: cached.linkCounts,
      citations: cached.citations,
      sectionCitations: cached.sectionCitations,
      sectionIndexMap: cached.sectionIndexMap,
      images: cached.images ?? [],
    };
  }

  const data = await fetchParsedPageData(identity);

  await ctx.runMutation(internal.articles.upsertParseCache, {
    ...identity,
    linkCounts: data.linkCounts,
    citations: data.citations,
    sectionCitations: data.sectionCitations,
    sectionIndexMap: data.sectionIndexMap,
    images: data.images,
  });

  return data;
};

export const getSectionLinkCounts = action({
  args: wikipediaRevisionIdentityArgs,
  async handler(ctx, args): Promise<WikiSectionLinkCount[]> {
    const identity = canonicalizeWikipediaRevisionIdentity(args);
    const data = await getOrFetchParsedData(ctx, identity);
    return data.linkCounts;
  },
});

export const getCitationCounts = action({
  args: wikipediaRevisionIdentityArgs,
  async handler(ctx, args): Promise<WikiSectionLinkCount[]> {
    const identity = canonicalizeWikipediaRevisionIdentity(args);
    const data = await getOrFetchParsedData(ctx, identity);
    return data.sectionCitations.map(({ index, title, count }) => ({
      ...(index !== undefined ? { index } : {}),
      title,
      count,
    }));
  },
});

export const getSectionCitations = action({
  args: {
    ...wikipediaRevisionIdentityArgs,
    sectionTitle: v.union(v.string(), v.null()),
    sectionIndex: v.optional(v.string()),
  },
  async handler(ctx, args): Promise<WikiCitation[]> {
    const identity = canonicalizeWikipediaRevisionIdentity(args);
    const data = await getOrFetchParsedData(ctx, identity);
    const sectionInfo = findWikipediaSectionMetadata(data.sectionCitations, {
      sectionTitle: args.sectionTitle,
      sectionIndex: args.sectionIndex,
    });
    if (!sectionInfo) return [];

    const idSet = new Set(sectionInfo.citationIds);
    return data.citations.filter((c) => idSet.has(c.id));
  },
});

export const getArticleImagesForCtx = async (
  ctx: WikipediaActionCtx,
  args: WikipediaRevisionIdentity,
): Promise<WikiArticleImage[]> => {
  const identity = canonicalizeWikipediaRevisionIdentity(args);
  const data = await getOrFetchParsedData(ctx, identity);
  return data.images;
};

export const getArticleImages = action({
  args: wikipediaRevisionIdentityArgs,
  handler: getArticleImagesForCtx,
});

/* ── Section links cache ── */

export const getSectionLinksFromCache = internalQuery({
  args: {
    ...wikipediaRevisionIdentityArgs,
    sectionTitle: v.string(),
  },
  async handler(ctx, args) {
    const cached = await ctx.db
      .query("sectionLinksCache")
      .withIndex("by_wikiPageId_revisionId_section", (q) =>
        q
          .eq("wikiPageId", args.wikiPageId)
          .eq("revisionId", args.revisionId)
          .eq("sectionTitle", args.sectionTitle),
      )
      .first();
    return isWikipediaRevisionCacheIdentityCompatible(cached, args)
      ? cached
      : null;
  },
});

export const upsertSectionLinksCache = internalMutation({
  args: {
    ...wikipediaRevisionIdentityArgs,
    sectionTitle: v.string(),
    links: v.array(
      v.object({
        wikiPageId: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
      }),
    ),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("sectionLinksCache")
      .withIndex("by_wikiPageId_revisionId_section", (q) =>
        q
          .eq("wikiPageId", args.wikiPageId)
          .eq("revisionId", args.revisionId)
          .eq("sectionTitle", args.sectionTitle),
      )
      .first();

    const data = {
      wikiPageId: args.wikiPageId,
      revisionId: args.revisionId,
      title: args.title,
      language: args.language,
      sectionTitle: args.sectionTitle,
      links: args.links,
      cachedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch(existing._id, data);
    } else {
      await ctx.db.insert("sectionLinksCache", data);
    }
  },
});

type GetSectionLinksArgs = WikipediaRevisionIdentity & {
  sectionTitle: string | null;
  sectionIndex?: string;
};

type GetSectionLinksOptions = {
  fetchSectionLinks?: typeof fetchSectionLinksByIndex;
};

export const getSectionLinksForCtx = async (
  ctx: WikipediaActionCtx,
  args: GetSectionLinksArgs,
  options: GetSectionLinksOptions = {},
): Promise<WikiLinkedArticle[]> => {
  if (args.sectionTitle === null && args.sectionIndex !== undefined) {
    throw new Error("sectionIndex must be omitted for the summary.");
  }
  const normalizedSectionIndex = normalizeWikipediaSectionIndex(
    args.sectionIndex,
  );
  const identity = canonicalizeWikipediaRevisionIdentity(args);
  if (identity.language !== "en") return [];
  const cacheKey = getWikipediaSectionLinksCacheKey(
    args.sectionTitle,
    normalizedSectionIndex,
  );

  const cachedLinks = await ctx.runQuery(
    internal.articles.getSectionLinksFromCache,
    {
      ...identity,
      sectionTitle: cacheKey,
    },
  );
  if (cachedLinks && Date.now() - cachedLinks.cachedAt < CACHE_TTL_MS) {
    return cachedLinks.links;
  }

  let sectionIndex = normalizedSectionIndex ?? "0";
  if (normalizedSectionIndex === undefined && args.sectionTitle !== null) {
    const parseData = await getOrFetchParsedData(ctx, identity);
    const target = normalizeWikipediaSectionTitle(args.sectionTitle);
    const match = parseData.sectionIndexMap.find(
      (section) => normalizeWikipediaSectionTitle(section.title) === target,
    );
    if (!match) return [];
    sectionIndex = normalizeWikipediaSectionIndex(match.index) ?? "0";
  }

  const links = await (options.fetchSectionLinks ?? fetchSectionLinksByIndex)(
    identity,
    sectionIndex,
  );

  await ctx.runMutation(internal.articles.upsertSectionLinksCache, {
    ...identity,
    sectionTitle: cacheKey,
    links,
  });

  return links;
};

export const getSectionLinks = action({
  args: {
    ...wikipediaRevisionIdentityArgs,
    sectionTitle: v.union(v.string(), v.null()),
    sectionIndex: v.optional(v.string()),
  },
  async handler(ctx, args) {
    return await getSectionLinksForCtx(ctx, args);
  },
});
