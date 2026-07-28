import { anyApi } from "convex/server";
import { fetchQuery } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { renderPersonalShowPodcastArtworkPng } from "@/lib/personal-show-podcast-artwork";
import { isValidPersonalFeedToken } from "@/lib/personal-feed-token";
import { PERSONAL_PODCAST_PRIVATE_HEADERS } from "@/lib/personal-podcast-response";
import { withPromiseTimeout } from "@/lib/promise-timeout";
import {
  PERSONAL_PODCAST_DESCRIPTION,
  PERSONAL_PODCAST_SUBTITLE,
  PERSONAL_PODCAST_TITLE,
  getPodcastDescription,
  getPodcastSiteUrl,
  getWikipediaEpisodeDescription,
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

const PERSONAL_PODCAST_CONVEX_TIMEOUT_MS = 5_000;

type PersonalPlaylistEpisode = {
  _id: string;
  wikiPageId: string;
  slug: string;
  title: string;
  description?: string;
  imageUrl?: string;
  publishedAt: number;
  updatedAt: number;
  durationSeconds?: number;
  byteLength?: number;
  sourceRevisionId?: string;
};

export const GET = async (req: NextRequest) => {
  const feedToken = req.nextUrl.searchParams.get("token");
  if (!feedToken || !isValidPersonalFeedToken(feedToken)) {
    return NextResponse.json(
      { error: "Podcast feed not found" },
      { status: 404, headers: PERSONAL_PODCAST_PRIVATE_HEADERS },
    );
  }

  try {
    const payload = await withPromiseTimeout(
      fetchQuery(anyApi.personalPlaylist.getFeedEpisodesByToken, {
        feedToken,
      }),
      {
        timeoutMs: PERSONAL_PODCAST_CONVEX_TIMEOUT_MS,
        message: "Personal podcast feed lookup timed out",
      },
    );

    if (!payload) {
      return NextResponse.json(
        { error: "Podcast feed not found" },
        { status: 404, headers: PERSONAL_PODCAST_PRIVATE_HEADERS },
      );
    }

    const siteUrl = getPodcastSiteUrl(req.nextUrl.origin);
    const feedUrl = `${siteUrl}/api/podcast/personal.xml?token=${encodeURIComponent(feedToken)}`;
    const articleBaseUrl = `${siteUrl}/article`;
    const feedImageUrl = await getOrCreatePodcastShowArtworkUrl({
      slug: "personal",
      render: renderPersonalShowPodcastArtworkPng,
    });

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
        const guid = `urn:curio-garden:personal:${episode._id}`;
        const summary = getPodcastDescription(episode.description);
        const attributedSummary = getWikipediaEpisodeDescription({
          summary,
          wikiPageId: episode.wikiPageId,
          revisionId: episode.sourceRevisionId,
        });
        const itemImageUrl = episode.imageUrl?.trim() || feedImageUrl;
        const enclosureLength =
          episode.byteLength != null ? ` length="${episode.byteLength}"` : "";

        return `
  <item>
    <title>${escapeXml(episode.title)}</title>
    <description>${escapeXml(attributedSummary)}</description>
    <link>${escapeXml(articleUrl)}</link>
    <guid isPermaLink="false">${escapeXml(guid)}</guid>
    <pubDate>${escapeXml(pubDate)}</pubDate>
    <enclosure url="${escapeXml(mediaUrl)}" type="audio/mpeg"${enclosureLength} />
    ${xmlTag("itunes:author", "Curio Garden")}
    ${xmlTag("itunes:subtitle", summary)}
    ${xmlTag("itunes:summary", attributedSummary)}
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
        ...PERSONAL_PODCAST_PRIVATE_HEADERS,
        "Content-Type": "application/rss+xml; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("[personal-podcast-feed] Feed request failed.", error);
    return NextResponse.json(
      { error: "Personal podcast feed is unavailable" },
      { status: 500, headers: PERSONAL_PODCAST_PRIVATE_HEADERS },
    );
  }
};
