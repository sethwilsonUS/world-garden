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

const didYouKnowAudioStatus = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("failed"),
);

const pictureOfDayAudioStatus = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("failed"),
);

const ttsAudioVariant = v.object({
  storageId: v.id("_storage"),
  durationSeconds: v.optional(v.number()),
  byteLength: v.optional(v.number()),
  ttsCacheKey: v.string(),
  provider: v.string(),
  model: v.string(),
  voiceId: v.string(),
  promptVersion: v.string(),
  ttsNormVersion: v.string(),
  createdAt: v.number(),
});

const ttsMetadata = v.object({
  provider: v.union(v.literal("openai"), v.literal("edge")),
  model: v.string(),
  voiceId: v.string(),
  promptVersion: v.string(),
  ttsNormVersion: v.string(),
  ttsCacheKey: v.string(),
});

const aiCostProvider = v.union(v.literal("openai"), v.literal("edge"));

const aiCostOperation = v.union(
  v.literal("tts"),
  v.literal("article_context_generation"),
  v.literal("trending_brief_research"),
  v.literal("trending_brief_writing"),
);

const aiCostSource = v.union(
  v.literal("interactive_article"),
  v.literal("article_audio_export"),
  v.literal("personal_playlist"),
  v.literal("featured_podcast"),
  v.literal("trending_podcast"),
  v.literal("picture_of_day"),
  v.literal("featured_audio_warm"),
  v.literal("article_context"),
  v.literal("trending_brief"),
  v.literal("background_generation"),
  v.literal("unknown"),
);

const aiCostOptionalProvider = v.union(aiCostProvider, v.null());
const aiCostOptionalOperation = v.union(aiCostOperation, v.null());

const articleAudioExportStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("ready"),
  v.literal("failed"),
);

const accountDeletionStatus = v.union(
  v.literal("cleaning"),
  v.literal("pending_clerk"),
  v.literal("clerk_deleted"),
);

const accountDeletionPhase = v.union(
  v.literal("revoke_feeds"),
  v.literal("playlist_episodes"),
  v.literal("article_audio_exports"),
  v.literal("owned_storage"),
  v.literal("bookmarks"),
  v.literal("listening_progress"),
  v.literal("badge_credits"),
  v.literal("account_quotas"),
  v.literal("feeds"),
  v.literal("pending_clerk"),
  v.literal("grace_period"),
);

const accountOwnedStorageKind = v.union(
  v.literal("personal_playlist_episode"),
  v.literal("article_audio_export"),
);

const personalPlaylistEpisodeStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("ready"),
  v.literal("failed"),
);

const articleAudioExportStage = v.union(
  v.literal("queued"),
  v.literal("rendering_audio"),
  v.literal("packaging"),
);

const articleSectionAudioMode = v.union(
  v.literal("full"),
  v.literal("summary_only"),
  v.literal("unavailable"),
);

const articleSectionAudioReason = v.union(
  v.literal("eligible"),
  v.literal("too_short"),
  v.literal("list_like"),
  v.literal("table_like"),
  v.literal("metadata_heavy"),
  v.literal("low_prose_density"),
);

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

const podcastShowAssetSlug = v.union(
  v.literal("featured"),
  v.literal("trending"),
  v.literal("personal"),
);

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

const heardRange = v.object({
  startSecond: v.number(),
  endSecond: v.number(),
});

const wikimediaMediaAttribution = v.object({
  creator: v.optional(v.string()),
  credit: v.optional(v.string()),
  licenseName: v.optional(v.string()),
  licenseUrl: v.optional(v.string()),
  sourceTitle: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
});

