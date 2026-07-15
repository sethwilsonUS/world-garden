import {
  type ArticleContextRequest,
  type ContextManifest,
} from "./article-context-types";
import {
  fetchRevisionMatchedMediaWikiSource,
  normalizeArticleContextRequest,
  type ArticleContextExtractorOptions,
} from "./article-context-foundations";
import { extractArticleContextFromSource } from "./article-context-assembly";

export {
  ArticleContextInputError,
  ArticleContextUpstreamError,
  fetchRevisionMatchedMediaWikiSource,
  normalizeArticleContextRequest,
  sanitizeContextCaption,
  sanitizeContextText,
} from "./article-context-foundations";
export {
  extractArticleContextFromSource,
  validateContextManifest,
} from "./article-context-assembly";
export { parseContextDateRange } from "./article-context-timelines";
export type {
  ArticleContextExtractorOptions,
  MediaWikiParsedSource,
  MediaWikiSectionSource,
} from "./article-context-foundations";

/** Network + pure extraction convenience; callers may wrap this in any cache. */
export const fetchArticleContextManifest = async (
  input: ArticleContextRequest,
  options: ArticleContextExtractorOptions = {},
): Promise<ContextManifest> => {
  const request = normalizeArticleContextRequest(input);
  const source = await fetchRevisionMatchedMediaWikiSource(request, options);
  return extractArticleContextFromSource(source, request, { now: options.now });
};
