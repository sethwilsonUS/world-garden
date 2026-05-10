import { track } from "@vercel/analytics";
import type {
  AudioStartupPath,
  AudioStartupScope,
  AudioStartupSource,
} from "@/lib/audio-startup";
import type { TtsProvider } from "@/lib/tts-profile";

export const analytics = {
  playAll: (scope: "summary" | "full") => track("Play All", { scope }),
  downloadAll: (scope: "summary" | "full") =>
    track("Download All", { scope }),
  playbackSpeed: (rate: string) => track("Playback Speed", { rate }),
  listenSection: () => track("Section Listened"),
  searchResultsLoaded: () => track("Search Results Loaded"),
  searchResultClicked: () => track("Search Result Clicked"),
  articleBookmarked: () => track("Article Bookmarked"),
  dashboardPageAccessed: () => track("Dashboard Page Accessed"),
  libraryPageAccessed: () => track("Library Page Accessed"),
  featuredArticleAccessed: () => track("Featured Article Accessed"),
  trendingPageAccessed: () => track("Trending Page Accessed"),
  trendingArticleViewed: (source?: "curious" | "trending_page") =>
    track("Trending Article Viewed", source ? { source } : {}),
  audioStartup: ({
    scope,
    source,
    path,
    provider,
    fallback,
    timing,
  }: {
    scope: AudioStartupScope;
    source: AudioStartupSource;
    path: AudioStartupPath;
    provider: TtsProvider;
    fallback: boolean;
    timing: string;
  }) =>
    track("Audio Startup", {
      scope,
      source,
      path,
      provider,
      fallback,
      timing,
    }),
};
