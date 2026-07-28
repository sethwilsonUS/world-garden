import { v } from "convex/values";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
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
  calculateNewlyHeardSeconds,
  getMeaningfulUseQualification,
  normalizeHeardRanges,
  sumHeardRangeSeconds,
  type HeardRange,
} from "../lib/listen-progress";
import { buildArticleNarrationTracks } from "../lib/section-narration";
import { getAiCostLedgerMode } from "../lib/ai-cost-ledger-contract";
import { type AiCostListeningContributionInput } from "./lib/aiCostLedger";
import { scheduleListeningContributionBestEffort } from "./lib/aiCostPipelineInstrumentation";
import { getAuthenticatedViewerTokenIdentifier } from "./bookmarks";

const QUALIFYING_LISTEN_FRACTION = 0.8;
export const MEANINGFUL_USE_SESSION_RETENTION_MS = 2 * 60 * 60 * 1_000;
export const MEANINGFUL_USE_SESSION_CLEANUP_BATCH_SIZE = 100;

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
  meaningfulUseSession?: {
    startedAt: number;
    sections: Array<{
      sectionKey: string;
      durationSeconds: number;
      heardRanges: HeardRange[];
    }>;
  };
  meaningfulUseSessionExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
};

type BadgeQueryCtx = Pick<QueryCtx, "auth" | "db">;
type BadgeMutationCtx = Pick<MutationCtx, "auth" | "db" | "scheduler">;
type BadgeLedgerDependencies = {
  recordListeningContribution?: (
    ctx: BadgeMutationCtx,
    input: AiCostListeningContributionInput,
  ) => Promise<unknown>;
  isEnabled?: () => boolean;
};

const defaultBadgeLedgerDependencies: BadgeLedgerDependencies = {
  recordListeningContribution: scheduleListeningContributionBestEffort,
  isEnabled: () => getAiCostLedgerMode() === "observe",
};

