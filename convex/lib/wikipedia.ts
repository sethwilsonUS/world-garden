import {
  ARTICLE_SECTION_NARRATION_VERSION,
  createSectionNarrations,
  type NarratedSection,
  type SectionNarrationSource,
} from "../../lib/section-narration";
import {
  loadMediaWikiDocument,
  MediaWikiSourceError,
  normalizeMediaWikiNumericId,
  type MediaWikiDocumentRequest,
} from "../../lib/mediawiki-document";
import { createSectionNarrationsFromDocument } from "../../lib/section-narration-document";
import { createParsedPageDataFromDocument } from "../../lib/mediawiki-document-metadata";
import {
  BADGE_KEYS,
  getBadgeTopicQuery,
  type BadgeKey,
} from "../../lib/badges";
import {
  fetchWikimediaMediaDetails,
  getAttributionForImageUrl,
  type WikimediaMediaAttribution,
} from "../../lib/wikimedia-media";
import type { WikipediaRevisionIdentity } from "../../lib/wikipedia-contracts";

const WIKI_ACTION_API = "https://en.wikipedia.org/w/api.php";
const WIKI_REST_API = "https://en.wikipedia.org/api/rest_v1";
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";

export type WikiSearchResult = {
  wikiPageId: string;
  title: string;
  description: string;
  url: string;
};

export type WikiSection = NarratedSection;

export type WikiArticle = {
  wikiPageId: string;
  title: string;
  language: string;
  revisionId: string;
  lastEdited: string;
  summary: string;
  contentText: string;
  sections: WikiSection[];
  narrationVersion: number;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  thumbnailAttribution?: WikimediaMediaAttribution;
};

type WikiThumbnail = {
  source: string;
  width: number;
  height: number;
};

const requireRevisionId = (value: unknown): string => {
  const revisionId = normalizeMediaWikiNumericId(value);
  if (!revisionId) {
    throw new Error("Wikipedia returned no usable revision identity");
  }
  return revisionId;
};

const requirePageId = (value: unknown): string => {
  const pageId = normalizeMediaWikiNumericId(value);
  if (!pageId) {
    throw new Error("Wikipedia returned no usable page identity");
  }
  return pageId;
};

const fetchSummaryThumbnail = async (
  title: string,
): Promise<WikiThumbnail | undefined> => {
  try {
    const response = await fetch(
      `${WIKI_REST_API}/page/summary/${encodeURIComponent(title)}`,
      {
        headers: { "User-Agent": USER_AGENT },
      },
    );
    if (!response.ok) return undefined;

    const data = await response.json();
    const thumbnail = data.thumbnail as WikiThumbnail | undefined;
    return thumbnail;
  } catch {
    return undefined;
  }
};

export const searchWikipedia = async (
  term: string,
): Promise<WikiSearchResult[]> => {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    list: "search",
    srsearch: term,
    srlimit: "10",
    srprop: "snippet",
    origin: "*",
  });

  const response = await fetch(`${WIKI_ACTION_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia search failed: ${response.status}`);
  }

  const data = await response.json();
  const results = data.query?.search ?? [];

  return results.flatMap(
    (item: { pageid: number; title: string; snippet: string }) => {
      const wikiPageId = normalizeMediaWikiNumericId(item.pageid);
      return wikiPageId
        ? [
            {
              wikiPageId,
              title: item.title,
              description: stripHtml(item.snippet),
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
            },
          ]
        : [];
    },
  );
};

const articleTopicMatches = async (
  wikiPageId: string,
  topics: string,
): Promise<boolean> => {
  const canonicalPageId = requirePageId(wikiPageId);
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    list: "search",
    srsearch: `pageid:${canonicalPageId} articletopic:${topics}`,
    srlimit: "1",
    srwhat: "text",
    origin: "*",
  });

  const response = await fetch(`${WIKI_ACTION_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia articletopic search failed: ${response.status}`);
  }

  const data = await response.json();
  const results = data.query?.search ?? [];
  return results.some(
    (item: { pageid?: number | string }) =>
      normalizeMediaWikiNumericId(item.pageid) === canonicalPageId,
  );
};

export const fetchArticleBadgeKeys = async (
  wikiPageId: string,
): Promise<BadgeKey[]> => {
  const matches = await Promise.all(
    BADGE_KEYS.map(async (key) => {
      const didMatch = await articleTopicMatches(
        wikiPageId,
        getBadgeTopicQuery(key),
      );
      return didMatch ? key : null;
    }),
  );

  return matches.filter((key): key is BadgeKey => key !== null);
};

