import { getFunctionName } from "convex/server";

import { convexClientApi } from "./convexClientApi";

describe("convexClientApi", () => {
  it("pins the native client to the reviewed public function names", () => {
    expect(getFunctionName(convexClientApi.wikipedia.search)).toBe(
      "search:search",
    );
    expect(getFunctionName(convexClientApi.wikipedia.fetchArticle)).toBe(
      "articles:fetchAndCacheBySlug",
    );
    expect(getFunctionName(convexClientApi.auth.nativeViewer)).toBe(
      "auth:nativeViewer",
    );
    expect(getFunctionName(convexClientApi.bookmarks.listNative)).toBe(
      "bookmarks:listNativeViewerBookmarks",
    );
    expect(getFunctionName(convexClientApi.bookmarks.saveNative)).toBe(
      "bookmarks:saveNativeViewerBookmark",
    );
    expect(getFunctionName(convexClientApi.bookmarks.removeNative)).toBe(
      "bookmarks:removeNativeViewerBookmark",
    );
    expect(getFunctionName(convexClientApi.listeningProgress.getNative)).toBe(
      "listeningProgress:getNativeViewerArticleResume",
    );
    expect(getFunctionName(convexClientApi.listeningProgress.writeNative)).toBe(
      "listeningProgress:writeNativeViewerArticleResume",
    );
  });
});
