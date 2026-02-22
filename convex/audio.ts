import {
  query,
  internalQuery,
  internalMutation,
  action,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { fetchArticleByPageId, titleToSlug } from "./lib/wikipedia";
import { generateTtsAudio, TTS_NORM_VERSION } from "./lib/elevenlabs";

/* ── Rate Limiting ── */

export const checkRateLimit = internalMutation({
  args: {
    key: v.string(),
    max: v.number(),
    windowMs: v.number(),
  },
  async handler(ctx, args) {
    const { key, max, windowMs } = args;
    const now = Date.now();
    const existing = await ctx.db
      .query("rateLimits")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
      return { allowed: true };
    }

    if (now > existing.windowStart + windowMs) {
      await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
      return { allowed: true };
    }

    if (existing.count >= max) {
      return { allowed: false };
    }

    await ctx.db.patch(existing._id, { count: existing.count + 1 });
    return { allowed: true };
  },
});

/* ── Section Audio Queries ── */

export const getSectionAudio = query({
  args: {
    articleId: v.id("articles"),
    sectionKey: v.string(),
    voiceId: v.string(),
  },
  async handler(ctx, args) {
    const audio = await ctx.db
      .query("sectionAudio")
      .withIndex("by_article_section_voice", (q) =>
        q
          .eq("articleId", args.articleId)
          .eq("sectionKey", args.sectionKey)
          .eq("voiceId", args.voiceId),
      )
      .first();

    if (!audio) return null;
    const url = await ctx.storage.getUrl(audio.storageId);
    return { ...audio, audioUrl: url };
  },
});

export const getSectionDurations = query({
  args: { articleId: v.id("articles") },
  async handler(ctx, args) {
    const records = await ctx.db
      .query("sectionAudio")
      .withIndex("by_article_section_voice", (q) =>
        q.eq("articleId", args.articleId),
      )
      .collect();

    const durations: Record<string, number> = {};
    for (const r of records) {
      if (r.durationSeconds != null && !(r.sectionKey in durations)) {
        durations[r.sectionKey] = r.durationSeconds;
      }
    }
    return durations;
  },
});

export const getSectionAudioInternal = internalQuery({
  args: {
    articleId: v.id("articles"),
    sectionKey: v.string(),
    voiceId: v.string(),
  },
  async handler(ctx, args) {
    const audio = await ctx.db
      .query("sectionAudio")
      .withIndex("by_article_section_voice", (q) =>
        q
          .eq("articleId", args.articleId)
          .eq("sectionKey", args.sectionKey)
          .eq("voiceId", args.voiceId),
      )
      .first();

    if (!audio) return null;
    const url = await ctx.storage.getUrl(audio.storageId);
    return { ...audio, audioUrl: url };
  },
});

export const saveSectionAudioRecord = internalMutation({
  args: {
    articleId: v.id("articles"),
    sectionKey: v.string(),
    voiceId: v.string(),
    ttsModel: v.string(),
    storageId: v.id("_storage"),
    durationSeconds: v.optional(v.number()),
    ttsNormVersion: v.optional(v.string()),
  },
  async handler(ctx, args) {
    await ctx.db.insert("sectionAudio", {
      articleId: args.articleId,
      sectionKey: args.sectionKey,
      voiceId: args.voiceId,
      ttsModel: args.ttsModel,
      storageId: args.storageId,
      durationSeconds: args.durationSeconds,
      ttsNormVersion: args.ttsNormVersion,
      createdAt: Date.now(),
    });
  },
});

/* ── Section Audio Generation ── */

/**
 * Generate (or retrieve cached) audio for a specific article section.
 * sectionKey: "summary" for the lead, or "section-{index}" for TOC entries.
 */
