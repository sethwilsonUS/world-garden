import type { ContextSection } from "./article-context-types";

/**
 * Compact, parser-independent table projection consumed by the deterministic
 * chart and timeline classifiers. MediaWiki structure is resolved before this
 * boundary; these helpers only inspect already-associated cell text.
 */
export type ArticleContextTable = {
  caption: string;
  context: string;
  headers: string[];
  headerPaths: string[][];
  rows: string[][];
  position: number;
  section: ContextSection;
};
