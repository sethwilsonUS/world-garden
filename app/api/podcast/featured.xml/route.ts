import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc } from "@/convex/_generated/dataModel";
import {
  FEATURED_PODCAST_DESCRIPTION,
  FEATURED_PODCAST_SUBTITLE,
  FEATURED_PODCAST_TITLE,
  getPodcastDescription,
  getPodcastSiteUrl,
} from "@/lib/podcast-feed";

type FeaturedPodcastEpisode = Doc<"featuredPodcastEpisodes"> & {
  audioUrl: string | null;
};

const PODCAST_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd";
const ATOM_NS = "http://www.w3.org/2005/Atom";

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const formatDuration = (seconds?: number): string | null => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const totalSeconds = Math.round(seconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
};

const xmlTag = (name: string, value?: string | null): string =>
  value ? `<${name}>${escapeXml(value)}</${name}>` : "";

export const GET = async (req: NextRequest) => {
  try {
    const siteUrl = getPodcastSiteUrl(req.nextUrl.origin);
    const feedUrl = `${siteUrl}/api/podcast/featured.xml`;
    const articleBaseUrl = `${siteUrl}/article`;
    const fallbackImageUrl = `${siteUrl}/icon.svg`;

    const episodes = (await fetchQuery(anyApi.podcast.getRecentFeaturedEpisodes, {
      status: "ready",
      limit: 50,
    })) as FeaturedPodcastEpisode[];

    const latestEpisode = episodes[0] ?? null;
    const feedImageUrl = latestEpisode?.imageUrl || fallbackImageUrl;
    const lastBuildDate = new Date(
      latestEpisode?.updatedAt ?? Date.now(),
    ).toUTCString();

    const itemsXml = episodes
      .map((episode) => {
        const mediaUrl = `${siteUrl}/api/podcast/media/${episode._id}`;
        const articleUrl = `${articleBaseUrl}/${encodeURIComponent(episode.slug)}`;
        const pubDate = new Date(episode.publishedAt).toUTCString();
        const duration = formatDuration(episode.durationSeconds);
        const guid = `${siteUrl}/podcast/featured/${episode._id}`;
        const summary = getPodcastDescription(episode.description);
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
    ${episode.imageUrl ? `<itunes:image href="${escapeXml(episode.imageUrl)}" />` : ""}
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
        "Cache-Control":
          "public, max-age=300, s-maxage=300, stale-while-revalidate=900",
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
