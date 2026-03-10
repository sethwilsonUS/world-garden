import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  FEATURED_PODCAST_DESCRIPTION,
  FEATURED_PODCAST_SUBTITLE,
  FEATURED_PODCAST_TITLE,
  getFeaturedPodcastItemArtworkUrl,
  getPodcastDescription,
  getPodcastArtworkUrl,
  getPodcastSiteUrl,
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

type FeaturedPodcastEpisode = Doc<"featuredPodcastEpisodes"> & {
  audioUrl: string | null;
  artworkUrl?: string | null;
};

export const GET = async (req: NextRequest) => {
  try {
    const siteUrl = getPodcastSiteUrl(req.nextUrl.origin);
    const feedUrl = `${siteUrl}/api/podcast/featured.xml`;
    const articleBaseUrl = `${siteUrl}/article`;
    const feedImageUrl = getPodcastArtworkUrl(siteUrl);

    const episodes = (await fetchQuery(anyApi.podcast.getRecentFeaturedEpisodes, {
      status: "ready",
      limit: 50,
    })) as FeaturedPodcastEpisode[];

    const lastBuildDate = new Date(
      episodes[0]?.updatedAt ?? Date.now(),
    ).toUTCString();

    const itemsXml = episodes
      .map((episode) => {
        const mediaUrl = `${siteUrl}/api/podcast/media/${episode._id}`;
        const articleUrl = `${articleBaseUrl}/${encodeURIComponent(episode.slug)}`;
        const pubDate = new Date(episode.publishedAt).toUTCString();
        const duration = formatPodcastDuration(episode.durationSeconds);
        const guid = `${siteUrl}/podcast/featured/${episode._id}`;
        const summary = getPodcastDescription(episode.description);
        const itemImageUrl = getFeaturedPodcastItemArtworkUrl(
          {
            artworkUrl: episode.artworkUrl,
            imageUrl: episode.imageUrl,
            episodeId: episode._id,
          },
          siteUrl,
        );
        const enclosureLength =
          episode.byteLength != null ? ` length="${episode.byteLength}"` : "";

        return `
  <item>
    <title>${escapeXml(episode.title)}</title>
    <description>${escapeXml(summary)}</description>
    <link>${escapeXml(articleUrl)}</link>
    <guid isPermaLink="false">${escapeXml(guid)}</guid>
    <pubDate>${escapeXml(pubDate)}</pubDate>
    <enclosure url="${escapeXml(mediaUrl)}" type="audio/mpeg"${enclosureLength} />
    ${xmlTag("itunes:author", "Curio Garden")}
    ${xmlTag("itunes:subtitle", summary)}
    ${xmlTag("itunes:summary", summary)}
    ${xmlTag("itunes:duration", duration)}
    ${xmlTag("itunes:episodeType", "full")}
    ${itemImageUrl ? `<itunes:image href="${escapeXml(itemImageUrl)}" />` : ""}
  </item>`.trim();
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="${PODCAST_NS}" xmlns:atom="${ATOM_NS}">
<channel>
  <title>${escapeXml(FEATURED_PODCAST_TITLE)}</title>
  <link>${escapeXml(siteUrl)}</link>
  <description>${escapeXml(FEATURED_PODCAST_DESCRIPTION)}</description>
  <language>en-us</language>
  <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>
  <image>
    <url>${escapeXml(feedImageUrl)}</url>
    <title>${escapeXml(FEATURED_PODCAST_TITLE)}</title>
    <link>${escapeXml(siteUrl)}</link>
  </image>
  <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
  <itunes:author>Curio Garden</itunes:author>
  <itunes:subtitle>${escapeXml(FEATURED_PODCAST_SUBTITLE)}</itunes:subtitle>
  <itunes:summary>${escapeXml(FEATURED_PODCAST_DESCRIPTION)}</itunes:summary>
  <itunes:explicit>false</itunes:explicit>
  <itunes:type>episodic</itunes:type>
  <itunes:category text="Education" />
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
            : "Failed to generate featured podcast feed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
