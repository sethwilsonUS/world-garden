import {
  normalizeBookmarkEntries,
  type BookmarkEntry,
} from "@curio-garden/domain";
import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { assertViewerAccountActiveForCtx } from "./lib/accountDeletionState";

type BookmarkDoc = BookmarkEntry & {
  _id: string;
  viewerTokenIdentifier: string;
  updatedAt: number;
};

type ViewerAuthCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

type BookmarkQueryCtx = Pick<QueryCtx, "auth" | "db">;
type BookmarkMutationCtx = Pick<MutationCtx, "auth" | "db">;

interface NativeBookmarkRequestIdentity {
  readonly expectedAccountSubject: string;
  readonly sessionEpochKey: string;
}

const bookmarkEntryValidator = v.object({
  slug: v.string(),
  title: v.string(),
  savedAt: v.number(),
});

const toPublicBookmarkEntry = (entry: BookmarkDoc): BookmarkEntry => {
  return {
    slug: entry.slug,
    title: entry.title,
    savedAt: entry.savedAt,
  };
};

export const getAuthenticatedViewerTokenIdentifier = async (
  ctx: ViewerAuthCtx,
): Promise<string> => {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Unauthorized");
  }

  await assertViewerAccountActiveForCtx(ctx, identity.tokenIdentifier);
  return identity.tokenIdentifier;
};

export const getBoundNativeViewerTokenIdentifier = async (
  ctx: ViewerAuthCtx,
  expectedAccountSubject: string,
): Promise<string> => {
  const identity = await ctx.auth.getUserIdentity();

  if (!identity) {
    throw new Error("Unauthorized");
  }
  if (identity.subject !== expectedAccountSubject) {
    throw new Error("Account changed");
  }

  await assertViewerAccountActiveForCtx(ctx, identity.tokenIdentifier);
  return identity.tokenIdentifier;
};

const getExistingBookmark = async (
  ctx: BookmarkQueryCtx | BookmarkMutationCtx,
  viewerTokenIdentifier: string,
  slug: string,
): Promise<BookmarkDoc | null> => {
  return (await ctx.db
    .query("bookmarks")
    .withIndex("by_viewerTokenIdentifier_slug", (q) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier).eq("slug", slug),
    )
    .unique()) as BookmarkDoc | null;
};

export const listViewerBookmarksForCtx = async (
  ctx: BookmarkQueryCtx,
): Promise<BookmarkEntry[]> => {
  const viewerTokenIdentifier =
    await getAuthenticatedViewerTokenIdentifier(ctx);
  return listBookmarksForViewer(ctx, viewerTokenIdentifier);
};

const listBookmarksForViewer = async (
  ctx: BookmarkQueryCtx,
  viewerTokenIdentifier: string,
): Promise<BookmarkEntry[]> => {
  const bookmarks = (await ctx.db
    .query("bookmarks")
    .withIndex("by_viewerTokenIdentifier", (q) =>
      q.eq("viewerTokenIdentifier", viewerTokenIdentifier),
    )
    .collect()) as BookmarkDoc[];

  return bookmarks
    .sort((a, b) => b.savedAt - a.savedAt || b.updatedAt - a.updatedAt)
    .map(toPublicBookmarkEntry);
};

export const listNativeViewerBookmarksForCtx = async (
  ctx: BookmarkQueryCtx,
  args: NativeBookmarkRequestIdentity,
): Promise<{ sessionEpochKey: string; entries: BookmarkEntry[] }> => {
  const viewerTokenIdentifier = await getBoundNativeViewerTokenIdentifier(
    ctx,
    args.expectedAccountSubject,
  );

  return {
    sessionEpochKey: args.sessionEpochKey,
    entries: normalizeBookmarkEntries(
      await listBookmarksForViewer(ctx, viewerTokenIdentifier),
    ),
  };
};

export const saveViewerBookmarkForCtx = async (
  ctx: BookmarkMutationCtx,
  args: {
    slug: string;
    title: string;
  },
): Promise<BookmarkEntry> => {
  const viewerTokenIdentifier =
    await getAuthenticatedViewerTokenIdentifier(ctx);
  return saveBookmarkForViewer(ctx, viewerTokenIdentifier, args);
};

const saveBookmarkForViewer = async (
  ctx: BookmarkMutationCtx,
  viewerTokenIdentifier: string,
  args: {
    slug: string;
    title: string;
  },
): Promise<BookmarkEntry> => {
  const now = Date.now();
  const existing = await getExistingBookmark(
    ctx,
    viewerTokenIdentifier,
    args.slug,
  );

  if (existing) {
    await ctx.db.patch(existing._id as never, {
      title: args.title,
      updatedAt: now,
    });

    return {
      slug: existing.slug,
      title: args.title,
      savedAt: existing.savedAt,
    };
  }

  await ctx.db.insert("bookmarks", {
    viewerTokenIdentifier,
    slug: args.slug,
    title: args.title,
    savedAt: now,
    updatedAt: now,
  });

  return {
    slug: args.slug,
    title: args.title,
    savedAt: now,
  };
};

