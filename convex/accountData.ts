import type { Doc } from "./_generated/dataModel";
import { query, type QueryCtx } from "./_generated/server";
import {
  paginationOptsValidator,
  type PaginationOptions,
} from "convex/server";
import { v } from "convex/values";
import { getAuthenticatedViewerTokenIdentifier } from "./bookmarks";
import {
  getArticleAudioExportQuotaKey,
  getPersonalPlaylistOpenAiQuotaKey,
} from "./lib/accountQuotaKeys";

type AccountDataQueryCtx = Pick<QueryCtx, "auth" | "db">;

const MAX_ACCOUNT_DATA_PAGE_SIZE = 100;
type AccountDataCollection =
  | "bookmarks"
  | "playlistEpisodes"
  | "listeningProgress"
  | "badgeCredits"
  | "articleAudioExports";

type AccountQuota = {
  feature: "personalPlaylist" | "articleAudioExport";
  count: number;
  windowStart: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};

type AccountDataOverview = {
  feed:
    | null
    | {
        status: "active" | "revoked";
        feedToken: string | null;
        createdAt: number;
        updatedAt: number;
        revokedAt?: number;
      };
  quotas: AccountQuota[];
};

const toAccountQuota = (
  feature: AccountQuota["feature"],
  quota: Doc<"routeQuotas"> | null,
): AccountQuota | null =>
  quota
    ? {
        feature,
        count: quota.count,
        windowStart: quota.windowStart,
        expiresAt: quota.expiresAt,
        createdAt: quota.createdAt,
        updatedAt: quota.updatedAt,
      }
    : null;

export const getViewerAccountDataOverviewForCtx = async (
  ctx: AccountDataQueryCtx,
): Promise<AccountDataOverview> => {
  const viewerTokenIdentifier =
    await getAuthenticatedViewerTokenIdentifier(ctx);
  const [feed, personalPlaylistQuota, articleAudioExportQuota] =
    await Promise.all([
      ctx.db
        .query("personalPodcastFeeds")
        .withIndex("by_viewerTokenIdentifier", (q) =>
          q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
        )
        .first(),
      ctx.db
        .query("routeQuotas")
        .withIndex("by_key", (q) =>
          q.eq(
            "key",
            getPersonalPlaylistOpenAiQuotaKey(viewerTokenIdentifier),
          ),
        )
        .first(),
      ctx.db
        .query("routeQuotas")
        .withIndex("by_key", (q) =>
          q.eq(
            "key",
            getArticleAudioExportQuotaKey(viewerTokenIdentifier),
          ),
        )
        .first(),
    ]);

  const quotas = [
    toAccountQuota("personalPlaylist", personalPlaylistQuota),
    toAccountQuota("articleAudioExport", articleAudioExportQuota),
  ].filter((quota): quota is AccountQuota => quota !== null);

  if (!feed) {
    return { feed: null, quotas };
  }

  return {
    feed:
      feed.revokedAt == null
        ? {
            status: "active",
            feedToken: feed.feedToken,
            createdAt: feed.createdAt,
            updatedAt: feed.updatedAt,
          }
        : {
            status: "revoked",
            feedToken: null,
            createdAt: feed.createdAt,
            updatedAt: feed.updatedAt,
            revokedAt: feed.revokedAt,
          },
    quotas,
  };
};

export const getViewerAccountDataOverview = query({
  args: {},
  handler: getViewerAccountDataOverviewForCtx,
});

const normalizePaginationOptions = (
  paginationOpts: PaginationOptions,
): PaginationOptions => ({
  ...paginationOpts,
  numItems: Math.min(
    MAX_ACCOUNT_DATA_PAGE_SIZE,
    Math.max(
      1,
      Number.isFinite(paginationOpts.numItems)
        ? Math.floor(paginationOpts.numItems)
        : 1,
    ),
  ),
});