const getExistingListenProgress = async (
  ctx: BadgeMutationCtx,
  viewerTokenIdentifier: string,
  wikiPageId: string,
): Promise<ViewerListenProgressDoc | null> =>
  (await ctx.db
    .query("viewerArticleListenProgress")
    .withIndex("by_viewerTokenIdentifier_wikiPageId", (q) =>
      q
        .eq("viewerTokenIdentifier", viewerTokenIdentifier)
        .eq("wikiPageId", wikiPageId),
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
    [...(previous?.heardRanges ?? []), ...update.heardRanges],
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

export const calculateListeningLedgerUpdate = ({
  existingSections,
  mergedSections,
  updatedSectionKey,
  progressSectionKeys,
  existingSessionSections = [],
  mergedSessionSections = [],
}: {
  existingSections: ViewerListenProgressDoc["sections"];
  mergedSections: ViewerListenProgressDoc["sections"];
  updatedSectionKey: string;
  progressSectionKeys: string[];
  existingSessionSections?: ViewerListenProgressDoc["sections"];
  mergedSessionSections?: ViewerListenProgressDoc["sections"];
}): {
  newUniqueSeconds: number;
  meaningfulUse: boolean;
  newlyMeaningfulUse: boolean;
  heardProgressSectionKeys: string[];
} => {
  const progressKeys = new Set(progressSectionKeys);
  const previousSection = existingSections.find(
    (section) => section.sectionKey === updatedSectionKey,
  );
  const updatedSection = mergedSections.find(
    (section) => section.sectionKey === updatedSectionKey,
  );
  const newUniqueSeconds =
    progressKeys.has(updatedSectionKey) && updatedSection
      ? calculateNewlyHeardSeconds({
          existingRanges: previousSection?.heardRanges ?? [],
          incomingRanges: updatedSection.heardRanges,
          durationSeconds: updatedSection.durationSeconds,
        })
      : 0;
  const getQualification = (sections: ViewerListenProgressDoc["sections"]) =>
    getMeaningfulUseQualification(
      sections.map((section) => ({
        durationSeconds: section.durationSeconds,
        heardRanges: section.heardRanges,
        countsTowardProgress: progressKeys.has(section.sectionKey),
      })),
    );
  const previousQualification = getQualification(existingSessionSections);
  const currentQualification = getQualification(mergedSessionSections);
  const meaningfulUse = currentQualification !== null;
  const newlyMeaningfulUse =
    previousQualification === null && currentQualification !== null;
  const heardProgressSectionKeys = (
    newlyMeaningfulUse ? mergedSessionSections : mergedSections
  )
    .filter(
      (section) =>
        progressKeys.has(section.sectionKey) &&
        sumHeardRangeSeconds(
          normalizeHeardRanges(section.heardRanges, section.durationSeconds),
        ) > 0,
    )
    .map((section) => section.sectionKey);

  return {
    newUniqueSeconds,
    meaningfulUse,
    newlyMeaningfulUse,
    heardProgressSectionKeys,
  };
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
    return exp > 0
      ? buildBadgeProgress(key, exp, exp)
      : buildEmptyBadgeProgress(key);
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
  const viewerTokenIdentifier =
    await getAuthenticatedViewerTokenIdentifier(ctx);
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
    listeningSessionStartedAt?: number;
    progressStartedAt?: number;
  },
  dependencies: BadgeLedgerDependencies = defaultBadgeLedgerDependencies,
): Promise<{
  heardSeconds: number;
  totalDurationSeconds: number;
  qualified: boolean;
  awardedBadgeKeys: BadgeKey[];
  awardedBadges: BadgeListenProgressResult["awardedBadges"];
}> => {
  const viewerTokenIdentifier =
    await getAuthenticatedViewerTokenIdentifier(ctx);
  const totalDurationSeconds = Math.max(
    1,
    Math.ceil(args.totalDurationSeconds),
  );
  const sectionDurationSeconds = Math.max(
    1,
    Math.ceil(args.sectionDurationSeconds),
  );
  const heardRanges = normalizeHeardRanges(
    args.heardRanges,
    sectionDurationSeconds,
  );
  const existing = await getExistingListenProgress(
    ctx,
    viewerTokenIdentifier,
    args.wikiPageId,
  );
  const progressObservedAt = Date.now();
  const existingMeaningfulUseSessionIsLive =
    existing?.meaningfulUseSession !== undefined &&
    existing.meaningfulUseSessionExpiresAt !== undefined &&
    existing.meaningfulUseSessionExpiresAt > progressObservedAt;
  let meaningfulUseSession = existingMeaningfulUseSessionIsLive
    ? existing.meaningfulUseSession
    : undefined;
  let meaningfulUseSessionExpiresAt = existingMeaningfulUseSessionIsLive
    ? existing?.meaningfulUseSessionExpiresAt
    : undefined;

  if (heardRanges.length === 0 && existing) {
    if (
      !existingMeaningfulUseSessionIsLive &&
      (existing.meaningfulUseSession !== undefined ||
        existing.meaningfulUseSessionExpiresAt !== undefined)
    ) {
      await ctx.db.patch(existing._id, {
        meaningfulUseSession: undefined,
        meaningfulUseSessionExpiresAt: undefined,
      });
    }
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
  const ledgerEnabled =
    Boolean(dependencies.recordListeningContribution) &&
    (dependencies.isEnabled?.() ?? true);
  let listeningLedgerUpdate = {
    newUniqueSeconds: 0,
    meaningfulUse: false,
    newlyMeaningfulUse: false,
    heardProgressSectionKeys: [] as string[],
  };
  let meaningfulUseSessionStartedAt: number | null = null;
  if (ledgerEnabled) {
    try {
      const article = await ctx.db.get(args.articleId);
      const progressSectionKeys = article
        ? buildArticleNarrationTracks(article)
            .filter((track) => track.countsTowardProgress)
            .map((track) => track.sectionKey)
        : [];
      const observedAt = progressObservedAt;
      const reportedSessionStartedAt =
        Number.isSafeInteger(args.listeningSessionStartedAt) &&
        (args.listeningSessionStartedAt ?? -1) >= 0 &&
        (args.listeningSessionStartedAt ?? Number.POSITIVE_INFINITY) <=
          observedAt
          ? args.listeningSessionStartedAt!
          : null;
      meaningfulUseSessionStartedAt = reportedSessionStartedAt;
      const existingSession =
        reportedSessionStartedAt !== null &&
        meaningfulUseSession?.startedAt === reportedSessionStartedAt
          ? meaningfulUseSession
          : null;
      const canStartSession =
        reportedSessionStartedAt !== null &&
        (existingSession !== null ||
          reportedSessionStartedAt >
            observedAt - MEANINGFUL_USE_SESSION_RETENTION_MS);
      const sessionIsStale =
        reportedSessionStartedAt !== null &&
        meaningfulUseSession !== undefined &&
        reportedSessionStartedAt < meaningfulUseSession.startedAt;
      const existingSessionSections = existingSession?.sections ?? [];
      const mergedSessionSections =
        canStartSession && !sessionIsStale
          ? mergeProgressSections(existingSessionSections, {
              sectionKey: args.sectionKey,
              sectionDurationSeconds,
              heardRanges,
            })
          : existingSessionSections;
      if (canStartSession && !sessionIsStale) {
        meaningfulUseSession = {
          startedAt: reportedSessionStartedAt!,
          sections: mergedSessionSections.slice(0, 250),
        };
        meaningfulUseSessionExpiresAt =
          observedAt + MEANINGFUL_USE_SESSION_RETENTION_MS;
      }
      listeningLedgerUpdate = calculateListeningLedgerUpdate({
        existingSections: existing?.sections ?? [],
        mergedSections: sections,
        updatedSectionKey: args.sectionKey,
        progressSectionKeys,
        existingSessionSections,
        mergedSessionSections,
      });
    } catch {
      console.warn("[ai-cost-ledger] Listening cohort could not be resolved.");
    }
  }
  const heardSeconds = calculateHeardSeconds(sections);
  const reachedThreshold =
    heardSeconds / Math.max(1, totalDurationSeconds) >=
    QUALIFYING_LISTEN_FRACTION;

  let awardedBadgeKeys: BadgeKey[] = [];
  let awardedBadges: BadgeListenProgressResult["awardedBadges"] = [];
  const qualifiedAt =
    existing?.qualifiedAt ?? (reachedThreshold ? Date.now() : undefined);

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
    meaningfulUseSession,
    meaningfulUseSessionExpiresAt,
    updatedAt: progressObservedAt,
  };

  if (existing) {
    await ctx.db.patch(existing._id, data);
  } else {
    await ctx.db.insert("viewerArticleListenProgress", {
      ...data,
      createdAt: Date.now(),
    });
  }

  if (
    dependencies.recordListeningContribution &&
    (listeningLedgerUpdate.newUniqueSeconds > 0 ||
      listeningLedgerUpdate.newlyMeaningfulUse)
  ) {
    try {
      const observedAt = Date.now();
      const reportedProgressStartedAt =
        Number.isSafeInteger(args.progressStartedAt) &&
        (args.progressStartedAt ?? -1) >= 0
          ? Math.min(args.progressStartedAt!, observedAt)
          : observedAt;
      const sectionKeys =
        listeningLedgerUpdate.newlyMeaningfulUse &&
        listeningLedgerUpdate.heardProgressSectionKeys.length > 0
          ? listeningLedgerUpdate.heardProgressSectionKeys
          : [args.sectionKey];
      // A single contribution currently carries one cutoff. Using the earliest
      // session cutoff for a cross-section qualification can under-attribute
      // later generations, but it cannot credit a generation the listener had
      // not heard when an earlier section played.
      const progressStartedAt =
        listeningLedgerUpdate.newlyMeaningfulUse &&
        meaningfulUseSessionStartedAt !== null
          ? meaningfulUseSessionStartedAt
          : reportedProgressStartedAt;
      await dependencies.recordListeningContribution(ctx, {
        eventKey: crypto.randomUUID(),
        articleId: args.articleId,
        sectionKeys,
        newUniqueSeconds: listeningLedgerUpdate.newUniqueSeconds,
        meaningfulUse: listeningLedgerUpdate.newlyMeaningfulUse,
        progressStartedAt,
        observedAt,
      });
    } catch {
      console.warn("[ai-cost-ledger] Listening contribution was not recorded.");
    }
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
  const viewerTokenIdentifier =
    await getAuthenticatedViewerTokenIdentifier(ctx);
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

export const cleanupExpiredMeaningfulUseSessionsForCtx = async (
  ctx: Pick<MutationCtx, "db" | "scheduler">,
  args: {
    now: number;
    limit: number;
    cursor: string | null;
    phase?: "expired" | "legacy";
  },
) => {
  const phase = args.phase ?? "expired";
  const result = await ctx.db
    .query("viewerArticleListenProgress")
    .withIndex("by_meaningfulUseSessionExpiresAt_sessionStartedAt", (q) =>
      phase === "legacy"
        ? q
            .eq("meaningfulUseSessionExpiresAt", undefined)
            .gt("meaningfulUseSession.startedAt", undefined)
        : q
            .gt("meaningfulUseSessionExpiresAt", undefined)
            .lte("meaningfulUseSessionExpiresAt", args.now),
    )
    .paginate({
      cursor: args.cursor,
      numItems: args.limit,
    });
  const expiredSessions = result.page.filter(
    (progress) =>
      progress.meaningfulUseSession !== undefined &&
      (progress.meaningfulUseSessionExpiresAt === undefined ||
        progress.meaningfulUseSessionExpiresAt <= args.now),
  );

  await Promise.all(
    expiredSessions.map((progress) =>
      ctx.db.patch(progress._id, {
        meaningfulUseSession: undefined,
        meaningfulUseSessionExpiresAt: undefined,
      }),
    ),
  );

  if (!result.isDone) {
    await ctx.scheduler.runAfter(
      0,
      internal.badges.cleanupExpiredMeaningfulUseSessions,
      { cursor: result.continueCursor, phase },
    );
  } else if (phase === "expired") {
    await ctx.scheduler.runAfter(
      0,
      internal.badges.cleanupExpiredMeaningfulUseSessions,
      { phase: "legacy" },
    );
  }

  return {
    cleared: expiredSessions.length,
    continueCursor: result.continueCursor,
    isDone: result.isDone,
  };
};

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
    listeningSessionStartedAt: v.optional(v.number()),
    progressStartedAt: v.optional(v.number()),
  },
  handler: (ctx, args) => recordViewerArticleListenProgressForCtx(ctx, args),
});

export const cleanupExpiredMeaningfulUseSessions = internalMutation({
  args: {
    cursor: v.optional(v.string()),
    phase: v.optional(v.union(v.literal("expired"), v.literal("legacy"))),
  },
  handler: async (ctx, args) => {
    const result = await cleanupExpiredMeaningfulUseSessionsForCtx(ctx, {
      now: Date.now(),
      limit: MEANINGFUL_USE_SESSION_CLEANUP_BATCH_SIZE,
      cursor: args.cursor ?? null,
      phase: args.phase ?? "expired",
    });
    return result;
  },
});

export const badgeDefinitions = BADGE_DEFINITIONS;
export const badgeKeyValue = badgeKeyValidator;
