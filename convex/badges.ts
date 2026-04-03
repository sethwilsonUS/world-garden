import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  BADGE_DEFINITIONS,
  BADGE_KEYS,
  buildAwardedBadgeProgress,
  buildBadgeProgress,
  buildEmptyBadgeProgress,
  type BadgeCreditEntry,
  type BadgeCreditSummary,
  type BadgeKey,
  type BadgeListenProgressResult,
  type BadgeProgress,
} from "../lib/badges";
import {
  normalizeHeardRanges,
  sumHeardRangeSeconds,
  type HeardRange,
} from "../lib/listen-progress";
import { getAuthenticatedViewerTokenIdentifier } from "./bookmarks";

const QUALIFYING_LISTEN_FRACTION = 0.8;

const badgeKeyValidator = v.union(
  v.literal("history"),
  v.literal("geography"),
  v.literal("biography"),
  v.literal("society_politics"),
  v.literal("arts_culture"),
  v.literal("science"),
  v.literal("technology"),
  v.literal("nature"),
);

const heardRangeValidator = v.object({
  startSecond: v.number(),
  endSecond: v.number(),
});

type BadgeCreditDoc = {
  _id: Id<"badgeArticleCredits">;
  viewerTokenIdentifier: string;
  articleId: Id<"articles">;
  wikiPageId: string;
  slug: string;
  title: string;
  badgeKey: BadgeKey;
  earnedAt: number;
};

type ViewerListenProgressDoc = {
  _id: Id<"viewerArticleListenProgress">;
  viewerTokenIdentifier: string;
  articleId: Id<"articles">;
  wikiPageId: string;
  slug: string;
  title: string;
  totalDurationSeconds: number;
  heardSeconds: number;
  qualifiedAt?: number;
  sections: Array<{
    sectionKey: string;
    durationSeconds: number;
    heardRanges: HeardRange[];
  }>;
  createdAt: number;
  updatedAt: number;
};

type BadgeQueryCtx = Pick<QueryCtx, "auth" | "db">;
type BadgeMutationCtx = Pick<MutationCtx, "auth" | "db">;

const getExistingListenProgress = async (
  ctx: BadgeMutationCtx,
  viewerTokenIdentifier: string,
  wikiPageId: string,
): Promise<ViewerListenProgressDoc | null> =>
  (await ctx.db
    .query("viewerArticleListenProgress")
    .withIndex("by_viewerTokenIdentifier_wikiPageId", (q) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier).eq("wikiPageId", wikiPageId),
    )
    .unique()) as ViewerListenProgressDoc | null;

const getExistingBadgeCredit = async (
  ctx: BadgeMutationCtx,
  viewerTokenIdentifier: string,
  wikiPageId: string,
  badgeKey: BadgeKey,
): Promise<BadgeCreditDoc | null> =>
  (await ctx.db
    .query("badgeArticleCredits")
    .withIndex("by_viewerTokenIdentifier_wikiPageId_badgeKey", (q) =>
      q
        .eq("viewerTokenIdentifier", viewerTokenIdentifier)
        .eq("wikiPageId", wikiPageId)
        .eq("badgeKey", badgeKey),
    )
    .unique()) as BadgeCreditDoc | null;

const sectionSortValue = (sectionKey: string): number => {
  if (sectionKey === "summary") return -1;
  const index = Number.parseInt(sectionKey.replace("section-", ""), 10);
  return Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER;
};

export const mergeProgressSections = (
  existingSections: ViewerListenProgressDoc["sections"],
  update: {
    sectionKey: string;
    sectionDurationSeconds: number;
    heardRanges: HeardRange[];
  },
): ViewerListenProgressDoc["sections"] => {
  const byKey = new Map(
    existingSections.map((section) => [
      section.sectionKey,
      {
        ...section,
        heardRanges: normalizeHeardRanges(
          section.heardRanges,
          section.durationSeconds,
        ),
      },
    ]),
  );

  const previous = byKey.get(update.sectionKey);
  const durationSeconds = Math.max(1, Math.ceil(update.sectionDurationSeconds));
  const heardRanges = normalizeHeardRanges(
    [
      ...(previous?.heardRanges ?? []),
      ...update.heardRanges,
    ],
    durationSeconds,
  );

  byKey.set(update.sectionKey, {
    sectionKey: update.sectionKey,
    durationSeconds,
    heardRanges,
  });

  return [...byKey.values()].sort(
    (left, right) =>
      sectionSortValue(left.sectionKey) - sectionSortValue(right.sectionKey),
  );
};