export const getViewerAccountDataPageForCtx = async (
  ctx: AccountDataQueryCtx,
  args: {
    collection: AccountDataCollection;
    paginationOpts: PaginationOptions;
  },
) => {
  const viewerTokenIdentifier =
    await getAuthenticatedViewerTokenIdentifier(ctx);
  const paginationOpts = normalizePaginationOptions(args.paginationOpts);

  switch (args.collection) {
    case "bookmarks": {
      const result = await ctx.db
        .query("bookmarks")
        .withIndex("by_viewerTokenIdentifier", (q) =>
          q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
        )
        .paginate(paginationOpts);

      return {
        ...result,
        page: result.page.map((bookmark) => ({
          slug: bookmark.slug,
          title: bookmark.title,
          savedAt: bookmark.savedAt,
          updatedAt: bookmark.updatedAt,
        })),
      };
    }
    case "playlistEpisodes": {
      const result = await ctx.db
        .query("personalPlaylistEpisodes")
        .withIndex("by_viewerTokenIdentifier", (q) =>
          q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
        )
        .paginate(paginationOpts);

      return {
        ...result,
        page: result.page.map((episode) => ({
          slug: episode.slug,
          title: episode.title,
          description: episode.description,
          imageUrl: episode.imageUrl,
          position: episode.position,
          publishedAt: episode.publishedAt,
          removedAt: episode.removedAt,
          status: episode.status,
          stage: episode.stage,
          sectionCount: episode.sectionCount,
          completedSectionCount: episode.completedSectionCount,
          durationSeconds: episode.durationSeconds,
          byteLength: episode.byteLength,
          provider: episode.provider,
          model: episode.model,
          voiceId: episode.voiceId,
          createdAt: episode.createdAt,
          updatedAt: episode.updatedAt,
        })),
      };
    }
    case "listeningProgress": {
      const result = await ctx.db
        .query("viewerArticleListenProgress")
        .withIndex("by_viewerTokenIdentifier", (q) =>
          q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
        )
        .paginate(paginationOpts);

      return {
        ...result,
        page: result.page.map((progress) => ({
          wikiPageId: progress.wikiPageId,
          slug: progress.slug,
          title: progress.title,
          totalDurationSeconds: progress.totalDurationSeconds,
          heardSeconds: progress.heardSeconds,
          qualifiedAt: progress.qualifiedAt,
          sections: progress.sections.map((section) => ({
            sectionKey: section.sectionKey,
            durationSeconds: section.durationSeconds,
            heardRanges: section.heardRanges.map((range) => ({
              startSecond: range.startSecond,
              endSecond: range.endSecond,
            })),
          })),
          createdAt: progress.createdAt,
          updatedAt: progress.updatedAt,
        })),
      };
    }
    case "badgeCredits": {
      const result = await ctx.db
        .query("badgeArticleCredits")
        .withIndex("by_viewerTokenIdentifier", (q) =>
          q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
        )
        .paginate(paginationOpts);

      return {
        ...result,
        page: result.page.map((credit) => ({
          wikiPageId: credit.wikiPageId,
          slug: credit.slug,
          title: credit.title,
          badgeKey: credit.badgeKey,
          earnedAt: credit.earnedAt,
        })),
      };
    }
    case "articleAudioExports": {
      const result = await ctx.db
        .query("articleAudioExports")
        .withIndex("by_ownerTokenIdentifier", (q) =>
          q.eq("ownerTokenIdentifier", viewerTokenIdentifier),
        )
        .paginate(paginationOpts);

      return {
        ...result,
        page: result.page.map((audioExport) => ({
          slug: audioExport.slug,
          title: audioExport.title,
          status: audioExport.status,
          stage: audioExport.stage,
          sectionCount: audioExport.sectionCount,
          completedSectionCount: audioExport.completedSectionCount,
          byteLength: audioExport.byteLength,
          ttsProvider: audioExport.ttsProvider,
          model: audioExport.requestedTtsMetadata?.model,
          voiceId: audioExport.requestedTtsMetadata?.voiceId,
          dismissedAt: audioExport.dismissedAt,
          createdAt: audioExport.createdAt,
          updatedAt: audioExport.updatedAt,
        })),
      };
    }
    default: {
      const exhaustiveCollection: never = args.collection;
      throw new Error(
        `Unsupported account data collection: ${exhaustiveCollection}`,
      );
    }
  }
};

export const getViewerAccountDataPage = query({
  args: {
    collection: v.union(
      v.literal("bookmarks"),
      v.literal("playlistEpisodes"),
      v.literal("listeningProgress"),
      v.literal("badgeCredits"),
      v.literal("articleAudioExports"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: getViewerAccountDataPageForCtx,
});
