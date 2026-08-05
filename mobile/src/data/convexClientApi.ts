import type {
  BookmarkEntry,
  WikipediaArticle,
  WikipediaSearchResult,
} from "@curio-garden/domain";
import { makeFunctionReference } from "convex/server";

interface NativeViewerIdentity {
  readonly email: string | null;
  readonly name: string | null;
  readonly subject: string;
}

/**
 * Convex functions consumed by the native client.
 *
 * Convex documents `makeFunctionReference` for clients that do not consume its
 * generated API. Keeping every reviewed function name in this one audited seam
 * prevents the mobile TypeScript project from following the generated
 * declaration graph through server and web implementations.
 */
export const convexClientApi = Object.freeze({
  auth: Object.freeze({
    nativeViewer: makeFunctionReference<
      "query",
      Record<string, never>,
      NativeViewerIdentity | null
    >("auth:nativeViewer"),
  }),
  bookmarks: Object.freeze({
    listNative: makeFunctionReference<
      "query",
      { expectedAccountSubject: string; sessionEpochKey: string },
      { entries: BookmarkEntry[]; sessionEpochKey: string }
    >("bookmarks:listNativeViewerBookmarks"),
    removeNative: makeFunctionReference<
      "mutation",
      {
        expectedAccountSubject: string;
        sessionEpochKey: string;
        slug: string;
      },
      { removed: boolean; sessionEpochKey: string }
    >("bookmarks:removeNativeViewerBookmark"),
    saveNative: makeFunctionReference<
      "mutation",
      {
        expectedAccountSubject: string;
        sessionEpochKey: string;
        slug: string;
        title: string;
      },
      { entry: BookmarkEntry; sessionEpochKey: string }
    >("bookmarks:saveNativeViewerBookmark"),
  }),
  wikipedia: Object.freeze({
    fetchArticle: makeFunctionReference<
      "action",
      { slug: string },
      WikipediaArticle
    >("articles:fetchAndCacheBySlug"),
    search: makeFunctionReference<
      "action",
      { term: string },
      WikipediaSearchResult[]
    >("search:search"),
  }),
});