export const saveNativeViewerBookmarkForCtx = async (
  ctx: BookmarkMutationCtx,
  args: NativeBookmarkRequestIdentity & {
    slug: string;
    title: string;
  },
): Promise<{ entry: BookmarkEntry; sessionEpochKey: string }> => {
  const viewerTokenIdentifier = await getBoundNativeViewerTokenIdentifier(
    ctx,
    args.expectedAccountSubject,
  );
  const entry = await saveBookmarkForViewer(ctx, viewerTokenIdentifier, args);

  return { entry, sessionEpochKey: args.sessionEpochKey };
};

export const removeViewerBookmarkForCtx = async (
  ctx: BookmarkMutationCtx,
  args: {
    slug: string;
  },
): Promise<{ removed: boolean }> => {
  const viewerTokenIdentifier =
    await getAuthenticatedViewerTokenIdentifier(ctx);
  return removeBookmarkForViewer(ctx, viewerTokenIdentifier, args);
};

const removeBookmarkForViewer = async (
  ctx: BookmarkMutationCtx,
  viewerTokenIdentifier: string,
  args: {
    slug: string;
  },
): Promise<{ removed: boolean }> => {
  const existing = await getExistingBookmark(
    ctx,
    viewerTokenIdentifier,
    args.slug,
  );

  if (!existing) {
    return { removed: false };
  }

  await ctx.db.delete(existing._id as never);
  return { removed: true };
};

export const removeNativeViewerBookmarkForCtx = async (
  ctx: BookmarkMutationCtx,
  args: NativeBookmarkRequestIdentity & {
    slug: string;
  },
): Promise<{ removed: boolean; sessionEpochKey: string }> => {
  const viewerTokenIdentifier = await getBoundNativeViewerTokenIdentifier(
    ctx,
    args.expectedAccountSubject,
  );
  const { removed } = await removeBookmarkForViewer(
    ctx,
    viewerTokenIdentifier,
    args,
  );

  return { removed, sessionEpochKey: args.sessionEpochKey };
};

export const importGuestBookmarksForCtx = async (
  ctx: BookmarkMutationCtx,
  args: {
    entries: BookmarkEntry[];
  },
): Promise<{ importedCount: number }> => {
  const viewerTokenIdentifier =
    await getAuthenticatedViewerTokenIdentifier(ctx);
  const entries = normalizeBookmarkEntries(args.entries);
  let importedCount = 0;

  for (const entry of entries) {
    const existing = await getExistingBookmark(
      ctx,
      viewerTokenIdentifier,
      entry.slug,
    );
    if (existing) {
      continue;
    }

    await ctx.db.insert("bookmarks", {
      viewerTokenIdentifier,
      slug: entry.slug,
      title: entry.title,
      savedAt: entry.savedAt,
      updatedAt: Date.now(),
    });
    importedCount += 1;
  }

  return { importedCount };
};

export const listViewerBookmarks = query({
  args: {},
  handler: listViewerBookmarksForCtx,
});

export const listNativeViewerBookmarks = query({
  args: {
    expectedAccountSubject: v.string(),
    sessionEpochKey: v.string(),
  },
  returns: v.object({
    sessionEpochKey: v.string(),
    entries: v.array(bookmarkEntryValidator),
  }),
  handler: (ctx, args) => listNativeViewerBookmarksForCtx(ctx, args),
});

export const saveViewerBookmark = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
  },
  handler: (ctx, args) => saveViewerBookmarkForCtx(ctx, args),
});

export const removeViewerBookmark = mutation({
  args: {
    slug: v.string(),
  },
  handler: (ctx, args) => removeViewerBookmarkForCtx(ctx, args),
});

export const saveNativeViewerBookmark = mutation({
  args: {
    expectedAccountSubject: v.string(),
    sessionEpochKey: v.string(),
    slug: v.string(),
    title: v.string(),
  },
  returns: v.object({
    entry: bookmarkEntryValidator,
    sessionEpochKey: v.string(),
  }),
  handler: (ctx, args) => saveNativeViewerBookmarkForCtx(ctx, args),
});

export const removeNativeViewerBookmark = mutation({
  args: {
    expectedAccountSubject: v.string(),
    sessionEpochKey: v.string(),
    slug: v.string(),
  },
  returns: v.object({
    removed: v.boolean(),
    sessionEpochKey: v.string(),
  }),
  handler: (ctx, args) => removeNativeViewerBookmarkForCtx(ctx, args),
});

export const importGuestBookmarks = mutation({
  args: {
    entries: v.array(bookmarkEntryValidator),
  },
  handler: (ctx, args) => importGuestBookmarksForCtx(ctx, args),
});