export const fetchArticleByPageId = async (
  pageId: string,
): Promise<WikiArticle> => {
  const canonicalPageId = requirePageId(pageId);
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    pageids: canonicalPageId,
    prop: "extracts|revisions|info|pageimages",
    explaintext: "1",
    exsectionformat: "wiki",
    rvprop: "ids|timestamp",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "800",
    origin: "*",
  });

  const response = await fetch(`${WIKI_ACTION_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia fetch failed: ${response.status}`);
  }

  const data = await response.json();
  const page = data.query?.pages?.[canonicalPageId];

  if (!page || page.missing !== undefined) {
    throw new Error(`Wikipedia article not found: pageId ${canonicalPageId}`);
  }

  const revision = page.revisions?.[0];
  const wikiPageId = requirePageId(page.pageid);
  const revisionId = requireRevisionId(revision?.revid);
  const fullText = page.extract ?? "";
  const contentText = cleanContentForTts(fullText);
  const thumbnail =
    (page.thumbnail as WikiThumbnail | undefined) ??
    (await fetchSummaryThumbnail(page.title as string));
  const [{ summary, sections }, thumbnailAttribution] = await Promise.all([
    buildRevisionNarration({
      wikiPageId,
      title: page.title,
      revisionId,
      fullText,
    }),
    getAttributionForImageUrl(thumbnail?.source),
  ]);

  return {
    wikiPageId,
    title: page.title,
    language: "en",
    revisionId,
    lastEdited: revision?.timestamp ?? new Date().toISOString(),
    summary,
    contentText,
    sections,
    narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
    thumbnailUrl: thumbnail?.source,
    thumbnailWidth: thumbnail?.width,
    thumbnailHeight: thumbnail?.height,
    thumbnailAttribution,
  };
};

export const titleToSlug = (title: string): string => {
  return title.replace(/ /g, "_");
};

export const slugToTitle = (slug: string): string => {
  return slug.replace(/_/g, " ");
};

export const fetchArticleByTitle = async (
  title: string,
): Promise<WikiArticle> => {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    titles: title,
    prop: "extracts|revisions|info|pageimages",
    explaintext: "1",
    exsectionformat: "wiki",
    rvprop: "ids|timestamp",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "800",
    redirects: "1",
    origin: "*",
  });

  const response = await fetch(`${WIKI_ACTION_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia fetch failed: ${response.status}`);
  }

  const data = await response.json();
  const pages = data.query?.pages ?? {};
  const page = Object.values(pages)[0] as Record<string, unknown> | undefined;

  if (!page || page.missing !== undefined) {
    throw new Error(`Wikipedia article not found: "${title}"`);
  }

  const revisions = page.revisions as
    | Array<Record<string, unknown>>
    | undefined;
  const revision = revisions?.[0];
  const wikiPageId = requirePageId(page.pageid);
  const revisionId = requireRevisionId(revision?.revid);
  const fullText = (page.extract as string) ?? "";
  const contentText = cleanContentForTts(fullText);
  const thumbnail =
    (page.thumbnail as WikiThumbnail | undefined) ??
    (await fetchSummaryThumbnail(page.title as string));
  const [{ summary, sections }, thumbnailAttribution] = await Promise.all([
    buildRevisionNarration({
      wikiPageId,
      title: page.title as string,
      revisionId,
      fullText,
    }),
    getAttributionForImageUrl(thumbnail?.source),
  ]);

  return {
    wikiPageId,
    title: page.title as string,
    language: "en",
    revisionId,
    lastEdited: (revision?.timestamp as string) ?? new Date().toISOString(),
    summary,
    contentText,
    sections,
    narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
    thumbnailUrl: thumbnail?.source,
    thumbnailWidth: thumbnail?.width,
    thumbnailHeight: thumbnail?.height,
    thumbnailAttribution,
  };
};

const NOISE_SECTIONS = new Set([
  "see also",
  "references",
  "external links",
  "notes",
  "further reading",
  "bibliography",
  "sources",
  "citations",
  "footnotes",
]);

const splitPlaintextArticle = (
  fullText: string,
): NonNullable<MediaWikiDocumentRequest["plaintext"]> => {
  // MediaWiki's plaintext extract represents section boundaries as wikitext
  // headings. This is the only structural regex in the ingestion path; HTML
  // structure is always read from parse5's semantic tree.
  const headingPattern = /^(={2,})\s*(.+?)\s*\1$/gm;
  const matches = [...fullText.matchAll(headingPattern)];
  const leadEnd = matches[0]?.index ?? fullText.length;
  return {
    lead: cleanSectionContent(fullText.slice(0, leadEnd)),
    sections: matches.map((match, index) => ({
      index: String(index + 1),
      title: match[2].trim(),
      level: match[1].length,
      text: cleanSectionContent(
        fullText.slice(
          (match.index ?? 0) + match[0].length,
          matches[index + 1]?.index ?? fullText.length,
        ),
      ),
    })),
  };
};