export default defineSchema({
  articles: defineTable({
    wikiPageId: v.string(),
    title: v.string(),
    slug: v.optional(v.string()),
    language: v.string(),
    revisionId: v.string(),
    narrationVersion: v.optional(v.number()),
    lastFetchedAt: v.number(),
    summary: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    thumbnailWidth: v.optional(v.number()),
    thumbnailHeight: v.optional(v.number()),
    thumbnailAttribution: v.optional(wikimediaMediaAttribution),
    badgeKeys: v.optional(v.array(badgeKey)),
    badgeTopicVersion: v.optional(v.number()),
    badgeTopicsCachedAt: v.optional(v.number()),
    sections: v.optional(
      v.array(
        v.object({
          wikiSectionIndex: v.optional(v.string()),
          title: v.string(),
          level: v.number(),
          content: v.string(),
          narration: v.optional(sectionNarration),
          // Kept optional for older cached articles written before
          // audio suitability metadata existed.
          audioMode: v.optional(articleSectionAudioMode),
          audioReason: v.optional(articleSectionAudioReason),
        }),
      ),
    ),
  })
    .index("by_wikiPageId", ["wikiPageId"])
    .index("by_slug", ["slug"]),

  bookmarks: defineTable({
    viewerTokenIdentifier: v.string(),
    slug: v.string(),
    title: v.string(),
    savedAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_viewerTokenIdentifier", ["viewerTokenIdentifier"])
    .index("by_viewerTokenIdentifier_slug", ["viewerTokenIdentifier", "slug"]),

  personalPodcastFeeds: defineTable({
    viewerTokenIdentifier: v.string(),
    feedToken: v.string(),
    revokedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_viewerTokenIdentifier", ["viewerTokenIdentifier"])
    .index("by_feedToken", ["feedToken"]),

  personalPlaylistEpisodes: defineTable({
    viewerTokenIdentifier: v.string(),
    articleId: v.id("articles"),
    wikiPageId: v.string(),
    slug: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    position: v.number(),
    publishedAt: v.number(),
    removedAt: v.optional(v.number()),
    status: personalPlaylistEpisodeStatus,
    stage: v.optional(articleAudioExportStage),
    sectionCount: v.optional(v.number()),
    narrationHash: v.optional(v.string()),
    requestedTtsMetadata: v.optional(ttsMetadata),
    generationRetryCount: v.optional(v.number()),
    completedSectionCount: v.optional(v.number()),
    storageId: v.optional(v.id("_storage")),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    ttsCacheKey: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    voiceId: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    ttsNormVersion: v.optional(v.string()),
    audioVariants: v.optional(v.array(ttsAudioVariant)),
    lastError: v.optional(v.string()),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_viewerTokenIdentifier", ["viewerTokenIdentifier"])
    .index("by_viewerTokenIdentifier_articleId", [
      "viewerTokenIdentifier",
      "articleId",
    ])
    .index("by_viewerTokenIdentifier_slug", ["viewerTokenIdentifier", "slug"])
    .index("by_viewerTokenIdentifier_position", [
      "viewerTokenIdentifier",
      "position",
    ]),

  sectionAudio: defineTable({
    articleId: v.id("articles"),
    sectionKey: v.string(),
    sourceHash: v.optional(v.string()),
    storageId: v.id("_storage"),
    ttsNormVersion: v.optional(v.string()),
    ttsCacheKey: v.optional(v.string()),
    provider: v.optional(v.string()),
    cacheContractVersion: v.optional(v.number()),
    model: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    createdAt: v.number(),
    // Legacy fields from the old ElevenLabs-based schema; kept optional so
    // existing documents pass validation. New records omit these.
    voiceId: v.optional(v.string()),
    ttsModel: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    ledgerAssetKey: v.optional(v.string()),
  })
    .index("by_article_section", ["articleId", "sectionKey"])
    .index("by_article_section_tts", [
      "articleId",
      "sectionKey",
      "ttsNormVersion",
    ])
    .index("by_article_section_cache_source", [
      "articleId",
      "sectionKey",
      "ttsCacheKey",
      "sourceHash",
    ]),

  articleParseCache: defineTable({
    wikiPageId: v.string(),
    // Optional only for rows written before revision-pinned metadata caching.
    revisionId: v.optional(v.string()),
    title: v.optional(v.string()),
    language: v.optional(v.string()),
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
    mediaMetadataVersion: v.optional(v.number()),
    cachedAt: v.number(),
  })
    .index("by_wikiPageId", ["wikiPageId"])
    .index("by_wikiPageId_revisionId", ["wikiPageId", "revisionId"]),

  articleContextCaches: defineTable({
    wikiPageId: v.string(),
    revisionId: v.string(),
    extractorVersion: v.string(),
    sourceHash: v.string(),
    schemaVersion: v.number(),
    manifestJson: v.string(),
    byteLength: v.number(),
    blockCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_cache_key", [
      "wikiPageId",
      "revisionId",
      "extractorVersion",
      "sourceHash",
    ])
    .index("by_page_revision_extractor", [
      "wikiPageId",
      "revisionId",
      "extractorVersion",
    ]),

  articleContextReports: defineTable({
    wikiPageId: v.string(),
    revisionId: v.string(),
    blockId: v.string(),
    sourceHash: v.string(),
    reporterKey: v.string(),
    reason: v.union(
      v.literal("inaccurate"),
      v.literal("misleading"),
      v.literal("accessibility"),
      v.literal("broken"),
      v.literal("inappropriate"),
      v.literal("other"),
    ),
    details: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("reviewing"),
      v.literal("resolved"),
      v.literal("dismissed"),
    ),
    occurrences: v.number(),
    resolutionNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_context_block", [
      "wikiPageId",
      "revisionId",
      "blockId",
      "sourceHash",
    ])
    .index("by_context_block_reporter", [
      "wikiPageId",
      "revisionId",
      "blockId",
      "sourceHash",
      "reporterKey",
    ])
    .index("by_status", ["status"]),

  articleContextModerations: defineTable({
    wikiPageId: v.string(),
    revisionId: v.string(),
    blockId: v.string(),
    sourceHash: v.string(),
    mode: v.union(v.literal("suppress"), v.literal("override")),
    status: v.union(v.literal("active"), v.literal("cleared")),
    override: v.optional(
      v.object({
        title: v.optional(v.string()),
        caption: v.optional(v.string()),
        // Legacy fields remain valid only so pre-v2 moderation documents load.
        takeaway: v.optional(v.string()),
        spokenSummary: v.optional(v.string()),
        longDescription: v.optional(v.string()),
      }),
    ),
    note: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_context_block", [
    "wikiPageId",
    "revisionId",
    "blockId",
    "sourceHash",
  ]),

  sectionLinksCache: defineTable({
    wikiPageId: v.string(),
    // Optional only for rows written before revision-pinned link caching.
    revisionId: v.optional(v.string()),
    // Optional only for rows written before full revision identity caching.
    title: v.optional(v.string()),
    language: v.optional(v.string()),
    sectionTitle: v.string(),
    links: v.array(
      v.object({
        wikiPageId: v.string(),
        title: v.string(),
        description: v.optional(v.string()),
      }),
    ),
    cachedAt: v.number(),
  })
    .index("by_wikiPageId_section", ["wikiPageId", "sectionTitle"])
    .index("by_wikiPageId_revisionId_section", [
      "wikiPageId",
      "revisionId",
      "sectionTitle",
    ]),

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
    artworkVersion: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    narrationHash: v.optional(v.string()),
    ttsNormVersion: v.string(),
    ttsCacheKey: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    voiceId: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    audioVariants: v.optional(v.array(ttsAudioVariant)),
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
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
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
    artworkItems: v.optional(
      v.array(
        v.object({
          title: v.string(),
          imageUrl: v.string(),
        }),
      ),
    ),
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
    artworkVersion: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    model: v.optional(v.string()),
    ttsModel: v.optional(v.string()),
    ttsCacheKey: v.optional(v.string()),
    provider: v.optional(v.string()),
    voiceId: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    ttsNormVersion: v.optional(v.string()),
    audioVariants: v.optional(v.array(ttsAudioVariant)),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_trendingDate", ["trendingDate"])
    .index("by_updatedAt", ["updatedAt"]),

  trendingBriefJobs: defineTable({
    trendingDate: v.string(),
    status: featuredPodcastJobStatus,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_trendingDate", ["trendingDate"])
    .index("by_status", ["status"]),

  todaySnapshots: defineTable({
    feedDate: v.string(),
    data: v.any(),
    generatedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_feedDate", ["feedDate"])
    .index("by_updatedAt", ["updatedAt"]),

  didYouKnowAudio: defineTable({
    feedDate: v.string(),
    status: didYouKnowAudioStatus,
    title: v.optional(v.string()),
    spokenText: v.optional(v.string()),
    itemTexts: v.optional(v.array(v.string())),
    storageId: v.optional(v.id("_storage")),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    voiceId: v.optional(v.string()),
    ttsCacheKey: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    ttsNormVersion: v.optional(v.string()),
    audioVariants: v.optional(v.array(ttsAudioVariant)),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_feedDate", ["feedDate"])
    .index("by_updatedAt", ["updatedAt"]),

  didYouKnowAudioJobs: defineTable({
    feedDate: v.string(),
    status: featuredPodcastJobStatus,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_feedDate", ["feedDate"])
    .index("by_status", ["status"]),

  pictureOfDayAudio: defineTable({
    feedDate: v.string(),
    pictureKey: v.string(),
    scriptVersion: v.number(),
    status: pictureOfDayAudioStatus,
    title: v.optional(v.string()),
    spokenText: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    durationSeconds: v.optional(v.number()),
    byteLength: v.optional(v.number()),
    voiceId: v.optional(v.string()),
    ttsCacheKey: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    promptVersion: v.optional(v.string()),
    ttsNormVersion: v.optional(v.string()),
    audioVariants: v.optional(v.array(ttsAudioVariant)),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_feedDate", ["feedDate"])
    .index("by_feedDate_picture_script", [
      "feedDate",
      "pictureKey",
      "scriptVersion",
    ]),

  pictureOfDayAudioJobs: defineTable({
    feedDate: v.string(),
    pictureKey: v.string(),
    scriptVersion: v.number(),
    status: featuredPodcastJobStatus,
    attempts: v.number(),
    lastError: v.optional(v.string()),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_feedDate_picture_script", [
      "feedDate",
      "pictureKey",
      "scriptVersion",
    ])
    .index("by_status", ["status"]),

  routeQuotas: defineTable({
    key: v.string(),
    count: v.number(),
    windowStart: v.number(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiresAt", ["expiresAt"]),

  productFeedback: defineTable({
    kind: v.union(
      v.literal("accessibility"),
      v.literal("product"),
      v.literal("technical"),
      v.literal("other"),
    ),
    message: v.string(),
    environment: v.optional(v.string()),
    contactEmail: v.optional(v.string()),
    researchOptIn: v.boolean(),
    articleTitle: v.optional(v.string()),
    articleSlug: v.optional(v.string()),
    articleRevisionId: v.optional(v.string()),
    status: v.union(
      v.literal("open"),
      v.literal("reviewing"),
      v.literal("resolved"),
      v.literal("dismissed"),
    ),
    contactExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_contactExpiresAt", ["contactExpiresAt"]),

  analyticsRollups: defineTable({
    key: v.string(),
    bucketStart: v.number(),
    source: v.string(),
    eventType: v.string(),
    eventName: v.optional(v.string()),
    path: v.optional(v.string()),
    dimensionsJson: v.string(),
    count: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_bucketStart", ["bucketStart"]),

  analyticsDrainDeliveries: defineTable({
    key: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiresAt", ["expiresAt"]),

  aiCostLedgerEvents: defineTable({
    eventKey: v.string(),
    eventDay: v.number(),
    observationEndsAt: v.union(v.number(), v.null()),
    expiresAt: v.number(),
    event: v.union(
      v.object({
        kind: v.literal("provider_attempt"),
        correlationId: v.string(),
        lifecycleVersion: v.number(),
        operation: aiCostOperation,
        source: aiCostSource,
        requestedProvider: aiCostProvider,
        effectiveProvider: aiCostProvider,
        model: v.union(v.string(), v.null()),
        serviceTier: v.union(
          v.literal("default"),
          v.literal("auto"),
          v.literal("flex"),
          v.literal("priority"),
          v.literal("scale"),
          v.literal("unknown"),
          v.null(),
        ),
        profile: v.union(v.string(), v.null()),
        state: v.union(
          v.literal("succeeded"),
          v.literal("failed_before_dispatch"),
          v.literal("failed_after_dispatch"),
          v.literal("unknown_after_dispatch"),
        ),
        failureCategory: v.union(
          v.literal("configuration"),
          v.literal("validation"),
          v.literal("quota"),
          v.literal("timeout"),
          v.literal("network"),
          v.literal("provider_http_4xx"),
          v.literal("provider_http_5xx"),
          v.literal("empty_response"),
          v.literal("invalid_response"),
          v.literal("aborted"),
          v.literal("unknown"),
          v.null(),
        ),
        dispatchedAt: v.union(v.number(), v.null()),
        completedAt: v.union(v.number(), v.null()),
        inputCharacters: v.union(v.number(), v.null()),
        inputWords: v.union(v.number(), v.null()),
        inputTokens: v.union(v.number(), v.null()),
        cachedInputTokens: v.union(v.number(), v.null()),
        cacheWriteInputTokens: v.union(v.number(), v.null()),
        outputTokens: v.union(v.number(), v.null()),
        reasoningOutputTokens: v.union(v.number(), v.null()),
        audioInputTokens: v.union(v.number(), v.null()),
        audioOutputTokens: v.union(v.number(), v.null()),
        webSearchCalls: v.union(v.number(), v.null()),
        responseAudioBytes: v.union(v.number(), v.null()),
        audioDurationMs: v.union(v.number(), v.null()),
        durationMeasurement: v.union(
          v.literal("measured"),
          v.literal("estimated"),
          v.literal("unknown"),
        ),
        estimatedDirectAiCostMicros: v.union(v.number(), v.null()),
        estimatedCostCurrency: v.literal("USD"),
        estimatedCostPricingVersion: v.union(v.string(), v.null()),
        estimatedCostEffectiveFrom: v.union(v.string(), v.null()),
        estimatedCostQuality: v.union(
          v.literal("derived_from_provider_usage"),
          v.literal("locally_measured_estimate"),
          v.literal("unknown"),
        ),
        estimatedCostReason: v.union(
          v.literal("not_dispatched"),
          v.literal("unsupported_provider"),
          v.literal("unsupported_model"),
          v.literal("unsupported_service_tier"),
          v.literal("long_context"),
          v.literal("missing_usage"),
          v.literal("speech_usage_unavailable"),
          v.null(),
        ),
        isFallbackAttempt: v.boolean(),
      }),
      v.object({
        kind: v.literal("cache_decision"),
        source: aiCostSource,
        provider: aiCostProvider,
        operation: aiCostOperation,
        requests: v.number(),
        hits: v.number(),
        misses: v.number(),
        reusedAssetServes: v.number(),
        avoidedGeneration: v.number(),
        uniqueGeneratedAssets: v.number(),
        concurrentGenerationRaces: v.number(),
        cacheWriteFailures: v.number(),
        idempotentRetryWrites: v.number(),
        bytes: v.number(),
        durationMs: v.number(),
        recordedAt: v.number(),
      }),
      v.object({
        kind: v.literal("generation_asset"),
        articleId: v.optional(v.id("articles")),
        sectionKey: v.optional(v.string()),
        source: aiCostSource,
        provider: aiCostProvider,
        model: v.union(v.string(), v.null()),
        byteLength: v.number(),
        durationMs: v.number(),
        durationMeasurement: v.union(
          v.literal("measured"),
          v.literal("estimated"),
          v.literal("unknown"),
        ),
        generatedAt: v.number(),
        observationEndsAt: v.number(),
        generationUseState: v.union(
          v.literal("awaiting_observation"),
          v.literal("observed_meaningful_use"),
          v.literal("no_observed_meaningful_use"),
          v.literal("external_consumption_unknown"),
        ),
      }),
      v.object({
        kind: v.literal("listening_contribution"),
        newUniqueHeardMs: v.number(),
        meaningfulUse: v.boolean(),
        observedAt: v.number(),
      }),
      v.object({
        kind: v.literal("pipeline_outcome"),
        source: aiCostSource,
        provider: aiCostOptionalProvider,
        operation: aiCostOptionalOperation,
        generatedSections: v.number(),
        reusedSections: v.number(),
        recordedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_eventKey", ["eventKey"])
    .index("by_eventDay", ["eventDay"])
    .index("by_observationEndsAt", ["observationEndsAt"])
    .index("by_expiresAt", ["expiresAt"]),

  aiCostLedgerDeliveries: defineTable({
    eventKey: v.string(),
    eventKind: v.union(
      v.literal("provider_attempt"),
      v.literal("cache_decision"),
      v.literal("generation_asset"),
      v.literal("listening_contribution"),
      v.literal("pipeline_outcome"),
    ),
    latestLifecycleVersion: v.union(v.number(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_eventKey", ["eventKey"]),

  aiCostLedgerCoverage: defineTable({
    key: v.literal("observe-v1"),
    // Optional only to permit an additive migration from the original
    // singleton marker. Every new write supplies these epoch fields.
    epochKey: v.optional(v.string()),
    epochVersion: v.optional(v.number()),
    firstObservedAt: v.union(v.number(), v.null()),
    resetAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  }).index("by_key", ["key"]),

  aiCostLedgerCoverageResets: defineTable({
    epochKey: v.string(),
    epochVersion: v.number(),
    resetAt: v.number(),
    createdAt: v.number(),
  }).index("by_epochKey", ["epochKey"]),

  aiCostDailyRollups: defineTable({
    key: v.string(),
    bucketStart: v.number(),
    source: aiCostSource,
    provider: aiCostOptionalProvider,
    operation: aiCostOptionalOperation,
    providerAttempts: v.number(),
    successfulAttempts: v.number(),
    failedBeforeDispatchAttempts: v.number(),
    failedAfterDispatchAttempts: v.number(),
    ambiguousAfterDispatchAttempts: v.number(),
    potentiallyBillableAttempts: v.number(),
    fallbackAttempts: v.number(),
    fallbackSucceededAttempts: v.number(),
    inputCharacters: v.number(),
    inputWords: v.number(),
    inputTokens: v.number(),
    cachedInputTokens: v.number(),
    cacheWriteInputTokens: v.number(),
    outputTokens: v.number(),
    webSearchCalls: v.number(),
    providerResponseAudioBytes: v.number(),
    providerAudioDurationMeasuredMs: v.number(),
    providerAudioDurationEstimatedMs: v.number(),
    estimatedDirectAiCostMicros: v.number(),
    estimatedCostKnownAttempts: v.number(),
    estimatedCostProviderUsageAttempts: v.number(),
    estimatedCostLocalEstimateAttempts: v.number(),
    estimatedCostUnknownAttempts: v.number(),
    cacheRequests: v.number(),
    cacheHits: v.number(),
    cacheMisses: v.number(),
    reusedAssetServes: v.number(),
    avoidedGeneration: v.number(),
    uniqueGeneratedAssets: v.number(),
    concurrentGenerationRaces: v.number(),
    cacheWriteFailures: v.number(),
    idempotentRetryWrites: v.number(),
    cacheServedBytes: v.number(),
    cacheServedDurationMs: v.number(),
    uniqueGeneratedBytes: v.number(),
    uniqueGeneratedDurationMeasuredMs: v.number(),
    uniqueGeneratedDurationEstimatedMs: v.number(),
    pipelineGeneratedSections: v.number(),
    pipelineReusedSections: v.number(),
    signedInUniqueHeardMs: v.number(),
    generationAwaitingObservation: v.number(),
    generationObservedMeaningfulUse: v.number(),
    generationNoObservedMeaningfulUse: v.number(),
    generationExternalConsumptionUnknown: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_bucketStart", ["bucketStart"]),

  aiCostStatements: defineTable({
    statementKey: v.string(),
    provider: aiCostProvider,
    serviceScope: v.union(
      v.literal("all_direct_ai"),
      v.literal("responses"),
      v.literal("speech"),
      v.literal("web_search"),
    ),
    periodStartDay: v.string(),
    periodEndDay: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
    amountMicros: v.number(),
    currency: v.literal("USD"),
    source: v.union(
      v.literal("provider_costs_api"),
      v.literal("invoice_total"),
      v.literal("manual_entry"),
    ),
    allocationMethod: v.union(
      v.literal("unallocated"),
      v.literal("estimated_cost_weight"),
      v.literal("input_tokens"),
      v.literal("input_characters"),
      v.literal("web_search_calls"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_statementKey", ["statementKey"])
    .index("by_periodStart", ["periodStart"])
    .index("by_periodEnd", ["periodEnd"]),

  podcastShowAssets: defineTable({
    slug: podcastShowAssetSlug,
    storageId: v.id("_storage"),
    mimeType: v.string(),
    version: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  articleAudioExports: defineTable({
    clientId: v.string(),
    articleId: v.id("articles"),
    slug: v.string(),
    title: v.string(),
    status: articleAudioExportStatus,
    stage: v.optional(articleAudioExportStage),
    sectionCount: v.number(),
    completedSectionCount: v.number(),
    narrationHash: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    byteLength: v.optional(v.number()),
    requestedTtsMetadata: v.optional(ttsMetadata),
    producedTtsCacheKey: v.optional(v.string()),
    ttsCacheKey: v.optional(v.string()),
    // Optional only for legacy rows. Read authorization never treats a
    // missing or unknown value as public Edge audio.
    ttsProvider: v.optional(v.string()),
    ownerTokenIdentifier: v.optional(v.string()),
    queueKey: v.optional(v.string()),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    dismissedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_clientId", ["clientId"])
    .index("by_clientId_updatedAt", ["clientId", "updatedAt"])
    .index("by_articleId", ["articleId"])
    .index("by_clientId_articleId", ["clientId", "articleId"])
    .index("by_ownerTokenIdentifier", ["ownerTokenIdentifier"])
    .index("by_queueKey_status", ["queueKey", "status", "createdAt"]),

  viewerArticleListenProgress: defineTable({
    viewerTokenIdentifier: v.string(),
    articleId: v.id("articles"),
    wikiPageId: v.string(),
    slug: v.string(),
    title: v.string(),
    totalDurationSeconds: v.number(),
    heardSeconds: v.number(),
    qualifiedAt: v.optional(v.number()),
    sections: v.array(
      v.object({
        sectionKey: v.string(),
        durationSeconds: v.number(),
        heardRanges: v.array(heardRange),
      }),
    ),
    meaningfulUseSession: v.optional(
      v.object({
        startedAt: v.number(),
        sections: v.array(
          v.object({
            sectionKey: v.string(),
            durationSeconds: v.number(),
            heardRanges: v.array(heardRange),
          }),
        ),
      }),
    ),
    meaningfulUseSessionExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_viewerTokenIdentifier", ["viewerTokenIdentifier"])
    .index("by_viewerTokenIdentifier_wikiPageId", [
      "viewerTokenIdentifier",
      "wikiPageId",
    ])
    .index("by_viewerTokenIdentifier_articleId", [
      "viewerTokenIdentifier",
      "articleId",
    ])
    .index("by_meaningfulUseSessionExpiresAt_sessionStartedAt", [
      "meaningfulUseSessionExpiresAt",
      "meaningfulUseSession.startedAt",
    ]),

  badgeArticleCredits: defineTable({
    viewerTokenIdentifier: v.string(),
    articleId: v.id("articles"),
    wikiPageId: v.string(),
    slug: v.string(),
    title: v.string(),
    badgeKey,
    earnedAt: v.number(),
  })
    .index("by_viewerTokenIdentifier", ["viewerTokenIdentifier"])
    .index("by_viewerTokenIdentifier_wikiPageId_badgeKey", [
      "viewerTokenIdentifier",
      "wikiPageId",
      "badgeKey",
    ]),

  accountDeletionRequests: defineTable({
    viewerTokenIdentifier: v.string(),
    clerkUserId: v.string(),
    status: accountDeletionStatus,
    phase: accountDeletionPhase,
    cleanupAttemptCount: v.number(),
    clerkDeletionAttemptCount: v.number(),
    lastCleanupAttemptAt: v.optional(v.number()),
    lastClerkAttemptAt: v.optional(v.number()),
    cleanupCompletedAt: v.optional(v.number()),
    clerkDeletedAt: v.optional(v.number()),
    purgeAfter: v.optional(v.number()),
    purgeSweepRetryCount: v.optional(v.number()),
    lastPurgeSweepRetryAt: v.optional(v.number()),
    needsAttentionAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_viewerTokenIdentifier", ["viewerTokenIdentifier"])
    .index("by_clerkUserId", ["clerkUserId"])
    .index("by_status_updatedAt", ["status", "updatedAt"]),

  accountOwnedStorage: defineTable({
    viewerTokenIdentifier: v.string(),
    storageId: v.id("_storage"),
    kind: accountOwnedStorageKind,
    parentId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_viewerTokenIdentifier", ["viewerTokenIdentifier"])
    .index("by_storageId", ["storageId"]),

  accountOwnedStorageSweepState: defineTable({
    key: v.string(),
    scannedThrough: v.number(),
    activeCutoff: v.optional(v.number()),
    cursor: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
