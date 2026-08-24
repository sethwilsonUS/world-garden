import { v } from "convex/values";

export const trendingBriefSourceValidator = v.object({
  title: v.string(),
  url: v.string(),
});

export const trendingBriefDraftValidator = v.object({
  headline: v.string(),
  summary: v.string(),
  podcastDescription: v.string(),
  spokenSummary: v.string(),
  keyPoints: v.array(v.string()),
  sources: v.array(trendingBriefSourceValidator),
  model: v.string(),
  briefPromptVersion: v.string(),
});

export const trendingBriefResearchDraftValidator = v.object({
  text: v.string(),
  sources: v.array(trendingBriefSourceValidator),
  model: v.string(),
  briefPromptVersion: v.string(),
  articleTitles: v.array(v.string()),
});
