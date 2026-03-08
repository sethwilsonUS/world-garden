import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const featuredPodcastEpisodeStatus = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("failed"),
);

const featuredPodcastJobStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("ready"),
  v.literal("failed"),
);

const trendingBriefStatus = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("failed"),
);

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
    thumbnailWidth: v.optional(v.number()),
    thumbnailHeight: v.optional(v.number()),
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

  sectionAudio: defineTable({
    articleId: v.id("articles"),
    sectionKey: v.string(),
    storageId: v.id("_storage"),
    ttsNormVersion: v.optional(v.string()),
    createdAt: v.number(),
    // Legacy fields from the old ElevenLabs-based schema; kept optional so
    // existing documents pass validation. New records omit these.
    voiceId: v.optional(v.string()),
    ttsModel: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
  }).index("by_article_section", ["articleId", "sectionKey"]),

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
    images: v.optional(
      v.array(
        v.object({
          src: v.string(),
          originalSrc: v.optional(v.string()),
          alt: v.string(),
          caption: v.string(),
          width: v.optional(v.number()),
          height: v.optional(v.number()),
          videoSrc: v.optional(v.string()),
        }),
      ),
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

  featuredPodcastEpisodes: defineTable({
    featuredDate: v.string(),
    articleId: v.id("articles"),
    wikiPageId: v.string(),
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    artworkStorageId: v.optional(v.id("_storage")),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    ttsNormVersion: v.string(),
    status: featuredPodcastEpisodeStatus,
    publishedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_featuredDate", ["featuredDate"])
    .index("by_publishedAt", ["publishedAt"]),

  featuredPodcastJobs: defineTable({
    featuredDate: v.string(),
    articleId: v.optional(v.id("articles")),
    status: featuredPodcastJobStatus,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_featuredDate", ["featuredDate"])
    .index("by_status", ["status"]),

  trendingBriefs: defineTable({
    trendingDate: v.string(),
    status: trendingBriefStatus,
    headline: v.optional(v.string()),
    summary: v.optional(v.string()),
    podcastDescription: v.optional(v.string()),
    spokenSummary: v.optional(v.string()),
    keyPoints: v.optional(v.array(v.string())),
    articleTitles: v.optional(v.array(v.string())),
    imageUrls: v.optional(v.array(v.string())),
    sources: v.optional(
      v.array(
        v.object({
          title: v.string(),
          url: v.string(),
        }),
      ),
    ),
    storageId: v.optional(v.id("_storage")),
    artworkStorageId: v.optional(v.id("_storage")),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    model: v.optional(v.string()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_trendingDate", ["trendingDate"])
    .index("by_updatedAt", ["updatedAt"]),
});
