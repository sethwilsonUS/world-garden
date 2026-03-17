/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as articleExports from "../articleExports.js";
import type * as articles from "../articles.js";
import type * as audio from "../audio.js";
import type * as auth from "../auth.js";
import type * as bookmarks from "../bookmarks.js";
import type * as didYouKnow from "../didYouKnow.js";
import type * as lib_wikipedia from "../lib/wikipedia.js";
import type * as podcast from "../podcast.js";
import type * as rateLimits from "../rateLimits.js";
import type * as search from "../search.js";
import type * as trending from "../trending.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  articleExports: typeof articleExports;
  articles: typeof articles;
  audio: typeof audio;
  auth: typeof auth;
  bookmarks: typeof bookmarks;
  didYouKnow: typeof didYouKnow;
  "lib/wikipedia": typeof lib_wikipedia;
  podcast: typeof podcast;
  rateLimits: typeof rateLimits;
  search: typeof search;
  trending: typeof trending;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
