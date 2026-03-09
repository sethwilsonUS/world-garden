import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  TRENDING_PODCAST_DESCRIPTION,
  TRENDING_PODCAST_SUBTITLE,
  TRENDING_PODCAST_TITLE,
  getTrendingPodcastItemArtworkUrl,
  getPodcastExcerpt,
  getPodcastSiteUrl,
  getTrendingPodcastShowArtworkUrl,
} from "@/lib/podcast-feed";
import {
  ATOM_NS,
  PODCAST_NS,
  escapeXml,
  formatPodcastDuration,
  xmlTag,
} from "@/lib/podcast-rss";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type TrendingPodcastEpisode = Doc<"trendingBriefs"> & {
  audioUrl: string | null;
  imageUrls?: string[];
  artworkUrl?: string | null;
};

const formatTrendingDateTitle = (dateIso: string): string =>
  new Date(`${dateIso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

export const GET = async (req: NextRequest) => {
  try {
    const siteUrl = getPodcastSiteUrl(req.nextUrl.origin);
    const feedUrl = `${siteUrl}/api/podcast/trending.xml`;
    const feedImageUrl = getTrendingPodcastShowArtworkUrl(siteUrl);
    const trendingPageUrl = `${siteUrl}/trending`;

    const episodes = (await fetchQuery(anyApi.trending.getRecentTrendingBriefs, {
      status: "ready",
      limit: 50,
    })) as TrendingPodcastEpisode[];

    const lastBuildDate = new Date(
      episodes[0]?.updatedAt ?? Date.now(),
    ).toUTCString();

    const itemsXml = episodes
      .map((episode) => {
        const mediaUrl = `${siteUrl}/api/podcast/media/trending/${episode._id}`;
        const pubDate = new Date(episode.updatedAt).toUTCString();
        const duration = formatPodcastDuration(episode.durationSeconds);
        const guid = `${siteUrl}/podcast/trending/${episode._id}`;
        const title =
          episode.headline?.trim() ||
          `Wikipedia Trending Brief: ${formatTrendingDateTitle(episode.trendingDate)}`;
        const summary = getPodcastExcerpt(
          episode.podcastDescription || episode.summary || episode.spokenSummary,
        );
        const itemImageUrl = getTrendingPodcastItemArtworkUrl(
          {
            artworkUrl: episode.artworkUrl,
            imageUrls: episode.imageUrls,
            briefId: episode._id,
          },
          siteUrl,
        );
        const enclosureLength =
          episode.byteLength != null ? ` length="${episode.byteLength}"` : "";

        return `
  <item>
    <title>${escapeXml(title)}</title>
    <description>${escapeXml(summary)}</description>
    <link>${escapeXml(trendingPageUrl)}</link>
    <guid isPermaLink="false">${escapeXml(guid)}</guid>
    <pubDate>${escapeXml(pubDate)}</pubDate>
    <enclosure url="${escapeXml(mediaUrl)}" type="audio/mpeg"${enclosureLength} />
    ${xmlTag("itunes:author", "Curio Garden")}
    ${xmlTag("itunes:subtitle", summary)}
    ${xmlTag("itunes:summary", summary)}
    ${xmlTag("itunes:duration", duration)}
    ${xmlTag("itunes:episodeType", "full")}
    <itunes:image href="${escapeXml(itemImageUrl)}" />
  </item>`.trim();
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="${PODCAST_NS}" xmlns:atom="${ATOM_NS}">
<channel>
  <title>${escapeXml(TRENDING_PODCAST_TITLE)}</title>
  <link>${escapeXml(siteUrl)}</link>
  <description>${escapeXml(TRENDING_PODCAST_DESCRIPTION)}</description>
  <language>en-us</language>
  <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>
  <image>
    <url>${escapeXml(feedImageUrl)}</url>
    <title>${escapeXml(TRENDING_PODCAST_TITLE)}</title>
    <link>${escapeXml(siteUrl)}</link>
  </image>
  <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
  <itunes:author>Curio Garden</itunes:author>
  <itunes:subtitle>${escapeXml(TRENDING_PODCAST_SUBTITLE)}</itunes:subtitle>
  <itunes:summary>${escapeXml(TRENDING_PODCAST_DESCRIPTION)}</itunes:summary>
  <itunes:explicit>false</itunes:explicit>
  <itunes:type>episodic</itunes:type>
  <itunes:category text="News" />
  <itunes:image href="${escapeXml(feedImageUrl)}" />
${itemsXml}
</channel>
</rss>`;

    return new NextResponse(xml, {
      status: 200,
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate trending podcast feed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
