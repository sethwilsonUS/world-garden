import { getFunctionName } from "convex/server";

import { publicWikipediaApi } from "./convexPublicApi";

describe("publicWikipediaApi", () => {
  it("pins the native client to the reviewed public action names", () => {
    expect(getFunctionName(publicWikipediaApi.search)).toBe("search:search");
    expect(getFunctionName(publicWikipediaApi.fetchArticle)).toBe(
      "articles:fetchAndCacheBySlug",
    );
  });
});
