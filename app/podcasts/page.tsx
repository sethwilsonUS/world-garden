import Link from "next/link";
import { PodcastFeedActions } from "@/components/PodcastFeedActions";
import { PodcastEpisodeArtwork } from "@/components/PodcastEpisodeArtwork";
import {
  PODCAST_DIRECTORY,
  getAbsoluteFeedUrl,
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

const PodcastOverviewCard = ({
  badge,
  title,
  description,
  feedUrl,
  syncRoute,
  slug,
}: {
  badge: string;
  title: string;
  description: string;
  feedUrl: string;
  syncRoute: string;
  slug: string;
}) => (
  <section className="garden-bed p-5 sm:p-6">
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

    <h2 className="font-display text-[1.5rem] sm:text-[1.8rem] font-semibold text-foreground leading-[1.12]">
      {title}
    </h2>

    <p className="text-[1rem] leading-[1.75] text-foreground-2 mt-3">
      {description}
    </p>

    <div className="mt-5">
      <p className="text-xs uppercase tracking-[0.18em] text-muted font-semibold mb-3">
        Feed URL
      </p>
      <code
        aria-label={`${title} feed URL`}
        className="block overflow-x-auto rounded-xl bg-surface-2 border border-border px-4 py-3 text-sm text-foreground"
      >
        {feedUrl}
      </code>
      <PodcastFeedActions feedUrl={feedUrl} feedTitle={title} />
      <p className="text-sm text-muted mt-3 leading-[1.6]">
        For local testing, generate the latest episode first with an authorized{" "}
        <code>{syncRoute}</code>, then subscribe using this RSS URL.
      </p>
    </div>

    <div className="mt-5">
      <Link href={`/podcasts/${slug}`} className="btn-secondary text-sm no-underline">
        View full archive
      </Link>
    </div>
  </section>
);

export default async function PodcastsPage() {
  const [featuredEpisodes, trendingEpisodes] = await Promise.all([
    getFeaturedEpisodes(5),
    getTrendingEpisodes(5),
  ]);

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
            {PODCAST_DIRECTORY.map((entry) => (
              <PodcastOverviewCard
                key={entry.slug}
                {...entry}
                feedUrl={getAbsoluteFeedUrl(entry.feedPath)}
              />
            ))}
          </div>

          <div className="mt-10 space-y-8">
            <section aria-labelledby="featured-preview-heading">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2
                  id="featured-preview-heading"
                  className="font-display text-[1.35rem] font-semibold text-foreground"
                >
                  Recent featured article episodes
                </h2>
                <Link
                  href="/podcasts/featured"
                  className="text-sm text-accent no-underline"
                  aria-label="View all featured article podcast episodes"
                >
                  View all
                </Link>
              </div>

              <ul className="list-none p-0 m-0 space-y-3" role="list">
                {featuredEpisodes.map((episode) => {
                  const description = getFeaturedEpisodeSummary(episode);
                  return (
                    <li key={episode._id}>
                      <div className="garden-bed p-5">
                        <PodcastEpisodeArtwork
                          src={getFeaturedEpisodeArtworkUrl(episode)}
                          alt={`Artwork for ${episode.title}`}
                        />
                        <div className="flex flex-wrap gap-2 mb-4">
                          <Link
                            href={`/article/${encodeURIComponent(episode.slug)}`}
                            className="btn-secondary text-sm no-underline"
                            aria-label={`View the Wikipedia article for ${episode.title}`}
                          >
                            View article
                          </Link>
                          <a
                            href={`/api/podcast/media/${episode._id}`}
                            className="btn-primary text-sm no-underline"
                            aria-label={`Open the podcast audio file for ${episode.title}`}
                          >
                            Audio URL
                          </a>
                        </div>

                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-muted font-semibold mb-2">
                            {formatPodcastDate(episode.publishedAt)}
                          </p>
                          <h3 className="font-display text-[1.08rem] font-semibold text-foreground leading-[1.25]">
                            {episode.title}
                          </h3>
                          {description && (
                            <p className="text-sm text-muted mt-2 leading-[1.7]">
                              {description}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section aria-labelledby="trending-preview-heading">
              <div className="flex items-center justify-between gap-3 mb-4">
                <h2
                  id="trending-preview-heading"
                  className="font-display text-[1.35rem] font-semibold text-foreground"
                >
                  Recent trending brief episodes
                </h2>
                <Link
                  href="/podcasts/trending"
                  className="text-sm text-accent no-underline"
                  aria-label="View all trending brief podcast episodes"
                >
                  View all
                </Link>
              </div>

              <ul className="list-none p-0 m-0 space-y-3" role="list">
                {trendingEpisodes.map((episode) => {
                  const title = getTrendingEpisodeTitle(episode);
                  const description = getTrendingEpisodeSummary(episode);
                  return (
                    <li key={episode._id}>
                      <div className="garden-bed p-5">
                        <PodcastEpisodeArtwork
                          src={getTrendingEpisodeArtworkUrl(episode)}
                          alt={`Artwork for ${title}`}
                        />
                        <div className="flex flex-wrap gap-2 mb-4">
                          <Link
                            href="/trending"
                            className="btn-secondary text-sm no-underline"
                            aria-label={`Open the trending page for ${title}`}
                          >
                            Open trending
                          </Link>
                          <a
                            href={`/api/podcast/media/trending/${episode._id}`}
                            className="btn-primary text-sm no-underline"
                            aria-label={`Open the podcast audio file for ${title}`}
                          >
                            Audio URL
                          </a>
                        </div>

                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-muted font-semibold mb-2">
                            {formatTrendingDate(episode.trendingDate)}
                          </p>
                          <h3 className="font-display text-[1.08rem] font-semibold text-foreground leading-[1.25]">
                            {title}
                          </h3>
                          {description && (
                            <p className="text-sm text-muted mt-2 leading-[1.7]">
                              {description}
                            </p>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
