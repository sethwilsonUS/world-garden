import { track } from "@vercel/analytics";

export const analytics = {
  playAll: (articleSlug: string, scope: "summary" | "full") =>
    track("Play All", { articleSlug, scope }),
  downloadAll: (articleSlug: string, scope: "summary" | "full") =>
    track("Download All", { articleSlug, scope }),
  playbackSpeed: (rate: string) => track("Playback Speed", { rate }),
  listenSection: () => track("Listen Section"),
  searchResultsLoaded: () => track("Search Results Loaded"),
  searchResultClicked: () => track("Search Result Clicked"),
  articleBookmarked: () => track("Article Bookmarked"),
  libraryPageAccessed: () => track("Library Page Accessed"),
  featuredArticleAccessed: () => track("Featured Article Accessed"),
  trendingPageAccessed: () => track("Trending Page Accessed"),
  trendingArticleViewed: (source?: "curious" | "trending_page") =>
    track("Trending Article Viewed", source ? { source } : {}),
};
