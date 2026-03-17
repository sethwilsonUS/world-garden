import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

type BookmarkEntry = {
  slug: string;
  title: string;
  savedAt: number;
};

type BookmarkDoc = BookmarkEntry & {
  _id: string;
  viewerTokenIdentifier: string;
  updatedAt: number;
};

type ViewerAuthCtx = Pick<QueryCtx, "auth"> | Pick<MutationCtx, "auth">;

type BookmarkQueryCtx = Pick<QueryCtx, "auth" | "db">;
type BookmarkMutationCtx = Pick<MutationCtx, "auth" | "db">;

const bookmarkEntryValidator = v.object({
  slug: v.string(),
  title: v.string(),
  savedAt: v.number(),
});

const normalizeBookmarkEntries = (entries: BookmarkEntry[]): BookmarkEntry[] => {
  const deduped = new Map<string, BookmarkEntry>();

  for (const entry of [...entries].sort((a, b) => b.savedAt - a.savedAt)) {
    if (!entry.slug.trim() || !entry.title.trim() || deduped.has(entry.slug)) {
      continue;
    }
    deduped.set(entry.slug, entry);
  }

  return [...deduped.values()];
};

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
  const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
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

export const saveViewerBookmarkForCtx = async (
  ctx: BookmarkMutationCtx,
  args: {
    slug: string;
    title: string;
  },
): Promise<BookmarkEntry> => {
  const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
  const now = Date.now();
  const existing = await getExistingBookmark(ctx, viewerTokenIdentifier, args.slug);

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

export const removeViewerBookmarkForCtx = async (
  ctx: BookmarkMutationCtx,
  args: {
    slug: string;
  },
): Promise<{ removed: boolean }> => {
  const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
  const existing = await getExistingBookmark(ctx, viewerTokenIdentifier, args.slug);

  if (!existing) {
    return { removed: false };
  }

  await ctx.db.delete(existing._id as never);
  return { removed: true };
};

export const importGuestBookmarksForCtx = async (
  ctx: BookmarkMutationCtx,
  args: {
    entries: BookmarkEntry[];
  },
): Promise<{ importedCount: number }> => {
  const viewerTokenIdentifier = await getAuthenticatedViewerTokenIdentifier(ctx);
  const entries = normalizeBookmarkEntries(args.entries);
  let importedCount = 0;

  for (const entry of entries) {
    const existing = await getExistingBookmark(ctx, viewerTokenIdentifier, entry.slug);
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

export const importGuestBookmarks = mutation({
  args: {
    entries: v.array(bookmarkEntryValidator),
  },
  handler: (ctx, args) => importGuestBookmarksForCtx(ctx, args),
});
