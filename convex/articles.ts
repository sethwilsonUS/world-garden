import { query, internalQuery, internalMutation, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import {
  fetchArticleByPageId,
  fetchArticleByTitle,
  fetchParsedPageData,
  fetchSectionLinksByIndex,
  titleToSlug,
  slugToTitle,
  WikiArticle,
  WikiSection,
  WikiLinkedArticle,
  WikiSectionLinkCount,
  WikiCitation,
  ParsedPageData,
} from "./lib/wikipedia";

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

export const upsertArticle = internalMutation({
  args: {
    wikiPageId: v.string(),
    title: v.string(),
    slug: v.string(),
    language: v.string(),
    revisionId: v.string(),
    lastFetchedAt: v.number(),
    summary: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    sections: v.optional(
      v.array(
        v.object({
          title: v.string(),
          level: v.number(),
          content: v.string(),
        }),
      ),
    ),
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
        lastFetchedAt: args.lastFetchedAt,
        summary: args.summary,
        thumbnailUrl: args.thumbnailUrl,
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
      lastFetchedAt: args.lastFetchedAt,
      summary: args.summary,
      thumbnailUrl: args.thumbnailUrl,
      sections: args.sections,
    });
  },
});

export type FetchAndCacheResult = WikiArticle & {
  _id: Id<"articles">;
  sections: WikiSection[];
};

export const fetchAndCache = action({
  args: { wikiPageId: v.string() },
  async handler(ctx, args): Promise<FetchAndCacheResult> {
    const data = await fetchArticleByPageId(args.wikiPageId);

    const articleId: Id<"articles"> = await ctx.runMutation(
      internal.articles.upsertArticle,
      {
        wikiPageId: data.wikiPageId,
        title: data.title,
        slug: titleToSlug(data.title),
        language: data.language,
        revisionId: data.revisionId,
        lastFetchedAt: Date.now(),
        summary: data.summary,
        thumbnailUrl: data.thumbnailUrl,
        sections: data.sections,
      },
    );

    return {
      _id: articleId,
      ...data,
    };
  },
});

export const fetchAndCacheBySlug = action({
  args: { slug: v.string() },
  async handler(ctx, args): Promise<FetchAndCacheResult> {
    const title = slugToTitle(args.slug);
    const data = await fetchArticleByTitle(title);

    const articleId: Id<"articles"> = await ctx.runMutation(
      internal.articles.upsertArticle,
      {
        wikiPageId: data.wikiPageId,
        title: data.title,
        slug: titleToSlug(data.title),
        language: data.language,
        revisionId: data.revisionId,
        lastFetchedAt: Date.now(),
        summary: data.summary,
        thumbnailUrl: data.thumbnailUrl,
        sections: data.sections,
      },
    );

    return {
      _id: articleId,
      ...data,
    };
  },
});

/* ── Parse cache (link counts + citations + section index map) ── */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const getParseCache = internalQuery({
  args: { wikiPageId: v.string() },
  async handler(ctx, args) {
    return await ctx.db
      .query("articleParseCache")
      .withIndex("by_wikiPageId", (q) => q.eq("wikiPageId", args.wikiPageId))
      .first();
  },
});

