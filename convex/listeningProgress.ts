import {
  normalizeMediaWikiNumericId,
  normalizeResumeCursor,
  RESUME_CURSOR_LIMITS,
  resumeCursorMatchesTarget,
  type ResumeCursor,
} from "@curio-garden/domain";
import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { getBoundNativeViewerTokenIdentifier } from "./bookmarks";
import {
  buildArticleNarrationTracks,
  type ArticleNarrationSource,
} from "../lib/section-narration";

type NativeResumeCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

type NativeResumeIdentity = {
  expectedAccountSubject: string;
  sessionEpochKey: string;
  wikiPageId: string;
};

type ServerResumeCursor = ResumeCursor & {
  cursorVersion: number;
  updatedAt: number;
};

type NativeResumeResponse = {
  sessionEpochKey: string;
  cursorVersion: number;
  cursor: ServerResumeCursor | null;
};

type NativeResumeMutationArgs = NativeResumeIdentity & {
  expectedCursorVersion: number;
  cursor: {
    wikiPageId: string;
    revisionId: string;
    narrationVersion: number;
    mode: "all" | "single";
    sectionKey: string;
    positionSeconds: number;
    durationSeconds: number;
  } | null;
};

type NativeResumeMutationResponse = NativeResumeResponse & {
  disposition: "applied" | "stale";
};

const resumeCursorModeValidator = v.union(
  v.literal("all"),
  v.literal("single"),
);

const clientResumeCursorValidator = v.object({
  wikiPageId: v.string(),
  revisionId: v.string(),
  narrationVersion: v.number(),
  mode: resumeCursorModeValidator,
  sectionKey: v.string(),
  positionSeconds: v.number(),
  durationSeconds: v.number(),
});

const serverResumeCursorValidator = v.object({
  wikiPageId: v.string(),
  revisionId: v.string(),
  narrationVersion: v.number(),
  mode: resumeCursorModeValidator,
  sectionKey: v.string(),
  positionSeconds: v.number(),
  durationSeconds: v.number(),
  cursorVersion: v.number(),
  updatedAt: v.number(),
});

const resumeResponseValidator = v.object({
  sessionEpochKey: v.string(),
  cursorVersion: v.number(),
  cursor: v.union(v.null(), serverResumeCursorValidator),
});

const nativeResumeIdentityArgs = {
  expectedAccountSubject: v.string(),
  sessionEpochKey: v.string(),
  wikiPageId: v.string(),
};

const requireWikiPageId = (value: string): string => {
  const wikiPageId = normalizeMediaWikiNumericId(value);
  if (wikiPageId === null) {
    throw new Error("Invalid listening progress request.");
  }
  return wikiPageId;
};

const invalidRequest = (): never => {
  throw new Error("Invalid listening progress request.");
};

const requireCursorVersion = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return invalidRequest();
  }
  return value;
};

const readStoredCursorVersion = (
  stored: {
    resumeCursorVersion?: unknown;
    resumeCursor?: unknown;
  } | null,
): number => {
  if (stored?.resumeCursorVersion === undefined) {
    return stored?.resumeCursor === undefined ? 0 : invalidRequest();
  }
  const cursorVersion = requireCursorVersion(stored.resumeCursorVersion);
  if (stored.resumeCursor !== undefined && cursorVersion === 0) {
    return invalidRequest();
  }
  return cursorVersion;
};

const TTS_WORDS_PER_SECOND = 2.5;

const estimateNarrationTrackDurationSeconds = (text: string): number => {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(wordCount / TTS_WORDS_PER_SECOND));
};

export const sumEstimatedProgressDurationSeconds = (
  trackDurations: readonly number[],
): number | null => {
  let totalDurationSeconds = 0;
  for (const durationSeconds of trackDurations) {
    if (
      !Number.isSafeInteger(durationSeconds) ||
      durationSeconds < 1 ||
      totalDurationSeconds >
        RESUME_CURSOR_LIMITS.maxDurationSeconds - durationSeconds
    ) {
      return null;
    }
    totalDurationSeconds += durationSeconds;
  }
  return Math.max(1, totalDurationSeconds);
};

export const estimateArticleProgressDurationSeconds = (
  article: ArticleNarrationSource,
): number | null =>
  sumEstimatedProgressDurationSeconds(
    buildArticleNarrationTracks(article)
      .filter((track) => track.countsTowardProgress)
      .map((track) => estimateNarrationTrackDurationSeconds(track.text)),
  );

