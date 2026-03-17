import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import type { Doc } from "@/convex/_generated/dataModel";
import { renderPersonalShowPodcastArtworkPng } from "@/lib/personal-show-podcast-artwork";
import {
  PERSONAL_PODCAST_DESCRIPTION,
  PERSONAL_PODCAST_SUBTITLE,
  PERSONAL_PODCAST_TITLE,
  getPodcastDescription,
  getPodcastSiteUrl,
} from "@/lib/podcast-feed";
import { getOrCreatePodcastShowArtworkUrl } from "@/lib/podcast-show-artwork-cache";
import {
  ATOM_NS,
  CONTENT_NS,
  PODCAST_NS,
  escapeXml,
  formatPodcastDuration,
  xmlTag,
} from "@/lib/podcast-rss";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PersonalPlaylistEpisode = Doc<"personalPlaylistEpisodes"> & {
  audioUrl: string | null;
};

export const GET = async (req: NextRequest) => {
  const feedToken = req.nextUrl.searchParams.get("token")?.trim();
  if (!feedToken) {
    return NextResponse.json(
      { error: "Podcast feed not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const siteUrl = getPodcastSiteUrl(req.nextUrl.origin);
    const feedUrl = `${siteUrl}/api/podcast/personal.xml?token=${encodeURIComponent(feedToken)}`;
    const articleBaseUrl = `${siteUrl}/article`;
    const feedImageUrl = await getOrCreatePodcastShowArtworkUrl({
      slug: "personal",
      render: renderPersonalShowPodcastArtworkPng,
    });
    const payload = await fetchQuery(anyApi.personalPlaylist.getFeedEpisodesByToken, {
      feedToken,
    });

    if (!payload) {
      return NextResponse.json(
        { error: "Podcast feed not found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }

    const episodes = payload.episodes as PersonalPlaylistEpisode[];
    const lastBuildDate = new Date(
      episodes[0]?.updatedAt ?? payload.feed.updatedAt ?? Date.now(),
    ).toUTCString();

    const itemsXml = episodes
      .map((episode) => {
        const mediaUrl = `${siteUrl}/api/podcast/media/personal/${episode._id}?token=${encodeURIComponent(feedToken)}`;
        const articleUrl = `${articleBaseUrl}/${encodeURIComponent(episode.slug)}`;
        const pubDate = new Date(episode.publishedAt).toUTCString();
        const duration = formatPodcastDuration(episode.durationSeconds);
        const guid = `${siteUrl}/podcast/personal/${episode._id}?token=${encodeURIComponent(feedToken)}`;
        const summary = getPodcastDescription(episode.description);
        const itemImageUrl = episode.imageUrl?.trim() || feedImageUrl;
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
    <itunes:image href="${escapeXml(itemImageUrl)}" />
  </item>`.trim();
      })
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="${PODCAST_NS}" xmlns:atom="${ATOM_NS}" xmlns:content="${CONTENT_NS}">
<channel>
  <title>${escapeXml(PERSONAL_PODCAST_TITLE)}</title>
  <link>${escapeXml(siteUrl)}</link>
  <description>${escapeXml(PERSONAL_PODCAST_DESCRIPTION)}</description>
  <language>en-us</language>
  <lastBuildDate>${escapeXml(lastBuildDate)}</lastBuildDate>
  <image>
    <url>${escapeXml(feedImageUrl)}</url>
    <title>${escapeXml(PERSONAL_PODCAST_TITLE)}</title>
    <link>${escapeXml(siteUrl)}</link>
  </image>
  <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
  <itunes:author>Curio Garden</itunes:author>
  <itunes:subtitle>${escapeXml(PERSONAL_PODCAST_SUBTITLE)}</itunes:subtitle>
  <itunes:summary>${escapeXml(PERSONAL_PODCAST_DESCRIPTION)}</itunes:summary>
  <itunes:explicit>false</itunes:explicit>
  <itunes:block>yes</itunes:block>
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
            : "Failed to generate personal podcast feed",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
};