const buildRevisionNarration = async ({
  wikiPageId,
  title,
  revisionId,
  fullText,
}: {
  wikiPageId: string;
  title: string;
  revisionId: string;
  fullText: string;
}): Promise<{ summary: string; sections: WikiSection[] }> => {
  const plaintext = splitPlaintextArticle(fullText);
  const sourceSections: SectionNarrationSource[] = plaintext.sections
    .filter((section) => !NOISE_SECTIONS.has(section.title.toLowerCase()))
    .map((section) => ({
      wikiSectionIndex: section.index,
      title: section.title,
      level: section.level,
      content: section.text,
    }));

  try {
    const document = await loadMediaWikiDocument({
      wikiPageId,
      title,
      revisionId,
      language: "en",
      plaintext,
    });
    return {
      summary: plaintext.lead,
      sections: createSectionNarrationsFromDocument(document),
    };
  } catch (error) {
    if (
      error instanceof MediaWikiSourceError &&
      error.code === "identity-mismatch"
    ) {
      throw error;
    }
    // Unavailable parsed HTML must never resurrect the old suitability
    // heuristics. The revision's plaintext stays listenable.
    return {
      summary: plaintext.lead,
      sections: createSectionNarrations({
        sections: sourceSections,
        sourceIdentity: JSON.stringify([wikiPageId, revisionId, title]),
      }),
    };
  }
};

/**
 * Split Wikipedia plaintext (from explaintext=1) into a lead summary
 * and an ordered array of sections. Filters out reference/noise sections.
 */
export const parseSections = (
  fullText: string,
): {
  summary: string;
  sections: WikiSection[];
} => {
  const sectionHeadingRe = /^(={2,})\s*(.+?)\s*\1$/gm;
  const matches = [...fullText.matchAll(sectionHeadingRe)];

  if (matches.length === 0) {
    return { summary: cleanSectionContent(fullText.trim()), sections: [] };
  }

  const summary = cleanSectionContent(
    fullText.substring(0, matches[0].index!).trim(),
  );

  const rawSections: SectionNarrationSource[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const level = m[1].length;
    const title = m[2];

    if (NOISE_SECTIONS.has(title.toLowerCase())) continue;

    const contentStart = m.index! + m[0].length;
    const contentEnd =
      i + 1 < matches.length ? matches[i + 1].index! : fullText.length;
    const content = cleanSectionContent(
      fullText.substring(contentStart, contentEnd),
    );

    rawSections.push({
      wikiSectionIndex: String(i + 1),
      title,
      level,
      content,
    });
  }

  return {
    summary,
    sections: createSectionNarrations({ sections: rawSections }),
  };
};

