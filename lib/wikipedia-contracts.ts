import type {
  WikipediaArticle as WikipediaArticleContent,
  WikipediaRevisionIdentity,
  WikipediaSearchResult,
} from "@curio-garden/domain";
import type { BadgeKey } from "@/lib/badges";
import type { NarratedSection } from "@/lib/section-narration";
import type { WikimediaMediaAttribution } from "@/lib/wikimedia-media";

/** Client-safe identity for one immutable Wikipedia article revision. */
export type { WikipediaRevisionIdentity, WikipediaSearchResult };

export type WikipediaSection = NarratedSection;

export type WikipediaArticle = Omit<WikipediaArticleContent, "sections"> & {
  sections?: WikipediaSection[];
  badgeKeys?: BadgeKey[];
};

export type WikipediaLinkedArticle = {
  wikiPageId: string;
  title: string;
  description?: string;
};

export type WikipediaCitation = {
  id: string;
  index: number;
  text: string;
  url?: string;
};

/**
 * Counts projected from one immutable MediaWiki section. `index` is present
 * for semantic-document projections and optional only while legacy cache rows
 * age out.
 */
export type WikipediaSectionCount = {
  index?: string;
  title: string;
  count: number;
};

export type WikipediaArticleImage = {
  src: string;
  originalSrc?: string;
  lightboxSrc?: string;
  lightboxWidth?: number;
  lightboxHeight?: number;
  alt: string;
  caption: string;
  width?: number;
  height?: number;
  videoSrc?: string;
  attribution?: WikimediaMediaAttribution;
};

export type WikipediaParsedPageData = {
  linkCounts: WikipediaSectionCount[];
  citations: WikipediaCitation[];
  sectionCitations: Array<WikipediaSectionCount & { citationIds: string[] }>;
  sectionIndexMap: Array<{ title: string; index: string }>;
  images: WikipediaArticleImage[];
};

export type LocalWikipediaRequest =
  | { operation: "search"; term: string }
  | { operation: "article"; slug: string }
  | { operation: "metadata"; identity: WikipediaRevisionIdentity }
  | {
      operation: "section-links";
      identity: WikipediaRevisionIdentity;
      sectionTitle: string | null;
      sectionIndex?: string;
    };

export type LocalWikipediaResponseFor<Request extends LocalWikipediaRequest> =
  Request extends { operation: "search" }
    ? WikipediaSearchResult[]
    : Request extends { operation: "article" }
      ? WikipediaArticle
      : Request extends { operation: "metadata" }
        ? WikipediaParsedPageData
        : Request extends { operation: "section-links" }
          ? WikipediaLinkedArticle[]
          : never;