export const getOrCreateSectionAudio = action({
  args: {
    wikiPageId: v.string(),
    sectionKey: v.string(),
    voiceId: v.optional(v.string()),
  },
  async handler(ctx, args): Promise<{ audioUrl: string | null }> {
    const rateCheck: { allowed: boolean } = await ctx.runMutation(
      internal.audio.checkRateLimit,
      { key: "global", max: 60, windowMs: 60 * 60 * 1000 },
    );

    if (!rateCheck.allowed) {
      throw new Error("Rate limit exceeded");
    }

    const articleData = await fetchArticleByPageId(args.wikiPageId);

    const articleId: Id<"articles"> = await ctx.runMutation(
      internal.articles.upsertArticle,
      {
        wikiPageId: articleData.wikiPageId,
        title: articleData.title,
        slug: titleToSlug(articleData.title),
        language: articleData.language,
        revisionId: articleData.revisionId,
        lastFetchedAt: Date.now(),
        summary: articleData.summary,
        sections: articleData.sections,
      },
    );

    const voiceId = args.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? "";
    if (!voiceId) {
      throw new Error("No voice ID configured");
    }

    const existing = (await ctx.runQuery(
      internal.audio.getSectionAudioInternal,
      { articleId, sectionKey: args.sectionKey, voiceId },
    )) as { audioUrl: string | null; ttsNormVersion?: string } | null;

    if (existing?.audioUrl && existing.ttsNormVersion === TTS_NORM_VERSION) {
      return { audioUrl: existing.audioUrl };
    }

    let textToSpeak: string;
    if (args.sectionKey === "summary") {
      textToSpeak = articleData.summary;
    } else {
      const idx = parseInt(args.sectionKey.replace("section-", ""), 10);
      const section = articleData.sections[idx];
      if (!section) {
        throw new Error(`Section not found: ${args.sectionKey}`);
      }
      textToSpeak = `${section.title}. ${section.content}`;
    }

    if (!textToSpeak || textToSpeak.length < 10) {
      throw new Error("Section text is too short to generate audio");
    }

    const TTS_CHAR_LIMIT = 4800;
    if (textToSpeak.length > TTS_CHAR_LIMIT) {
      textToSpeak = textToSpeak.slice(0, TTS_CHAR_LIMIT);
      const lastSentence = textToSpeak.lastIndexOf(". ");
      if (lastSentence > TTS_CHAR_LIMIT * 0.5) {
        textToSpeak = textToSpeak.slice(0, lastSentence + 1);
      }
    }

    const audioBlob = await generateTtsAudio({ text: textToSpeak, voiceId });
    const durationSeconds = Math.round((audioBlob.size * 8) / 128000);
    const storageId = await ctx.storage.store(audioBlob);

    await ctx.runMutation(internal.audio.saveSectionAudioRecord, {
      articleId,
      sectionKey: args.sectionKey,
      voiceId,
      ttsModel: "eleven_turbo_v2_5",
      storageId,
      durationSeconds,
      ttsNormVersion: TTS_NORM_VERSION,
    });

    const audioUrl = await ctx.storage.getUrl(storageId);
    return { audioUrl };
  },
});

/* ── Legacy (kept for backward compat) ── */

export const getForArticle = query({
  args: {
    articleId: v.id("articles"),
    voiceId: v.string(),
  },
  async handler(ctx, args) {
    const audio = await ctx.db
      .query("articleAudio")
      .withIndex("by_article_voice", (q) =>
        q.eq("articleId", args.articleId).eq("voiceId", args.voiceId),
      )
      .first();

    if (!audio) return null;
    const url = await ctx.storage.getUrl(audio.storageId);
    return { ...audio, audioUrl: url };
  },
});

export const getForArticleInternal = internalQuery({
  args: {
    articleId: v.id("articles"),
    voiceId: v.string(),
  },
  async handler(ctx, args) {
    const audio = await ctx.db
      .query("articleAudio")
      .withIndex("by_article_voice", (q) =>
        q.eq("articleId", args.articleId).eq("voiceId", args.voiceId),
      )
      .first();

    if (!audio) return null;
    const url = await ctx.storage.getUrl(audio.storageId);
    return { ...audio, audioUrl: url };
  },
});

export const saveAudioRecord = internalMutation({
  args: {
    articleId: v.id("articles"),
    voiceId: v.string(),
    ttsModel: v.string(),
    storageId: v.id("_storage"),
    ttsNormVersion: v.optional(v.string()),
  },
  async handler(ctx, args) {
    await ctx.db.insert("articleAudio", {
      articleId: args.articleId,
      voiceId: args.voiceId,
      ttsModel: args.ttsModel,
      storageId: args.storageId,
      ttsNormVersion: args.ttsNormVersion,
      createdAt: Date.now(),
    });
  },
});

export const getOrCreateForArticle = action({
  args: {
    wikiPageId: v.string(),
    voiceId: v.optional(v.string()),
  },
  async handler(ctx, args): Promise<{ audioUrl: string | null }> {
    const rateCheck: { allowed: boolean } = await ctx.runMutation(
      internal.audio.checkRateLimit,
      { key: "global", max: 60, windowMs: 60 * 60 * 1000 },
    );

    if (!rateCheck.allowed) {
      throw new Error("Rate limit exceeded");
    }

    const articleData = await fetchArticleByPageId(args.wikiPageId);

    const articleId: Id<"articles"> = await ctx.runMutation(
      internal.articles.upsertArticle,
      {
        wikiPageId: articleData.wikiPageId,
        title: articleData.title,
        slug: titleToSlug(articleData.title),
        language: articleData.language,
        revisionId: articleData.revisionId,
        lastFetchedAt: Date.now(),
        summary: articleData.summary,
        sections: articleData.sections,
      },
    );

    const voiceId = args.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? "";
    if (!voiceId) {
      throw new Error("No voice ID configured");
    }

    const existingAudio = (await ctx.runQuery(
      internal.audio.getForArticleInternal,
      { articleId, voiceId },
    )) as { audioUrl: string | null; ttsNormVersion?: string } | null;

    if (existingAudio?.audioUrl && existingAudio.ttsNormVersion === TTS_NORM_VERSION) {
      return { audioUrl: existingAudio.audioUrl };
    }

    const audioBlob = await generateTtsAudio({
      text: articleData.contentText,
      voiceId,
    });

    const storageId = await ctx.storage.store(audioBlob);

    await ctx.runMutation(internal.audio.saveAudioRecord, {
      articleId,
      voiceId,
      ttsModel: "eleven_turbo_v2_5",
      storageId,
      ttsNormVersion: TTS_NORM_VERSION,
    });

    const audioUrl = await ctx.storage.getUrl(storageId);
    return { audioUrl };
  },
});
