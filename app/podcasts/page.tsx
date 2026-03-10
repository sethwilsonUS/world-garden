import Link from "next/link";
import type { ReactNode } from "react";
import { AudioDownloadButton } from "@/components/AudioDownloadButton";
import { PodcastFeedPanel } from "@/components/PodcastFeedPanel";
import { PodcastEpisodeCard } from "@/components/PodcastEpisodeCard";
import {
  getAbsoluteFeedUrl,
  getPodcastDirectoryEntry,
  getFeaturedEpisodeArtworkUrl,
  getFeaturedEpisodeSummary,
  getFeaturedEpisodes,
  getTrendingEpisodeArtworkUrl,
  getTrendingEpisodeSummary,
  getTrendingEpisodeTitle,
  getTrendingEpisodes,
  formatPodcastDate,
  formatTrendingDate,
} from "@/lib/podcast-directory";

const PodcastAccordionSection = ({
  accordionId,
  badge,
  title,
  description,
  feedUrl,
  syncRoute,
  slug,
  children,
}: {
  accordionId: string;
  badge: string;
  title: string;
  description: string;
  feedUrl: string;
  syncRoute: string;
  slug: string;
  children: ReactNode;
}) => (
  <section aria-labelledby={`${accordionId}-heading`}>
    <details open className="garden-bed p-5 sm:p-6 group">
      <summary className="list-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
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
              {badge}
            </div>

            <h2
              id={`${accordionId}-heading`}
              className="font-display text-[1.5rem] sm:text-[1.8rem] font-semibold text-foreground leading-[1.12]"
            >
              {title}
            </h2>

            <p className="text-[1rem] leading-[1.75] text-foreground-2 mt-3">
              {description}
            </p>
          </div>

          <span
            aria-hidden="true"
            className="mt-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-foreground transition-transform duration-200 group-open:rotate-180"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={18}
              height={18}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </div>
      </summary>

      <div className="mt-8 space-y-8">
        <section aria-labelledby={`${accordionId}-episodes-heading`}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3
              id={`${accordionId}-episodes-heading`}
              className="font-display text-[1.2rem] font-semibold text-foreground"
            >
              Recent episodes
            </h3>
            <Link
              href={`/podcasts/${slug}`}
              className="text-sm text-accent no-underline"
              aria-label={`View all episodes for ${title}`}
            >
              View full archive
            </Link>
          </div>
          {children}
        </section>

        <PodcastFeedPanel
          idBase={`${accordionId}-feed`}
          title={title}
          feedUrl={feedUrl}
          syncRoute={syncRoute}
        />
      </div>
    </details>
  </section>
);

export default async function PodcastsPage() {
  const [featuredEpisodes, trendingEpisodes] = await Promise.all([
    getFeaturedEpisodes(5),
    getTrendingEpisodes(5),
  ]);
  const featuredEntry = getPodcastDirectoryEntry("featured");
  const trendingEntry = getPodcastDirectoryEntry("trending");

  if (!featuredEntry || !trendingEntry) {
    throw new Error("Podcast directory entries are not configured");
  }

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-4xl mx-auto">
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

        <section aria-labelledby="podcasts-heading">
          <h1
            id="podcasts-heading"
            className="font-display text-[2rem] sm:text-[2.45rem] font-bold mb-4 text-foreground leading-[1.05]"
          >
            Podcasts
          </h1>

          <p className="text-[1.04rem] leading-[1.78] text-foreground-2 max-w-3xl">
            Curio Garden publishes multiple public podcast feeds. One turns
            Wikipedia&apos;s featured article into a full listening session. The
            other is a daily audio briefing on what is trending across Wikipedia
            and why.
          </p>

          <div className="mt-8 space-y-6">
            <PodcastAccordionSection
              accordionId="featured-podcast"
              {...featuredEntry}
              feedUrl={getAbsoluteFeedUrl(featuredEntry.feedPath)}
            >
              <ul className="list-none p-0 m-0 space-y-3" role="list">
                {featuredEpisodes.map((episode) => {
                  const description = getFeaturedEpisodeSummary(episode);
                  return (
                    <li key={episode._id}>
                      <PodcastEpisodeCard
                        artworkSrc={getFeaturedEpisodeArtworkUrl(episode)}
                        artworkAlt={`Artwork for ${episode.title}`}
                        audioUrl={episode.audioUrl}
                        durationSeconds={episode.durationSeconds}
                        title={episode.title}
                        dateLabel={formatPodcastDate(episode.publishedAt)}
                        summary={description}
                        actions={
                          <>
                            <Link
                              href={`/article/${encodeURIComponent(episode.slug)}`}
                              className="btn-secondary text-sm no-underline"
                              aria-label={`View the Wikipedia article for ${episode.title}`}
                            >
                              View article
                            </Link>
                            <AudioDownloadButton
                              href={`/api/podcast/media/${episode._id}?download=1`}
                              ariaLabel={`Download the podcast audio for ${episode.title}`}
                              label="Download"
                              className="no-underline"
                            />
                          </>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </PodcastAccordionSection>

            <PodcastAccordionSection
              accordionId="trending-podcast"
              {...trendingEntry}
              feedUrl={getAbsoluteFeedUrl(trendingEntry.feedPath)}
            >
              <ul className="list-none p-0 m-0 space-y-3" role="list">
                {trendingEpisodes.map((episode) => {
                  const title = getTrendingEpisodeTitle(episode);
                  const description = getTrendingEpisodeSummary(episode);
                  return (
                    <li key={episode._id}>
                      <PodcastEpisodeCard
                        artworkSrc={getTrendingEpisodeArtworkUrl(episode)}
                        artworkAlt={`Artwork for ${title}`}
                        audioUrl={episode.audioUrl}
                        durationSeconds={episode.durationSeconds}
                        title={title}
                        dateLabel={formatTrendingDate(episode.trendingDate)}
                        summary={description}
                        actions={
                          <>
                            <Link
                              href="/trending"
                              className="btn-secondary text-sm no-underline"
                              aria-label={`Open the trending page for ${title}`}
                            >
                              Open trending
                            </Link>
                            <AudioDownloadButton
                              href={`/api/podcast/media/trending/${episode._id}?download=1`}
                              ariaLabel={`Download the podcast audio for ${title}`}
                              label="Download"
                              className="no-underline"
                            />
                          </>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </PodcastAccordionSection>
          </div>
        </section>
      </div>
    </div>
  );
}
