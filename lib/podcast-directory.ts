import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  FEATURED_PODCAST_DESCRIPTION,
  FEATURED_PODCAST_TITLE,
  TRENDING_PODCAST_DESCRIPTION,
  TRENDING_PODCAST_TITLE,
  getPodcastDescription,
  getPodcastExcerpt,
  getPodcastSiteUrl,
} from "@/lib/podcast-feed";

export type FeaturedPodcastEpisode = Doc<"featuredPodcastEpisodes"> & {
  audioUrl: string | null;
  artworkUrl?: string | null;
};

export type TrendingPodcastEpisode = Doc<"trendingBriefs"> & {
  audioUrl: string | null;
  artworkUrl?: string | null;
};

export type PodcastDirectorySlug = "featured" | "trending";

export type PodcastDirectoryEntry = {
  slug: PodcastDirectorySlug;
  badge: string;
  title: string;
  description: string;
  feedPath: string;
  syncRoute: string;
  episodeLabel: string;
  audioLabel: string;
  browseHref: string;
  browseLabel: string;
};

export const PODCAST_DIRECTORY: PodcastDirectoryEntry[] = [
  {
    slug: "featured",
    badge: "Public podcast feed",
    title: FEATURED_PODCAST_TITLE,
    description: FEATURED_PODCAST_DESCRIPTION,
    feedPath: "/api/podcast/featured.xml",
    syncRoute: "POST /api/podcast/featured/sync",
    episodeLabel: "One item per featured article date",
    audioLabel: "Stable enclosure URLs that redirect to stored MP3s",
    browseHref: "/article",
    browseLabel: "Browse featured feed",
  },
  {
    slug: "trending",
    badge: "Public audio briefing feed",
    title: TRENDING_PODCAST_TITLE,
    description: TRENDING_PODCAST_DESCRIPTION,
    feedPath: "/api/podcast/trending.xml",
    syncRoute: "POST /api/podcast/trending/sync",
    episodeLabel: "One item per daily trending brief",
    audioLabel: "Stable enclosure URLs that redirect to stored MP3s",
    browseHref: "/trending",
    browseLabel: "Browse trending feed",
  },
];

export const getPodcastDirectoryEntry = (
  slug: string,
): PodcastDirectoryEntry | null =>
  PODCAST_DIRECTORY.find((entry) => entry.slug === slug) ?? null;

export const getAbsoluteFeedUrl = (feedPath: string, origin?: string): string =>
  `${getPodcastSiteUrl(origin)}${feedPath}`;

export const formatPodcastDate = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

export const formatTrendingDate = (dateIso: string): string =>
  new Date(`${dateIso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export const getFeaturedEpisodeSummary = (episode: FeaturedPodcastEpisode): string =>
  getPodcastDescription(episode.description);

export const getFeaturedEpisodeArtworkUrl = (
  episode: FeaturedPodcastEpisode,
): string | null => episode.artworkUrl ?? episode.imageUrl ?? null;

export const getTrendingEpisodeTitle = (episode: TrendingPodcastEpisode): string =>
  episode.headline?.trim() ||
  `Wikipedia Trending Brief: ${formatTrendingDate(episode.trendingDate)}`;

export const getTrendingEpisodeSummary = (episode: TrendingPodcastEpisode): string =>
  getPodcastExcerpt(
    episode.podcastDescription || episode.summary || episode.spokenSummary,
  );

export const getTrendingEpisodeArtworkUrl = (
  episode: TrendingPodcastEpisode,
): string | null =>
  episode.artworkUrl ??
  episode.artworkItems?.[0]?.imageUrl ??
  episode.imageUrls?.[0] ??
  null;

export const getFeaturedEpisodes = async (
  limit: number,
): Promise<FeaturedPodcastEpisode[]> =>
  (await fetchQuery(anyApi.podcast.getRecentFeaturedEpisodes, {
    status: "ready",
    limit,
  })) as FeaturedPodcastEpisode[];

export const getTrendingEpisodes = async (
  limit: number,
): Promise<TrendingPodcastEpisode[]> =>
  (await fetchQuery(anyApi.trending.getRecentTrendingBriefs, {
    status: "ready",
    limit,
  })) as TrendingPodcastEpisode[];