const calculateHeardSeconds = (
  sections: ViewerListenProgressDoc["sections"],
): number =>
  sections.reduce(
    (total, section) =>
      total +
      sumHeardRangeSeconds(
        normalizeHeardRanges(section.heardRanges, section.durationSeconds),
      ),
    0,
  );

const summarizeViewerBadgeCredits = (
  credits: BadgeCreditDoc[],
): {
  badges: BadgeProgress[];
  totalExp: number;
  unlockedBadgeCount: number;
} => {
  const expByBadge = new Map<BadgeKey, number>();

  for (const credit of credits) {
    expByBadge.set(credit.badgeKey, (expByBadge.get(credit.badgeKey) ?? 0) + 1);
  }

  const badges = BADGE_KEYS.map((key) => {
    const exp = expByBadge.get(key) ?? 0;
    return exp > 0 ? buildBadgeProgress(key, exp, exp) : buildEmptyBadgeProgress(key);
  });

  return {
    badges,
    totalExp: credits.length,
    unlockedBadgeCount: badges.filter((badge) => badge.level > 0).length,
  };
};

const summarizeBadgeCreditDetails = (
  credits: BadgeCreditDoc[],
): BadgeCreditSummary[] =>
  BADGE_KEYS.map((badgeKey) => ({
    badgeKey,
    credits: credits
      .filter((credit) => credit.badgeKey === badgeKey)
      .sort((left, right) => right.earnedAt - left.earnedAt)
      .map<BadgeCreditEntry>((credit) => ({
        wikiPageId: credit.wikiPageId,
        slug: credit.slug,
        title: credit.title,
        earnedAt: credit.earnedAt,
      })),
  }));

export const getViewerBadgeProgressForCtx = async (
  ctx: BadgeQueryCtx,
): Promise<{
  badges: BadgeProgress[];
  badgeCredits: BadgeCreditSummary[];
  totalExp: number;
  unlockedBadgeCount: number;
}> => {
  const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
  const credits = (await ctx.db
    .query("badgeArticleCredits")
    .withIndex("by_viewerTokenIdentifier", (q) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
    )
    .collect()) as BadgeCreditDoc[];

  return {
    ...summarizeViewerBadgeCredits(credits),
    badgeCredits: summarizeBadgeCreditDetails(credits),
  };
};

const awardBadgeCreditsForQualifiedArticle = async (
  ctx: BadgeMutationCtx,
  args: {
    viewerTokenIdentifier: string;
    articleId: Id<"articles">;
    wikiPageId: string;
    slug: string;
    title: string;
  },
): Promise<BadgeKey[]> => {
  const article = await ctx.db.get(args.articleId);
  const badgeKeys = ((article?.badgeKeys ?? []) as BadgeKey[]).filter((key) =>
    BADGE_KEYS.includes(key),
  );
  const awarded: BadgeKey[] = [];

  for (const badgeKey of badgeKeys) {
    const existingCredit = await getExistingBadgeCredit(
      ctx,
      args.viewerTokenIdentifier,
      args.wikiPageId,
      badgeKey,
    );
    if (existingCredit) continue;

    await ctx.db.insert("badgeArticleCredits", {
      viewerTokenIdentifier: args.viewerTokenIdentifier,
      articleId: args.articleId,
      wikiPageId: args.wikiPageId,
      slug: args.slug,
      title: args.title,
      badgeKey,
      earnedAt: Date.now(),
    });
    awarded.push(badgeKey);
  }

  return awarded;
};

