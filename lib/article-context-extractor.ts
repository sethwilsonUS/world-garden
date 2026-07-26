import {
  type ArticleContextRequest,
  type ContextManifest,
} from "./article-context-types";
import {
  normalizeArticleContextRequest,
  type ArticleContextExtractorOptions,
  ArticleContextUpstreamError,
} from "./article-context-foundations";
import {
  loadMediaWikiDocument,
  MediaWikiSourceError,
} from "./mediawiki-document";
import { extractArticleContextFromDocument } from "./article-context-document";

export {
  ArticleContextInputError,
  ArticleContextUpstreamError,
  normalizeArticleContextRequest,
  sanitizeContextCaption,
  sanitizeContextText,
} from "./article-context-foundations";
export { validateContextManifest } from "./article-context-validation";
export { parseContextDateRange } from "./article-context-timelines";
export type { ArticleContextExtractorOptions } from "./article-context-foundations";

/** Network + pure extraction convenience; callers may wrap this in any cache. */
export const fetchArticleContextManifest = async (
  input: ArticleContextRequest,
  options: ArticleContextExtractorOptions = {},
): Promise<ContextManifest> => {
  const request = normalizeArticleContextRequest(input);
  try {
    const document = await loadMediaWikiDocument(
      {
        wikiPageId: request.wikiPageId,
        title: request.title,
        revisionId: request.revisionId,
        language: "en",
      },
      { fetchImpl: options.fetchImpl, signal: options.signal },
    );
    return extractArticleContextFromDocument(document, { now: options.now });
  } catch (error) {
    if (error instanceof MediaWikiSourceError) {
      throw new ArticleContextUpstreamError(error.message, error.statusCode);
    }
    throw error;
  }
};
