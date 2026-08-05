import type {
  WikipediaArticle,
  WikipediaSearchResult,
} from "@curio-garden/domain";
import { makeFunctionReference } from "convex/server";

/**
 * Public Convex actions consumed by the native client.
 *
 * Convex documents `makeFunctionReference` for clients that do not consume its
 * generated API. Keeping the two reviewed names here prevents the mobile
 * TypeScript project from following the generated declaration graph through
 * the server and web implementations.
 */
export const publicWikipediaApi = Object.freeze({
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
});
