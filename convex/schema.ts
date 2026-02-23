import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  articles: defineTable({
    wikiPageId: v.string(),
    title: v.string(),
    slug: v.optional(v.string()),
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
  })
    .index("by_wikiPageId", ["wikiPageId"])
    .index("by_slug", ["slug"]),

  articleAudio: defineTable({
    articleId: v.id("articles"),
    voiceId: v.string(),
    ttsModel: v.string(),
    storageId: v.id("_storage"),
    durationSeconds: v.optional(v.number()),
    ttsNormVersion: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_article_voice", ["articleId", "voiceId"]),

  sectionAudio: defineTable({
    articleId: v.id("articles"),
    sectionKey: v.string(),
    voiceId: v.string(),
    ttsModel: v.string(),
    storageId: v.id("_storage"),
    durationSeconds: v.optional(v.number()),
    ttsNormVersion: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_article_section_voice", ["articleId", "sectionKey", "voiceId"]),

  rateLimits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_key", ["key"]),

  articleParseCache: defineTable({
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
    cachedAt: v.number(),
  }).index("by_wikiPageId", ["wikiPageId"]),

  sectionLinksCache: defineTable({
    wikiPageId: v.string(),
    sectionTitle: v.string(),
    links: v.array(
      v.object({
        wikiPageId: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
      }),
    ),
    cachedAt: v.number(),
  }).index("by_wikiPageId_section", ["wikiPageId", "sectionTitle"]),
});