const getCurrentArticleByWikiPageId = async (
  ctx: NativeResumeCtx,
  wikiPageId: string,
) =>
  await ctx.db
    .query("articles")
    .withIndex("by_wikiPageId", (index) => index.eq("wikiPageId", wikiPageId))
    .first();

const getExistingProgress = async (
  ctx: NativeResumeCtx,
  viewerTokenIdentifier: string,
  wikiPageId: string,
) =>
  await ctx.db
    .query("viewerArticleListenProgress")
    .withIndex("by_viewerTokenIdentifier_wikiPageId", (index) =>
      index
        .eq("viewerTokenIdentifier", viewerTokenIdentifier)
        .eq("wikiPageId", wikiPageId),
    )
    .unique();

const getArticleRouteSlug = (article: {
  slug?: string;
  title: string;
}): string => {
  const stored = article.slug?.normalize("NFC").trim();
  if (stored) return stored;
  const title = article.title.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!title) return invalidRequest();
  return title.replaceAll(" ", "_");
};

const requireCursorForArticle = (
  value: unknown,
  wikiPageId: string,
  article: NonNullable<
    Awaited<ReturnType<typeof getCurrentArticleByWikiPageId>>
  >,
): ResumeCursor => {
  const cursor = normalizeResumeCursor(value);
  const revisionId = normalizeMediaWikiNumericId(article.revisionId);
  const narrationVersion = article.narrationVersion;
  if (
    cursor === null ||
    cursor.wikiPageId !== wikiPageId ||
    revisionId === null ||
    typeof narrationVersion !== "number" ||
    !Number.isSafeInteger(narrationVersion) ||
    !resumeCursorMatchesTarget(cursor, {
      wikiPageId,
      revisionId,
      narrationVersion,
    })
  ) {
    return invalidRequest();
  }

  const track = buildArticleNarrationTracks(article).find(
    (candidate) => candidate.sectionKey === cursor.sectionKey,
  );
  if (
    track === undefined ||
    (cursor.mode === "single" && !track.individuallyPlayable)
  ) {
    return invalidRequest();
  }
  return cursor;
};

const projectLiveCursor = async (
  ctx: NativeResumeCtx,
  wikiPageId: string,
  cursorVersion: number,
  stored: {
    revisionId: string;
    narrationVersion: number;
    mode: "all" | "single";
    sectionKey: string;
    positionSeconds: number;
    durationSeconds: number;
    updatedAt: number;
  },
): Promise<ServerResumeCursor | null> => {
  const cursor = normalizeResumeCursor({
    wikiPageId,
    revisionId: stored.revisionId,
    narrationVersion: stored.narrationVersion,
    mode: stored.mode,
    sectionKey: stored.sectionKey,
    positionSeconds: stored.positionSeconds,
    durationSeconds: stored.durationSeconds,
  });
  if (
    cursor === null ||
    !Number.isSafeInteger(stored.updatedAt) ||
    stored.updatedAt < 0
  ) {
    return null;
  }

  const article = await getCurrentArticleByWikiPageId(ctx, wikiPageId);
  const revisionId = normalizeMediaWikiNumericId(article?.revisionId);
  const narrationVersion = article?.narrationVersion;
  if (
    article === null ||
    revisionId === null ||
    typeof narrationVersion !== "number" ||
    !Number.isSafeInteger(narrationVersion) ||
    !resumeCursorMatchesTarget(cursor, {
      wikiPageId,
      revisionId,
      narrationVersion,
    })
  ) {
    return null;
  }

  const track = buildArticleNarrationTracks(article).find(
    (candidate) => candidate.sectionKey === cursor.sectionKey,
  );
  if (
    track === undefined ||
    (cursor.mode === "single" && !track.individuallyPlayable)
  ) {
    return null;
  }

  return {
    ...cursor,
    cursorVersion,
    updatedAt: stored.updatedAt,
  };
};

export const getNativeViewerArticleResumeForCtx = async (
  ctx: NativeResumeCtx,
  args: NativeResumeIdentity,
): Promise<NativeResumeResponse> => {
  const viewerTokenIdentifier = await getBoundNativeViewerTokenIdentifier(
    ctx,
    args.expectedAccountSubject,
  );
  const wikiPageId = requireWikiPageId(args.wikiPageId);
  const existing = await getExistingProgress(
    ctx,
    viewerTokenIdentifier,
    wikiPageId,
  );
  const cursorVersion = readStoredCursorVersion(existing);
  const cursor = existing?.resumeCursor
    ? await projectLiveCursor(
        ctx,
        wikiPageId,
        cursorVersion,
        existing.resumeCursor,
      )
    : null;

  return {
    sessionEpochKey: args.sessionEpochKey,
    cursorVersion,
    cursor,
  };
};