export const recordViewerArticleListenProgressForCtx = async (
  ctx: BadgeMutationCtx,
  args: {
    articleId: Id<"articles">;
    wikiPageId: string;
    slug: string;
    title: string;
    totalDurationSeconds: number;
    sectionKey: string;
    sectionDurationSeconds: number;
    heardRanges: HeardRange[];
  },
): Promise<{
  heardSeconds: number;
  totalDurationSeconds: number;
  qualified: boolean;
  awardedBadgeKeys: BadgeKey[];
  awardedBadges: BadgeListenProgressResult["awardedBadges"];
}> => {
  const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
  const totalDurationSeconds = Math.max(1, Math.ceil(args.totalDurationSeconds));
  const sectionDurationSeconds = Math.max(1, Math.ceil(args.sectionDurationSeconds));
  const heardRanges = normalizeHeardRanges(args.heardRanges, sectionDurationSeconds);
  const existing = await getExistingListenProgress(
    ctx,
    viewerTokenIdentifier,
    args.wikiPageId,
  );

  if (heardRanges.length === 0 && existing) {
    return {
      heardSeconds: existing.heardSeconds,
      totalDurationSeconds: existing.totalDurationSeconds,
      qualified: Boolean(existing.qualifiedAt),
      awardedBadgeKeys: [],
      awardedBadges: [],
    };
  }

  if (heardRanges.length === 0) {
    return {
      heardSeconds: 0,
      totalDurationSeconds,
      qualified: false,
      awardedBadgeKeys: [],
      awardedBadges: [],
    };
  }

  const sections = mergeProgressSections(existing?.sections ?? [], {
    sectionKey: args.sectionKey,
    sectionDurationSeconds,
    heardRanges,
  });
  const heardSeconds = calculateHeardSeconds(sections);
  const reachedThreshold =
    heardSeconds / Math.max(1, totalDurationSeconds) >= QUALIFYING_LISTEN_FRACTION;

  let awardedBadgeKeys: BadgeKey[] = [];
  let awardedBadges: BadgeListenProgressResult["awardedBadges"] = [];
  const qualifiedAt =
    existing?.qualifiedAt ??
    (reachedThreshold
      ? Date.now()
      : undefined);

  if (!existing?.qualifiedAt && reachedThreshold) {
    awardedBadgeKeys = await awardBadgeCreditsForQualifiedArticle(ctx, {
      viewerTokenIdentifier,
      articleId: args.articleId,
      wikiPageId: args.wikiPageId,
      slug: args.slug,
      title: args.title,
    });
  }

  if (awardedBadgeKeys.length > 0) {
    const viewerBadgeProgress = await getViewerBadgeProgressForCtx(ctx);
    awardedBadges = viewerBadgeProgress.badges
      .filter((badge) => awardedBadgeKeys.includes(badge.key))
      .map((badge) => buildAwardedBadgeProgress(badge.key, badge.exp));
  }

  const data = {
    viewerTokenIdentifier,
    articleId: args.articleId,
    wikiPageId: args.wikiPageId,
    slug: args.slug,
    title: args.title,
    totalDurationSeconds,
    heardSeconds,
    qualifiedAt,
    sections,
    updatedAt: Date.now(),
  };

  if (existing) {
    await ctx.db.patch(existing._id, data);
  } else {
    await ctx.db.insert("viewerArticleListenProgress", {
      ...data,
      createdAt: Date.now(),
    });
  }

  return {
    heardSeconds,
    totalDurationSeconds,
    qualified: Boolean(qualifiedAt),
    awardedBadgeKeys,
    awardedBadges,
  };
};

export const getViewerBadgeProgress = query({
  args: {},
  handler: (ctx) => getViewerBadgeProgressForCtx(ctx),
});

export const getViewerBadgeCreditsByKeyForCtx = async (
  ctx: BadgeQueryCtx,
  args: {
    badgeKey: BadgeKey;
  },
): Promise<BadgeCreditEntry[]> => {
  const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
  const credits = (await ctx.db
    .query("badgeArticleCredits")
    .withIndex("by_viewerTokenIdentifier", (q) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
    )
    .collect()) as BadgeCreditDoc[];

  return credits
    .filter((credit) => credit.badgeKey === args.badgeKey)
    .sort((left, right) => right.earnedAt - left.earnedAt)
    .map<BadgeCreditEntry>((credit) => ({
      wikiPageId: credit.wikiPageId,
      slug: credit.slug,
      title: credit.title,
      earnedAt: credit.earnedAt,
    }));
};

export const getViewerBadgeCreditsByKey = query({
  args: {
    badgeKey: badgeKeyValidator,
  },
  handler: (ctx, args) => getViewerBadgeCreditsByKeyForCtx(ctx, args),
});

export const recordViewerArticleListenProgress = mutation({
  args: {
    articleId: v.id("articles"),
    wikiPageId: v.string(),
    slug: v.string(),
    title: v.string(),
    totalDurationSeconds: v.number(),
    sectionKey: v.string(),
    sectionDurationSeconds: v.number(),
    heardRanges: v.array(heardRangeValidator),
  },
  handler: (ctx, args) => recordViewerArticleListenProgressForCtx(ctx, args),
});

export const badgeDefinitions = BADGE_DEFINITIONS;
export const badgeKeyValue = badgeKeyValidator;
