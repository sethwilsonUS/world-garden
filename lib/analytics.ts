import { track } from "@vercel/analytics";

export const analytics = {
  playAll: (articleSlug: string, scope: "summary" | "full") =>
    track("Play All", { articleSlug, scope }),
  downloadAll: (articleSlug: string, scope: "summary" | "full") =>
    track("Download All", { articleSlug, scope }),
  search: (term: string) => track("Search", { term: term.slice(0, 255) }),
  playbackSpeed: (rate: string) => track("Playback Speed", { rate }),
};