export const writeNativeViewerArticleResumeForCtx = async (
  ctx: Pick<MutationCtx, "auth" | "db">,
  args: NativeResumeMutationArgs,
): Promise<NativeResumeMutationResponse> => {
  const viewerTokenIdentifier = await getBoundNativeViewerTokenIdentifier(
    ctx,
    args.expectedAccountSubject,
  );
  const wikiPageId = requireWikiPageId(args.wikiPageId);
  const expectedCursorVersion = requireCursorVersion(
    args.expectedCursorVersion,
  );
  const existing = await getExistingProgress(
    ctx,
    viewerTokenIdentifier,
    wikiPageId,
  );
  const cursorVersion = readStoredCursorVersion(existing);

  if (expectedCursorVersion !== cursorVersion) {
    const cursor = existing?.resumeCursor
      ? await projectLiveCursor(
          ctx,
          wikiPageId,
          cursorVersion,
          existing.resumeCursor,
        )
      : null;
    return {
      sessionEpochKey: args.sessionEpochKey,
      cursorVersion,
      cursor,
      disposition: "stale",
    };
  }
  if (cursorVersion >= Number.MAX_SAFE_INTEGER) return invalidRequest();

  const article =
    args.cursor !== null || existing === null
      ? await getCurrentArticleByWikiPageId(ctx, wikiPageId)
      : null;
  if ((args.cursor !== null || existing === null) && article === null) {
    return invalidRequest();
  }
  const cursor =
    args.cursor === null
      ? null
      : requireCursorForArticle(args.cursor, wikiPageId, article!);
  const nextCursorVersion = cursorVersion + 1;
  const updatedAt = Date.now();
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    return invalidRequest();
  }
  const storedCursor = cursor
    ? {
        revisionId: cursor.revisionId,
        narrationVersion: cursor.narrationVersion,
        mode: cursor.mode,
        sectionKey: cursor.sectionKey,
        positionSeconds: cursor.positionSeconds,
        durationSeconds: cursor.durationSeconds,
        updatedAt,
      }
    : undefined;
  const articleMetadata = article
    ? {
        articleId: article._id,
        wikiPageId,
        slug: getArticleRouteSlug(article),
        title: article.title,
      }
    : null;
  const estimatedArticleDurationSeconds =
    existing === null && article
      ? estimateArticleProgressDurationSeconds(article)
      : null;
  if (existing === null && estimatedArticleDurationSeconds === null) {
    return invalidRequest();
  }

  if (existing) {
    await ctx.db.patch(existing._id, {
      ...(articleMetadata ?? {}),
      resumeCursorVersion: nextCursorVersion,
      resumeCursor: storedCursor,
      updatedAt,
    });
  } else {
    if (articleMetadata === null) return invalidRequest();
    await ctx.db.insert("viewerArticleListenProgress", {
      viewerTokenIdentifier,
      ...articleMetadata,
      totalDurationSeconds: estimatedArticleDurationSeconds!,
      heardSeconds: 0,
      sections: [],
      resumeCursorVersion: nextCursorVersion,
      ...(storedCursor ? { resumeCursor: storedCursor } : {}),
      createdAt: updatedAt,
      updatedAt,
    });
  }

  return {
    sessionEpochKey: args.sessionEpochKey,
    cursorVersion: nextCursorVersion,
    cursor: cursor
      ? { ...cursor, cursorVersion: nextCursorVersion, updatedAt }
      : null,
    disposition: "applied",
  };
};

export const getNativeViewerArticleResume = query({
  args: nativeResumeIdentityArgs,
  returns: resumeResponseValidator,
  handler: (ctx, args) => getNativeViewerArticleResumeForCtx(ctx, args),
});

export const writeNativeViewerArticleResume = mutation({
  args: {
    ...nativeResumeIdentityArgs,
    expectedCursorVersion: v.number(),
    cursor: v.union(v.null(), clientResumeCursorValidator),
  },
  returns: v.object({
    sessionEpochKey: v.string(),
    cursorVersion: v.number(),
    cursor: v.union(v.null(), serverResumeCursorValidator),
    disposition: v.union(v.literal("applied"), v.literal("stale")),
  }),
  handler: (ctx, args) => writeNativeViewerArticleResumeForCtx(ctx, args),
});
