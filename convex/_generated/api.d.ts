/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountData from "../accountData.js";
import type * as analyticsRollups from "../analyticsRollups.js";
import type * as articleContextCache from "../articleContextCache.js";
import type * as articleContextModeration from "../articleContextModeration.js";
import type * as articleContextReports from "../articleContextReports.js";
import type * as articleContextValidation from "../articleContextValidation.js";
import type * as articleContexts from "../articleContexts.js";
import type * as articleExports from "../articleExports.js";
import type * as articles from "../articles.js";
import type * as audio from "../audio.js";
import type * as auth from "../auth.js";
import type * as badges from "../badges.js";
import type * as bookmarks from "../bookmarks.js";
import type * as crons from "../crons.js";
import type * as didYouKnow from "../didYouKnow.js";
import type * as lib_accountQuotaKeys from "../lib/accountQuotaKeys.js";
import type * as lib_articleAudioPipeline from "../lib/articleAudioPipeline.js";
import type * as lib_personalPlaylistPersistence from "../lib/personalPlaylistPersistence.js";
import type * as lib_personalPlaylistWorker from "../lib/personalPlaylistWorker.js";
import type * as lib_storageUpload from "../lib/storageUpload.js";
import type * as lib_ttsAudioVariants from "../lib/ttsAudioVariants.js";
import type * as lib_wikipedia from "../lib/wikipedia.js";
import type * as personalPlaylist from "../personalPlaylist.js";
import type * as pictureOfDay from "../pictureOfDay.js";
import type * as podcast from "../podcast.js";
import type * as productFeedback from "../productFeedback.js";
import type * as rateLimits from "../rateLimits.js";
import type * as search from "../search.js";
import type * as today from "../today.js";
import type * as trending from "../trending.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountData: typeof accountData;
  analyticsRollups: typeof analyticsRollups;
  articleContextCache: typeof articleContextCache;
  articleContextModeration: typeof articleContextModeration;
  articleContextReports: typeof articleContextReports;
  articleContextValidation: typeof articleContextValidation;
  articleContexts: typeof articleContexts;
  articleExports: typeof articleExports;
  articles: typeof articles;
  audio: typeof audio;
  auth: typeof auth;
  badges: typeof badges;
  bookmarks: typeof bookmarks;
  crons: typeof crons;
  didYouKnow: typeof didYouKnow;
  "lib/accountQuotaKeys": typeof lib_accountQuotaKeys;
  "lib/articleAudioPipeline": typeof lib_articleAudioPipeline;
  "lib/personalPlaylistPersistence": typeof lib_personalPlaylistPersistence;
  "lib/personalPlaylistWorker": typeof lib_personalPlaylistWorker;
  "lib/storageUpload": typeof lib_storageUpload;
  "lib/ttsAudioVariants": typeof lib_ttsAudioVariants;
  "lib/wikipedia": typeof lib_wikipedia;
  personalPlaylist: typeof personalPlaylist;
  pictureOfDay: typeof pictureOfDay;
  podcast: typeof podcast;
  productFeedback: typeof productFeedback;
  rateLimits: typeof rateLimits;
  search: typeof search;
  today: typeof today;
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
