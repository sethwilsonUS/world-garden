import Link from "next/link";
import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  FEATURED_PODCAST_DESCRIPTION,
  FEATURED_PODCAST_TITLE,
  getPodcastDescription,
  getPodcastSiteUrl,
} from "@/lib/podcast-feed";

type FeaturedPodcastEpisode = Doc<"featuredPodcastEpisodes"> & {
  audioUrl: string | null;
};

const formatDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export default async function PodcastPage() {
  const siteUrl = getPodcastSiteUrl();
  const feedUrl = `${siteUrl}/api/podcast/featured.xml`;
  const episodes = (await fetchQuery(anyApi.podcast.getRecentFeaturedEpisodes, {
    status: "ready",
    limit: 12,
  })) as FeaturedPodcastEpisode[];

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-3xl mx-auto">
        <nav aria-label="Back navigation" className="mb-5">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-muted text-sm no-underline"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={14}
              height={14}
              aria-hidden="true"
            >
              <path d="M15 19l-7-7 7-7" />
            </svg>
            Back to home
          </Link>
        </nav>

        <section aria-labelledby="podcast-heading">
          <div className="inline-flex items-center gap-2 py-[6px] px-3.5 rounded-full bg-accent-bg border border-accent-border mb-5 text-[0.8125rem] text-accent font-semibold tracking-[0.01em]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={15}
              height={15}
              aria-hidden="true"
            >
              <path d="M12 3a6 6 0 0 0-6 6v3a6 6 0 1 0 12 0V9a6 6 0 0 0-6-6Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <path d="M12 19v3" />
            </svg>
            Public podcast feed
          </div>

          <h1
            id="podcast-heading"
            className="font-display text-[1.9rem] sm:text-[2.3rem] font-bold mb-4 text-foreground leading-[1.1]"
          >
            {FEATURED_PODCAST_TITLE}
          </h1>

          <p className="text-[1.02rem] leading-[1.75] text-foreground-2 max-w-2xl">
            {FEATURED_PODCAST_DESCRIPTION}
          </p>

          <div className="garden-bed p-5 mt-6">
            <p className="text-xs uppercase tracking-[0.18em] text-muted font-semibold mb-3">
              Feed URL
            </p>
            <code className="block overflow-x-auto rounded-xl bg-surface-2 border border-border px-4 py-3 text-sm text-foreground">
              {feedUrl}
            </code>
            <p className="text-sm text-muted mt-3 leading-[1.6]">
              For local testing, generate the latest episode first with an
              authorized
              {" "}
              <code>POST /api/podcast/featured/sync</code>
              , then subscribe using this RSS URL.
            </p>
          </div>

          <div className="garden-bed p-5 mt-5">
            <p className="text-xs uppercase tracking-[0.18em] text-muted font-semibold mb-3">
              What podcast apps will see
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
                <p className="text-sm font-semibold text-foreground">Feed</p>
                <p className="text-sm text-muted mt-1 leading-[1.6]">
                  <code>/api/podcast/featured.xml</code>
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
                <p className="text-sm font-semibold text-foreground">Episodes</p>
                <p className="text-sm text-muted mt-1 leading-[1.6]">
                  One item per featured article date
                </p>
              </div>
              <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
                <p className="text-sm font-semibold text-foreground">Audio</p>
                <p className="text-sm text-muted mt-1 leading-[1.6]">
                  Stable enclosure URLs that redirect to stored MP3s
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <h2 className="font-display text-[1.35rem] font-semibold text-foreground mb-4">
              Recent episodes
            </h2>

            {episodes.length === 0 ? (
              <div className="garden-bed text-center py-12 px-6" role="status">
                <p className="font-display font-semibold text-lg text-foreground">
                  No episodes generated yet
                </p>
                <p className="text-muted text-sm mt-2">
                  Run the manual sync route once and the latest featured article
                  episode will appear here.
                </p>
              </div>
            ) : (
              <ul className="list-none p-0 m-0 space-y-3" role="list">
                {episodes.map((episode) => {
                  const description = getPodcastDescription(episode.description);
                  return (
                    <li key={episode._id}>
                      <div className="garden-bed p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-xs uppercase tracking-[0.14em] text-muted font-semibold mb-2">
                              {formatDate(episode.publishedAt)}
                            </p>
                            <h3 className="font-display text-[1.15rem] font-semibold text-foreground leading-[1.25]">
                              {episode.title}
                            </h3>
                            {description && (
                              <p className="text-sm text-muted mt-2 leading-[1.7]">
                                {description}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2 shrink-0">
                            <Link
                              href={`/article/${encodeURIComponent(episode.slug)}`}
                              className="btn-secondary text-sm no-underline"
                            >
                              View article
                            </Link>
                            <a
                              href={`/api/podcast/media/${episode._id}`}
                              className="btn-primary text-sm no-underline"
                            >
                              Audio URL
                            </a>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
