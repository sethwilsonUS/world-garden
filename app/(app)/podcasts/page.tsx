import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AudioDownloadButton } from "@/components/AudioDownloadButton";
import { ArticleLink } from "@/components/ArticleLink";
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
  getTrendingEpisodeDateLabel,
} from "@/lib/podcast-directory";

const title = "Wikipedia Audio Podcasts — Curio Garden";
const description =
  "Listen to Curio Garden's public podcasts: daily Wikipedia featured articles and an AI-generated briefing about today's trending topics.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/podcasts" },
  openGraph: {
    title,
    description,
    type: "website",
    siteName: "Curio Garden",
    url: "/podcasts",
  },
};

const PodcastFeedSection = ({
  sectionId,
  badge,
  title,
  description,
  feedUrl,
  slug,
  children,
}: {
  sectionId: string;
  badge: string;
  title: string;
  description: string;
  feedUrl: string;
  slug: string;
  children: ReactNode;
}) => (
  <section
    id={sectionId}
    aria-labelledby={`${sectionId}-heading`}
    className="garden-bed scroll-mt-24 p-5 sm:p-6"
  >
    <h2
      id={`${sectionId}-heading`}
      className="type-section-title-lg font-display text-[1.5rem] sm:text-[1.75rem] font-semibold text-foreground leading-[1.15] [overflow-wrap:anywhere]"
    >
      {title}
    </h2>
    <p className="mt-1 text-sm font-medium text-accent">{badge}</p>
    <p className="mt-3 text-base leading-[1.7] text-foreground-2">
      {description}
    </p>

    {/* Subscribe first: most visitors come here to follow a feed. */}
    <div className="mt-5">
      <PodcastFeedPanel
        idBase={`${sectionId}-feed`}
        title={title}
        feedUrl={feedUrl}
      />
    </div>

    <section aria-labelledby={`${sectionId}-episodes-heading`} className="mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3">
        <h3
          id={`${sectionId}-episodes-heading`}
          className="font-display text-[1.125rem] font-semibold text-foreground"
        >
          Recent episodes
        </h3>
        <Link
          href={`/podcasts/${slug}`}
          className="inline-flex min-h-[44px] max-w-full items-center text-sm text-accent underline"
          aria-label={`View full archive of ${title}`}
        >
          View full archive
        </Link>
      </div>
      {children}
    </section>
  </section>
);

const RECENT_EPISODE_COUNT = 3;

export default async function PodcastsPage() {
  const [featuredEpisodes, trendingEpisodes] = await Promise.all([
    getFeaturedEpisodes(RECENT_EPISODE_COUNT),
    getTrendingEpisodes(RECENT_EPISODE_COUNT),
  ]);
  const featuredEntry = getPodcastDirectoryEntry("featured");
  const trendingEntry = getPodcastDirectoryEntry("trending");

  if (!featuredEntry || !trendingEntry) {
    throw new Error("Podcast directory entries are not configured");
  }

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-4xl mx-auto">
        <section aria-labelledby="podcasts-heading">
          <h1
            id="podcasts-heading"
            className="type-page-title font-display text-[1.75rem] font-bold text-foreground"
          >
            Podcasts
          </h1>
          <p className="mt-1 max-w-3xl text-base leading-[1.6] text-foreground-2">
            Two free feeds: Wikipedia&apos;s featured article as a full
            listening session, and a daily AI briefing on what&apos;s trending.
          </p>

          <nav aria-label="Podcast feeds" className="mt-4">
            <ul className="m-0 flex list-none flex-wrap gap-x-5 p-0">
              <li>
                <a
                  href="#featured-podcast"
                  className="inline-flex min-h-[44px] items-center text-sm text-accent underline"
                >
                  {featuredEntry.title}
                </a>
              </li>
              <li>
                <a
                  href="#trending-podcast"
                  className="inline-flex min-h-[44px] items-center text-sm text-accent underline"
                >
                  {trendingEntry.title}
                </a>
              </li>
            </ul>
          </nav>

          <div className="mt-4 space-y-6">
            <PodcastFeedSection
              sectionId="featured-podcast"
              {...featuredEntry}
              feedUrl={getAbsoluteFeedUrl(featuredEntry.feedPath)}
            >
              <ul className="list-none p-0 m-0 space-y-2" role="list">
                {featuredEpisodes.map((episode) => {
                  const description = getFeaturedEpisodeSummary(episode);
                  return (
                    <li key={episode._id}>
                      <PodcastEpisodeCard
                        headingId={`featured-episode-${episode._id}`}
                        headingLevel={4}
                        compact
                        artworkSrc={getFeaturedEpisodeArtworkUrl(episode)}
                        audioUrl={episode.audioUrl}
                        durationSeconds={episode.durationSeconds}
                        title={episode.title}
                        dateLabel={formatPodcastDate(episode.publishedAt)}
                        summary={description}
                        actions={
                          <>
                            <ArticleLink
                              articleTitle={episode.title}
                              href={`/article/${encodeURIComponent(episode.slug)}`}
                              className="btn-secondary text-sm no-underline"
                              aria-label={`View article: ${episode.title}`}
                            >
                              View article
                            </ArticleLink>
                            <AudioDownloadButton
                              href={`/api/podcast/media/${episode._id}?download=1`}
                              ariaLabel={`Download audio for ${episode.title}`}
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
            </PodcastFeedSection>

            <PodcastFeedSection
              sectionId="trending-podcast"
              {...trendingEntry}
              feedUrl={getAbsoluteFeedUrl(trendingEntry.feedPath)}
            >
              <ul className="list-none p-0 m-0 space-y-2" role="list">
                {trendingEpisodes.map((episode) => {
                  const title = getTrendingEpisodeTitle(episode);
                  const description = getTrendingEpisodeSummary(episode);
                  return (
                    <li key={episode._id}>
                      <PodcastEpisodeCard
                        headingId={`trending-episode-${episode._id}`}
                        headingLevel={4}
                        compact
                        artworkSrc={getTrendingEpisodeArtworkUrl(episode)}
                        audioUrl={episode.audioUrl}
                        durationSeconds={episode.durationSeconds}
                        title={title}
                        dateLabel={getTrendingEpisodeDateLabel(episode)}
                        summary={description}
                        actions={
                          <>
                            <Link
                              href="/trending"
                              className="btn-secondary text-sm no-underline"
                              aria-label={`Open trending page for ${title}`}
                            >
                              Open trending
                            </Link>
                            <AudioDownloadButton
                              href={`/api/podcast/media/trending/${episode._id}?download=1`}
                              ariaLabel={`Download audio for ${title}`}
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
            </PodcastFeedSection>
          </div>
        </section>
      </div>
    </div>
  );
}
