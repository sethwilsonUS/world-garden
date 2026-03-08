import Link from "next/link";
import { notFound } from "next/navigation";
import { PodcastFeedActions } from "@/components/PodcastFeedActions";
import { PodcastEpisodeArtwork } from "@/components/PodcastEpisodeArtwork";
import {
  getAbsoluteFeedUrl,
  getFeaturedEpisodeArtworkUrl,
  getFeaturedEpisodeSummary,
  getFeaturedEpisodes,
  getPodcastDirectoryEntry,
  getTrendingEpisodeArtworkUrl,
  getTrendingEpisodeSummary,
  getTrendingEpisodeTitle,
  getTrendingEpisodes,
  formatPodcastDate,
  formatTrendingDate,
} from "@/lib/podcast-directory";

export default async function PodcastDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const entry = getPodcastDirectoryEntry(slug);

  if (!entry) {
    notFound();
  }

  const feedUrl = getAbsoluteFeedUrl(entry.feedPath);
  const featuredEpisodes =
    entry.slug === "featured" ? await getFeaturedEpisodes(24) : null;
  const trendingEpisodes =
    entry.slug === "trending" ? await getTrendingEpisodes(24) : null;

  return (
    <div className="container mx-auto px-4 pt-10 pb-20">
      <div className="max-w-4xl mx-auto">
        <nav aria-label="Back navigation" className="mb-5">
          <Link
            href="/podcasts"
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
            Back to podcasts
          </Link>
        </nav>

        <section aria-labelledby="podcast-detail-heading">
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
            {entry.badge}
          </div>

          <h1
            id="podcast-detail-heading"
            className="font-display text-[2rem] sm:text-[2.45rem] font-bold mb-4 text-foreground leading-[1.05]"
          >
            {entry.title}
          </h1>

          <p className="text-[1.04rem] leading-[1.78] text-foreground-2 max-w-3xl">
            {entry.description}
          </p>

          <div className="garden-bed p-5 sm:p-6 mt-6">
            <p className="text-xs uppercase tracking-[0.18em] text-muted font-semibold mb-3">
              Feed URL
            </p>
            <code
              aria-label={`${entry.title} feed URL`}
              className="block overflow-x-auto rounded-xl bg-surface-2 border border-border px-4 py-3 text-sm text-foreground"
            >
              {feedUrl}
            </code>
            <PodcastFeedActions feedUrl={feedUrl} feedTitle={entry.title} />
            <p className="text-sm text-muted mt-3 leading-[1.6]">
              For local testing, generate the latest episode first with an authorized{" "}
              <code>{entry.syncRoute}</code>, then subscribe using this RSS URL.
            </p>
          </div>

          <div className="mt-8">
            <h2 className="font-display text-[1.35rem] font-semibold text-foreground mb-4">
              Recent episodes
            </h2>

            {entry.slug === "featured" ? (
              !featuredEpisodes || featuredEpisodes.length === 0 ? (
              <div className="garden-bed text-center py-12 px-6" role="status">
                <p className="font-display font-semibold text-lg text-foreground">
                  No episodes generated yet
                </p>
                <p className="text-muted text-sm mt-2">
                  Run the sync route once and the latest episode will appear here.
                </p>
              </div>
            ) : (
              <ul className="list-none p-0 m-0 space-y-3" role="list">
                {featuredEpisodes.map((featuredEpisode) => {
                  const description = getFeaturedEpisodeSummary(featuredEpisode);

                  return (
                    <li key={featuredEpisode._id}>
                      <div className="garden-bed p-5">
                        <PodcastEpisodeArtwork
                          src={getFeaturedEpisodeArtworkUrl(featuredEpisode)}
                          alt={`Artwork for ${featuredEpisode.title}`}
                        />
                        <div className="flex flex-wrap gap-2 mb-4">
                          <Link
                            href={`/article/${encodeURIComponent(featuredEpisode.slug)}`}
                            className="btn-secondary text-sm no-underline"
                            aria-label={`View the Wikipedia article for ${featuredEpisode.title}`}
                          >
                            View article
                          </Link>
                          <a
                            href={`/api/podcast/media/${featuredEpisode._id}`}
                            className="btn-primary text-sm no-underline"
                            aria-label={`Open the podcast audio file for ${featuredEpisode.title}`}
                          >
                            Audio URL
                          </a>
                        </div>

                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-muted font-semibold mb-2">
                            {formatPodcastDate(featuredEpisode.publishedAt)}
                          </p>
                          <h3 className="font-display text-[1.12rem] font-semibold text-foreground leading-[1.25]">
                            {featuredEpisode.title}
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
            )
            ) : !trendingEpisodes || trendingEpisodes.length === 0 ? (
              <div className="garden-bed text-center py-12 px-6" role="status">
                <p className="font-display font-semibold text-lg text-foreground">
                  No episodes generated yet
                </p>
                <p className="text-muted text-sm mt-2">
                  Run the sync route once and the latest episode will appear here.
                </p>
              </div>
            ) : (
              <ul className="list-none p-0 m-0 space-y-3" role="list">
                {trendingEpisodes.map((trendingEpisode) => {
                  const title = getTrendingEpisodeTitle(trendingEpisode);
                  const description = getTrendingEpisodeSummary(trendingEpisode);

                  return (
                    <li key={trendingEpisode._id}>
                      <div className="garden-bed p-5">
                        <PodcastEpisodeArtwork
                          src={getTrendingEpisodeArtworkUrl(trendingEpisode)}
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
                            href={`/api/podcast/media/trending/${trendingEpisode._id}`}
                            className="btn-primary text-sm no-underline"
                            aria-label={`Open the podcast audio file for ${title}`}
                          >
                            Audio URL
                          </a>
                        </div>

                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-muted font-semibold mb-2">
                            {formatTrendingDate(trendingEpisode.trendingDate)}
                          </p>
                          <h3 className="font-display text-[1.12rem] font-semibold text-foreground leading-[1.25]">
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
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
