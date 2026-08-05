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
  });
});
