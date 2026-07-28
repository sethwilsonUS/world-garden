export const PERSONAL_PODCAST_CACHE_CONTROL = "private, no-store, max-age=0";

export const PERSONAL_PODCAST_PRIVATE_HEADERS = {
  "Cache-Control": PERSONAL_PODCAST_CACHE_CONTROL,
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export const applyPersonalPodcastPrivateHeaders = (headers: Headers): void => {
  for (const [name, value] of Object.entries(
    PERSONAL_PODCAST_PRIVATE_HEADERS,
  )) {
    headers.set(name, value);
  }
};
