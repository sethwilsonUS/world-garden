export const getPodcastDescription = (text: string | null | undefined): string => {
  if (!text) return "";

  const normalized = text
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((part) => part.trim())
    .find(Boolean);

  return normalized ?? text.trim();
};

export const getPodcastExcerpt = (
  text: string | null | undefined,
  maxLength = 220,
): string => {
  const description = getPodcastDescription(text);
  if (!description) return "";
  if (description.length <= maxLength) return description;

  const sentenceMatch = description.match(/^(.+?[.!?])(\s|$)/);
  const firstSentence = sentenceMatch?.[1]?.trim();
  if (firstSentence && firstSentence.length <= maxLength) {
    return firstSentence;
  }

  return `${description.slice(0, maxLength - 1).trimEnd()}…`;
};

export const getPodcastSiteUrl = (fallbackOrigin?: string): string =>
  (process.env.NEXT_PUBLIC_SITE_URL || fallbackOrigin || "http://localhost:3000").replace(/\/$/, "");

export const FEATURED_SHOW_ARTWORK_VERSION = 1;
export const TRENDING_SHOW_ARTWORK_VERSION = 2;

export const getPodcastArtworkUrl = (fallbackOrigin?: string): string =>
  `${getPodcastSiteUrl(fallbackOrigin)}/api/podcast/artwork?v=${FEATURED_SHOW_ARTWORK_VERSION}`;

export const getFeaturedPodcastEpisodeArtworkUrl = (
  fallbackOrigin?: string,
  episodeId?: string | null,
): string =>
  episodeId
    ? `${getPodcastSiteUrl(fallbackOrigin)}/api/podcast/artwork/${episodeId}`
    : getPodcastArtworkUrl(fallbackOrigin);

export const getFeaturedPodcastItemArtworkUrl = (
  {
    artworkUrl,
    imageUrl,
    episodeId,
  }: {
    artworkUrl?: string | null;
    imageUrl?: string | null;
    episodeId?: string | null;
  },
  fallbackOrigin?: string,
): string =>
  episodeId?.trim()
    ? getFeaturedPodcastEpisodeArtworkUrl(fallbackOrigin, episodeId)
    : artworkUrl?.trim() ||
      imageUrl?.trim() ||
      getPodcastArtworkUrl(fallbackOrigin);

export const getTrendingPodcastShowArtworkUrl = (
  fallbackOrigin?: string,
): string =>
  `${getPodcastSiteUrl(fallbackOrigin)}/api/podcast/trending/artwork?v=${TRENDING_SHOW_ARTWORK_VERSION}`;

export const getTrendingPodcastEpisodeArtworkUrl = (
  fallbackOrigin?: string,
  briefId?: string | null,
): string =>
  briefId
    ? `${getPodcastSiteUrl(fallbackOrigin)}/api/podcast/trending/artwork/${briefId}`
    : `${getPodcastSiteUrl(fallbackOrigin)}/api/podcast/trending/artwork`;

export const getTrendingPodcastItemArtworkUrl = (
  {
    artworkUrl,
    artworkItems,
    imageUrls,
    briefId,
  }: {
    artworkUrl?: string | null;
    artworkItems?: { title: string; imageUrl: string }[] | null;
    imageUrls?: string[] | null;
    briefId?: string | null;
  },
  fallbackOrigin?: string,
): string => {
  if (briefId?.trim()) {
    return getTrendingPodcastEpisodeArtworkUrl(fallbackOrigin, briefId);
  }

  return (
    artworkUrl?.trim() ||
    artworkItems
      ?.find((item) => Boolean(item.imageUrl?.trim()))
      ?.imageUrl.trim() ||
    imageUrls?.find((value) => Boolean(value?.trim()))?.trim() ||
    getTrendingPodcastEpisodeArtworkUrl(fallbackOrigin, briefId)
  );
};

export const FEATURED_PODCAST_TITLE =
  "Wikipedia Featured Articles Presented by Curio Garden";

export const FEATURED_PODCAST_SUBTITLE =
  "Daily audio editions of Wikipedia's featured article.";

export const FEATURED_PODCAST_DESCRIPTION =
  "Daily audio editions of Wikipedia's featured article, presented by Curio Garden. Article content is sourced from Wikipedia and available under CC BY-SA 4.0. Wikipedia is a trademark of the Wikimedia Foundation.";

export const TRENDING_PODCAST_TITLE =
  "Wikipedia Trending Brief Presented by Curio Garden";

export const TRENDING_PODCAST_SUBTITLE =
  "A daily audio briefing on what is trending across Wikipedia and why.";

export const TRENDING_PODCAST_DESCRIPTION =
  "A daily audio briefing on what is trending across Wikipedia and why, presented by Curio Garden. Wikipedia topic lists are sourced from Wikimedia's public feeds, and linked reporting is summarized to explain likely trend drivers.";