export const upsertParseCache = internalMutation({
  args: {
    wikiPageId: v.string(),
    linkCounts: v.array(
      v.object({ title: v.string(), count: v.number() }),
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
        title: v.string(),
        count: v.number(),
        citationIds: v.array(v.string()),
      }),
    ),
    sectionIndexMap: v.array(
      v.object({ title: v.string(), index: v.string() }),
    ),
  },
  async handler(ctx, args) {
    const existing = await ctx.db
      .query("articleParseCache")
      .withIndex("by_wikiPageId", (q) => q.eq("wikiPageId", args.wikiPageId))
      .first();

    const data = {
      wikiPageId: args.wikiPageId,
      linkCounts: args.linkCounts,
      citations: args.citations,
      sectionCitations: args.sectionCitations,
      sectionIndexMap: args.sectionIndexMap,
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
  ctx: Pick<import("./_generated/server").ActionCtx, "runQuery" | "runMutation">,
  wikiPageId: string,
): Promise<ParsedPageData> => {
  const cached = await ctx.runQuery(internal.articles.getParseCache, {
    wikiPageId,
  });
  const hasCitationCounts =
    cached?.sectionCitations?.some((s: { count: number }) => s.count > 0) ?? false;
  const citationsPopulated = (cached?.citations?.length ?? 0) > 0;
  const cacheValid =
    cached &&
    Date.now() - cached.cachedAt < CACHE_TTL_MS &&
    (!hasCitationCounts || citationsPopulated);
  if (cacheValid) {
    return {
      linkCounts: cached.linkCounts,
      citations: cached.citations,
      sectionCitations: cached.sectionCitations,
      sectionIndexMap: cached.sectionIndexMap,
    };
  }

  const data = await fetchParsedPageData(wikiPageId);

  await ctx.runMutation(internal.articles.upsertParseCache, {
    wikiPageId,
    linkCounts: data.linkCounts,
    citations: data.citations,
    sectionCitations: data.sectionCitations,
    sectionIndexMap: data.sectionIndexMap,
  });

  return data;
};

export const getSectionLinkCounts = action({
  args: { wikiPageId: v.string() },
  async handler(ctx, args): Promise<WikiSectionLinkCount[]> {
    const data = await getOrFetchParsedData(ctx, args.wikiPageId);
    return data.linkCounts;
  },
});

export const getCitationCounts = action({
  args: { wikiPageId: v.string() },
  async handler(
    ctx,
    args,
  ): Promise<{ title: string; count: number }[]> {
    const data = await getOrFetchParsedData(ctx, args.wikiPageId);
    return data.sectionCitations.map(({ title, count }) => ({ title, count }));
  },
});

export const getSectionCitations = action({
  args: {
    wikiPageId: v.string(),
    sectionTitle: v.union(v.string(), v.null()),
  },
  async handler(ctx, args): Promise<WikiCitation[]> {
    const data = await getOrFetchParsedData(ctx, args.wikiPageId);
    const key = args.sectionTitle ?? "__summary__";
    const normalise = (s: string) =>
      s.replace(/<[^>]+>/g, "").trim().toLowerCase();
    const target = normalise(key);

    const sectionInfo = data.sectionCitations.find(
      (s) => normalise(s.title) === target,
    );
    if (!sectionInfo) return [];

    const idSet = new Set(sectionInfo.citationIds);
    return data.citations.filter((c) => idSet.has(c.id));
  },
});

/* ── Section links cache ── */

export const getSectionLinksFromCache = internalQuery({
  args: { wikiPageId: v.string(), sectionTitle: v.string() },
  async handler(ctx, args) {
    return await ctx.db
      .query("sectionLinksCache")
      .withIndex("by_wikiPageId_section", (q) =>
        q
          .eq("wikiPageId", args.wikiPageId)
          .eq("sectionTitle", args.sectionTitle),
      )
      .first();
  },
});

export const upsertSectionLinksCache = internalMutation({
  args: {
    wikiPageId: v.string(),
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
      .withIndex("by_wikiPageId_section", (q) =>
        q
          .eq("wikiPageId", args.wikiPageId)
          .eq("sectionTitle", args.sectionTitle),
      )
      .first();

    const data = {
      wikiPageId: args.wikiPageId,
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

export const getSectionLinks = action({
  args: {
    wikiPageId: v.string(),
    sectionTitle: v.union(v.string(), v.null()),
  },
  async handler(ctx, args): Promise<WikiLinkedArticle[]> {
    const cacheKey = args.sectionTitle ?? "__summary__";

    const cachedLinks = await ctx.runQuery(
      internal.articles.getSectionLinksFromCache,
      { wikiPageId: args.wikiPageId, sectionTitle: cacheKey },
    );
    if (cachedLinks && Date.now() - cachedLinks.cachedAt < CACHE_TTL_MS) {
      return cachedLinks.links;
    }

    let sectionIndex = "0";
    if (args.sectionTitle !== null) {
      const parseData = await getOrFetchParsedData(ctx, args.wikiPageId);
      const normalise = (s: string) =>
        s.replace(/<[^>]+>/g, "").trim().toLowerCase();
      const target = normalise(args.sectionTitle);
      const match = parseData.sectionIndexMap.find(
        (s) => normalise(s.title) === target,
      );
      if (!match) return [];
      sectionIndex = match.index;
    }

    const links = await fetchSectionLinksByIndex(
      args.wikiPageId,
      sectionIndex,
    );

    await ctx.runMutation(internal.articles.upsertSectionLinksCache, {
      wikiPageId: args.wikiPageId,
      sectionTitle: cacheKey,
      links,
    });

    return links;
  },
});
