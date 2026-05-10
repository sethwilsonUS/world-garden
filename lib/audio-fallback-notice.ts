import type { TtsFallbackReason } from "./tts-profile";

export const HIGH_DEMAND_FALLBACK_NOTICE =
  "High demand is using Curio Garden’s fallback voice for this article. Audio will keep playing.";

export const getQuotaFallbackNoticeForPlayback = ({
  articleKey,
  announcedArticleKey,
  fallbackReason,
}: {
  articleKey: string;
  announcedArticleKey: string | null;
  fallbackReason?: TtsFallbackReason;
}): { articleKey: string; message: string } | null => {
  if (fallbackReason !== "openai_quota") return null;
  if (announcedArticleKey === articleKey) return null;
  return { articleKey, message: HIGH_DEMAND_FALLBACK_NOTICE };
};
