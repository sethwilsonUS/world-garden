import { describe, expect, it } from "vitest";
import type {
  WikipediaArticle,
  WikipediaSearchResult,
} from "@curio-garden/domain";
import { getFunctionName, type FunctionReference } from "convex/server";

import { api } from "./_generated/api";

const searchAction: FunctionReference<
  "action",
  "public",
  { term: string },
  WikipediaSearchResult[]
> = api.search.search;

const fetchArticleAction: FunctionReference<
  "action",
  "public",
  { slug: string },
  WikipediaArticle
> = api.articles.fetchAndCacheBySlug;

describe("native public Convex API contract", () => {
  it("keeps the generated public actions aligned with the native references", () => {
    expect(getFunctionName(searchAction)).toBe("search:search");
    expect(getFunctionName(fetchArticleAction)).toBe(
      "articles:fetchAndCacheBySlug",
    );
  });
});
