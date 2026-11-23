import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AudioDownloadButton } from "@/components/AudioDownloadButton";
import { ArticleLink } from "@/components/ArticleLink";
import { PodcastFeedPanel } from "@/components/PodcastFeedPanel";
import { PodcastEpisodeCard } from "@/components/PodcastEpisodeCard";
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
  getTrendingEpisodeDateLabel,
} from "@/lib/podcast-directory";

type PodcastDetailPageProps = {
  params: Promise<{ slug: string }>;
};

const podcastMetadata = {
  featured: {
    title: "Wikipedia Featured Article Podcast — Curio Garden",
    description:
      "Listen to daily audio editions of Wikipedia's featured article, with recent episodes and a public podcast feed from Curio Garden.",
  },
  trending: {
    title: "Wikipedia Trending Podcast — Curio Garden",
    description:
      "Hear Curio Garden's AI-generated daily audio briefing about trending Wikipedia topics, with recent episodes and a public podcast feed.",
  },
} as const;

export async function generateMetadata({
  params,
}: PodcastDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const entry = getPodcastDirectoryEntry(slug);

  if (!entry) {
    return {
      title: "Podcast not found — Curio Garden",
      robots: { index: false, follow: false },
    };
  }

  const routeMetadata = podcastMetadata[entry.slug];
  const canonicalPath = `/podcasts/${entry.slug}`;

  return {
    ...routeMetadata,
    alternates: { canonical: canonicalPath },
    openGraph: {
      ...routeMetadata,
      type: "website",
      siteName: "Curio Garden",
      url: canonicalPath,
    },
  };
}

export default async function PodcastDetailPage({
  params,
}: PodcastDetailPageProps) {
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
        <nav aria-label="Breadcrumb" className="mb-3">
          <ol className="m-0 flex list-none flex-wrap items-center gap-x-2 p-0 text-sm text-muted">
            <li>
              <Link
                href="/podcasts"
                className="inline-flex min-h-[44px] items-center text-accent underline"
              >
                Podcasts
              </Link>
            </li>
            <li aria-hidden="true">›</li>
            <li>
              <span aria-current="page" className="[overflow-wrap:anywhere]">
                {entry.slug === "featured" ? "Featured articles" : "Trending brief"}
              </span>
            </li>
          </ol>
        </nav>

        <section aria-labelledby="podcast-detail-heading">
          <h1
            id="podcast-detail-heading"
            className="type-page-title font-display text-[1.75rem] font-bold text-foreground [overflow-wrap:anywhere]"
          >
            {entry.title}
          </h1>
          <p className="mt-1 text-sm font-medium text-accent">{entry.badge}</p>
          <p className="mt-2 max-w-3xl text-base leading-[1.7] text-foreground-2">
            {entry.description}
          </p>

          <div className="mt-6">
            <PodcastFeedPanel
              headingLevel={2}
              idBase={`${entry.slug}-podcast-follow`}
              title={entry.title}
              feedUrl={feedUrl}
            />
          </div>

          <div className="mt-8">
            <h2 className="type-section-title font-display text-[1.35rem] font-semibold text-foreground mb-4">
              Archived episodes
            </h2>

            {entry.slug === "featured" ? (
              !featuredEpisodes || featuredEpisodes.length === 0 ? (
                <div
                  className="garden-bed text-center py-12 px-6"
                  role="status"
                >
                  <p className="font-display font-semibold text-lg text-foreground">
                    No episodes generated yet
                  </p>
                  <p className="text-muted text-sm mt-2">
                    The first published episode will appear here automatically.
                  </p>
                </div>
              ) : (
                <ul className="list-none p-0 m-0 space-y-2" role="list">
                  {featuredEpisodes.map((featuredEpisode) => {
                    const description =
                      getFeaturedEpisodeSummary(featuredEpisode);

                    return (
                      <li key={featuredEpisode._id}>
                        <PodcastEpisodeCard
                          headingId={`featured-episode-${featuredEpisode._id}`}
                          artworkSrc={getFeaturedEpisodeArtworkUrl(
                            featuredEpisode,
                          )}
                          audioUrl={featuredEpisode.audioUrl}
                          durationSeconds={featuredEpisode.durationSeconds}
                          title={featuredEpisode.title}
                          dateLabel={formatPodcastDate(
                            featuredEpisode.publishedAt,
                          )}
                          summary={description}
                          actions={
                            <>
                              <ArticleLink
                                articleTitle={featuredEpisode.title}
                                href={`/article/${encodeURIComponent(featuredEpisode.slug)}`}
                                className="btn-secondary text-sm no-underline"
                                aria-label={`View article: ${featuredEpisode.title}`}
                              >
                                View article
                              </ArticleLink>
                              <AudioDownloadButton
                                href={`/api/podcast/media/${featuredEpisode._id}?download=1`}
                                ariaLabel={`Download audio for ${featuredEpisode.title}`}
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
              )
            ) : !trendingEpisodes || trendingEpisodes.length === 0 ? (
              <div className="garden-bed text-center py-12 px-6" role="status">
                <p className="font-display font-semibold text-lg text-foreground">
                  No episodes generated yet
                </p>
                <p className="text-muted text-sm mt-2">
                  The first published episode will appear here automatically.
                </p>
              </div>
            ) : (
              <ul className="list-none p-0 m-0 space-y-2" role="list">
                {trendingEpisodes.map((trendingEpisode) => {
                  const title = getTrendingEpisodeTitle(trendingEpisode);
                  const description =
                    getTrendingEpisodeSummary(trendingEpisode);

                  return (
                    <li key={trendingEpisode._id}>
                      <PodcastEpisodeCard
                        headingId={`trending-episode-${trendingEpisode._id}`}
                        artworkSrc={getTrendingEpisodeArtworkUrl(
                          trendingEpisode,
                        )}
                        audioUrl={trendingEpisode.audioUrl}
                        durationSeconds={trendingEpisode.durationSeconds}
                        title={title}
                        dateLabel={getTrendingEpisodeDateLabel(trendingEpisode)}
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
                              href={`/api/podcast/media/trending/${trendingEpisode._id}?download=1`}
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
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
