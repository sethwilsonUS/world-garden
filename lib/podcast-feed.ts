export const getPodcastDescription = (text: string | null | undefined): string => {
  if (!text) return "";

  const normalized = text
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((part) => part.trim())
    .find(Boolean);

  return normalized ?? text.trim();
};

export const getPodcastSiteUrl = (fallbackOrigin?: string): string =>
  (process.env.NEXT_PUBLIC_SITE_URL || fallbackOrigin || "http://localhost:3000").replace(/\/$/, "");

export const FEATURED_PODCAST_TITLE =
  "Wikipedia Featured Articles Presented by Curio Garden";

export const FEATURED_PODCAST_SUBTITLE =
  "Daily audio editions of Wikipedia's featured article.";

export const FEATURED_PODCAST_DESCRIPTION =
  "Daily audio editions of Wikipedia's featured article, presented by Curio Garden. Article content is sourced from Wikipedia and available under CC BY-SA 4.0. Wikipedia is a trademark of the Wikimedia Foundation.";