export const cleanSectionContent = (text: string): string => {
  return text
    .replace(/^={2,}\s*.+?\s*={2,}$/gm, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\[citation needed\]/gi, "")
    .replace(/\[edit\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const stripHtml = (html: string): string => {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'");
};

export type WikiSectionLinkCount = {
  index?: string;
  title: string;
  count: number;
};

export type WikiCitation = {
  id: string;
  index: number;
  text: string;
  url?: string;
};

export type SectionCitationInfo = {
  index?: string;
  title: string;
  count: number;
  citationIds: string[];
};

export type WikiLinkedArticle = {
  wikiPageId: string;
  title: string;
  description?: string;
};

export type WikiArticleImage = {
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

export type ParsedPageData = {
  linkCounts: WikiSectionLinkCount[];
  citations: WikiCitation[];
  sectionCitations: SectionCitationInfo[];
  sectionIndexMap: { title: string; index: string }[];
  images: WikiArticleImage[];
};

/**
 * Single parse API call that extracts link counts, citations, per-section
 * citation mappings, and section index mappings. Callers should cache the
 * result in Convex so subsequent requests hit the database.
 */
export const fetchParsedPageData = async (
  identity: WikipediaRevisionIdentity,
  signal?: AbortSignal,
): Promise<ParsedPageData> => {
  const empty: ParsedPageData = {
    linkCounts: [],
    citations: [],
    sectionCitations: [],
    sectionIndexMap: [],
    images: [],
  };
  if (identity.language !== "en") {
    return empty;
  }
  let parsed: ParsedPageData;
  try {
    const document = await loadMediaWikiDocument(
      {
        wikiPageId: identity.wikiPageId,
        title: identity.title,
        revisionId: identity.revisionId,
        language: "en",
      },
      { signal },
    );
    parsed = createParsedPageDataFromDocument(document);
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof MediaWikiSourceError &&
        error.code === "identity-mismatch")
    ) {
      throw error;
    }
    return empty;
  }

  const images = parsed.images;
  const mediaRequests = images.flatMap((image) => {
    const sourceTitle = image.attribution?.sourceTitle;
    const imageUrl = image.videoSrc ?? image.originalSrc ?? image.src;
    return sourceTitle ? [{ sourceTitle, imageUrl }] : [];
  });
  const mediaDetails = await fetchWikimediaMediaDetails(
    mediaRequests,
    fetch,
    signal,
  );

  return {
    ...parsed,
    images: images.map((image) => {
      const sourceTitle = image.attribution?.sourceTitle;
      const imageUrl = image.videoSrc ?? image.originalSrc ?? image.src;
      const details = sourceTitle ? mediaDetails.get(imageUrl) : undefined;
      if (!details) return image;

      if (image.videoSrc) {
        return { ...image, attribution: details.attribution };
      }

      return {
        ...image,
        ...(details.originalSrc ? { originalSrc: details.originalSrc } : {}),
        ...(details.lightboxSrc &&
        details.lightboxWidth &&
        details.lightboxHeight
          ? {
              lightboxSrc: details.lightboxSrc,
              lightboxWidth: details.lightboxWidth,
              lightboxHeight: details.lightboxHeight,
            }
          : {}),
        attribution: details.attribution,
      };
    }),
  };
};

/**
 * Resolve internal article links for a known semantic-document section index,
 * then enrich those revision-matched targets with current descriptions.
 */
export const fetchSectionLinksByIndex = async (
  identity: WikipediaRevisionIdentity,
  sectionIndex: string,
  signal?: AbortSignal,
): Promise<WikiLinkedArticle[]> => {
  if (identity.language !== "en") return [];
  let articleTitles: string[];
  try {
    const document = await loadMediaWikiDocument(
      {
        wikiPageId: identity.wikiPageId,
        title: identity.title,
        revisionId: identity.revisionId,
        language: "en",
      },
      { signal },
    );
    const section = document.sections.find(
      (candidate) =>
        candidate.key === (sectionIndex === "0" ? "__summary__" : sectionIndex),
    );
    articleTitles = [
      ...new Set((section?.links ?? []).map((link) => link.targetTitle)),
    ];
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof MediaWikiSourceError &&
        error.code === "identity-mismatch")
    ) {
      throw error;
    }
    return [];
  }

  if (articleTitles.length === 0) return [];

  const resolved: WikiLinkedArticle[] = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < articleTitles.length; i += BATCH_SIZE) {
    const batch = articleTitles.slice(i, i + BATCH_SIZE);
    const qParams = new URLSearchParams({
      action: "query",
      format: "json",
      titles: batch.join("|"),
      prop: "description",
      redirects: "1",
      origin: "*",
    });
    const qResponse = await fetch(`${WIKI_ACTION_API}?${qParams}`, {
      headers: { "User-Agent": USER_AGENT },
      signal,
    });
    if (!qResponse.ok) continue;

    const qData = await qResponse.json();
    const pages = qData.query?.pages ?? {};
    for (const p of Object.values(pages) as Record<string, unknown>[]) {
      const wikiPageId = normalizeMediaWikiNumericId(p.pageid);
      if (wikiPageId && p.missing === undefined && Number(p.ns) === 0) {
        resolved.push({
          wikiPageId,
          title: p.title as string,
          description: p.description as string | undefined,
        });
      }
    }
  }

  resolved.sort((a, b) => a.title.localeCompare(b.title));
  return resolved;
};

export const cleanContentForTts = (text: string): string => {
  let cleaned = text
    .replace(/\[\d+\]/g, "")
    .replace(/\[citation needed\]/gi, "")
    .replace(/\[edit\]/gi, "")
    .replace(/== See also ==[\s\S]*$/i, "")
    .replace(/== References ==[\s\S]*$/i, "")
    .replace(/== External links ==[\s\S]*$/i, "")
    .replace(/== Notes ==[\s\S]*$/i, "")
    .replace(/== Further reading ==[\s\S]*$/i, "")
    .replace(/^={2,}\s*.+?\s*={2,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const TTS_CHAR_LIMIT = 4800;
  if (cleaned.length > TTS_CHAR_LIMIT) {
    cleaned = cleaned.slice(0, TTS_CHAR_LIMIT);
    const lastSentence = cleaned.lastIndexOf(". ");
    if (lastSentence > TTS_CHAR_LIMIT * 0.5) {
      cleaned = cleaned.slice(0, lastSentence + 1);
    }
  }

  return cleaned;
};
