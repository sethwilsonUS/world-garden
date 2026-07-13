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

export const getWikipediaEpisodeDescription = ({
  summary,
  wikiPageId,
  revisionId,
}: {
  summary: string;
  wikiPageId: string;
  revisionId?: string | null;
}): string => {
  const sourceUrl = revisionId
    ? `https://en.wikipedia.org/w/index.php?oldid=${encodeURIComponent(revisionId)}`
    : `https://en.wikipedia.org/wiki?curid=${encodeURIComponent(wikiPageId)}`;
  const revisionLabel = revisionId ? ` revision ${revisionId}` : " article";

  return `${summary}\n\nSource: Wikipedia${revisionLabel} (${sourceUrl}). Article text is available under CC BY-SA 4.0. Synthetic audio and presentation are provided by Curio Garden, an independent project not endorsed by or affiliated with the Wikimedia Foundation.`;
};

export const TRENDING_AI_DISCLOSURE =
  "AI disclosure: Curio Garden generated this briefing with OpenAI from Wikimedia pageview data and linked reporting. It was not written by Wikipedia and may contain errors.";

export const TRENDING_PODCAST_AI_DISCLOSURE =
  "AI disclosure: This podcast contains daily briefings generated with OpenAI from Wikimedia pageview data and linked reporting. Episodes were not written by Wikipedia and may contain errors.";

export const TRENDING_AI_AUDIO_DISCLOSURE =
  "AI disclosure. Curio Garden generated this briefing with OpenAI from Wikimedia pageview data and linked reporting, and it may contain errors.";

export const getTrendingEpisodeDescription = (summary: string): string =>
  `${summary}\n\n${TRENDING_AI_DISCLOSURE} Curio Garden is not endorsed by or affiliated with the Wikimedia Foundation.`;

export const getPodcastSiteUrl = (fallbackOrigin?: string): string =>
  (process.env.NEXT_PUBLIC_SITE_URL || fallbackOrigin || "http://localhost:3000").replace(/\/$/, "");

export const FEATURED_SHOW_ARTWORK_VERSION = 1;
export const TRENDING_SHOW_ARTWORK_VERSION = 2;
export const PERSONAL_SHOW_ARTWORK_VERSION = 1;

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
  artworkUrl?.trim() ||
  imageUrl?.trim() ||
  (episodeId?.trim()
    ? getFeaturedPodcastEpisodeArtworkUrl(fallbackOrigin, episodeId)
    : getPodcastArtworkUrl(fallbackOrigin));

export const getTrendingPodcastShowArtworkUrl = (
  fallbackOrigin?: string,
): string =>
  `${getPodcastSiteUrl(fallbackOrigin)}/api/podcast/trending/artwork?v=${TRENDING_SHOW_ARTWORK_VERSION}`;

export const getPersonalPodcastShowArtworkUrl = (
  fallbackOrigin?: string,
): string =>
  `${getPodcastSiteUrl(fallbackOrigin)}/api/podcast/personal/artwork?v=${PERSONAL_SHOW_ARTWORK_VERSION}`;

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
  return (
    artworkUrl?.trim() ||
    artworkItems
      ?.find((item) => Boolean(item.imageUrl?.trim()))
      ?.imageUrl.trim() ||
    imageUrls?.find((value) => Boolean(value?.trim()))?.trim() ||
    (briefId?.trim()
      ? getTrendingPodcastEpisodeArtworkUrl(fallbackOrigin, briefId)
      : getTrendingPodcastShowArtworkUrl(fallbackOrigin))
  );
};

export const FEATURED_PODCAST_TITLE =
  "Wikipedia Featured Articles Presented by Curio Garden";

export const FEATURED_PODCAST_SUBTITLE =
  "Daily audio editions of Wikipedia's featured article.";

export const FEATURED_PODCAST_DESCRIPTION =
  "Daily audio editions of Wikipedia's featured article, presented by Curio Garden. Article content is sourced from Wikipedia and available under CC BY-SA 4.0. Curio Garden is an independent project not endorsed by or affiliated with the Wikimedia Foundation. Wikipedia is a trademark of the Wikimedia Foundation.";

export const TRENDING_PODCAST_TITLE =
  "AI-Generated Wikipedia Trending Brief Presented by Curio Garden";

export const TRENDING_PODCAST_SUBTITLE =
  "An AI-generated daily audio briefing on what is trending across Wikipedia and why.";

export const TRENDING_PODCAST_DESCRIPTION =
  "An AI-generated daily audio briefing on what is trending across Wikipedia and why, presented by Curio Garden. Topic lists come from Wikimedia's public pageview data, and linked reporting is summarized to explain likely trend drivers. Curio Garden is not endorsed by or affiliated with the Wikimedia Foundation.";

export const PERSONAL_PODCAST_TITLE =
  "Curio Garden Personal Playlist";

export const PERSONAL_PODCAST_SUBTITLE =
  "Your personal queue of Wikipedia articles, ready for any podcast app.";

export const PERSONAL_PODCAST_DESCRIPTION =
  "A personal RSS feed of queued Wikipedia article episodes generated by Curio Garden. Articles are sourced from Wikipedia and available under CC BY-SA 4.0. Curio Garden is not endorsed by or affiliated with the Wikimedia Foundation.";
