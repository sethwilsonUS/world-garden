export type WikipediaRevisionIdentity = Readonly<{
  wikiPageId: string;
  revisionId: string;
  title: string;
  language: string;
}>;

export type WikipediaSearchResult = Readonly<{
  wikiPageId: string;
  title: string;
  description: string;
  url: string;
}>;

export type WikimediaMediaAttribution = Readonly<{
  creator?: string;
  credit?: string;
  licenseName?: string;
  licenseUrl?: string;
  sourceTitle?: string;
  sourceUrl?: string;
}>;

export type WikipediaSection = Readonly<{
  wikiSectionIndex: string;
  title: string;
  level: number;
  content: string;
}>;

export type WikipediaArticleImage = Readonly<{
  src: string;
  originalSrc?: string;
  lightboxSrc?: string;
  lightboxWidth?: number;
  lightboxHeight?: number;
  alt: string;
  caption: string;
  width?: number;
  height?: number;
  attribution?: WikimediaMediaAttribution;
}>;

/** Public article content shared by clients; narration and UI stay elsewhere. */
export type WikipediaArticle = WikipediaRevisionIdentity &
  Readonly<{
    narrationVersion: number;
    lastEdited?: string;
    summary?: string;
    thumbnailUrl?: string;
    thumbnailWidth?: number;
    thumbnailHeight?: number;
    thumbnailAttribution?: WikimediaMediaAttribution;
    sections?: readonly WikipediaSection[];
  }>;

export type WikipediaRevisionIdentitySource = Readonly<{
  wikiPageId: unknown;
  revisionId: unknown;
  title: unknown;
  language: unknown;
}>;

export type WikipediaSearchResultSource = Readonly<{
  wikiPageId: unknown;
  title: unknown;
  description: unknown;
  url: unknown;
}>;

const invalidField = (field: string): never => {
  throw new TypeError(`Invalid Wikipedia ${field}`);
};

export const normalizeMediaWikiNumericId = (value: unknown): string | null => {
  let digits: string;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    digits = String(value);
  } else if (typeof value === "string") {
    digits = value.trim();
    if (digits.length > 64 || !/^\d+$/u.test(digits)) return null;
  } else {
    return null;
  }

  const canonical = digits.replace(/^0+/u, "");
  return canonical && canonical.length <= 20 ? canonical : null;
};

const requireNumericId = (value: unknown, field: string): string => {
  const normalized = normalizeMediaWikiNumericId(value);
  return normalized ?? invalidField(field);
};

const normalizeRequiredText = (value: unknown, field: string): string => {
  if (typeof value !== "string") return invalidField(field);
  const normalized = value.normalize("NFC").trim();
  return normalized || invalidField(field);
};

const normalizeDescription = (value: unknown): string => {
  if (typeof value !== "string") return invalidField("description");
  return value.normalize("NFC").trim();
};

const normalizeLanguage = (value: unknown): string => {
  const normalized = normalizeRequiredText(value, "language").toLowerCase();
  if (!/^[a-z]{2,8}(?:-[a-z\d]{1,8})*$/u.test(normalized)) {
    return invalidField("language");
  }
  return normalized;
};

const normalizeWikipediaArticleUrl = (value: unknown): string => {
  if (typeof value !== "string") return invalidField("url");

  const match = value.match(
    /^https:\/\/((?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)*wikipedia\.org)(\/wiki\/[^\s?#]+)$/iu,
  );
  if (!match) return invalidField("url");

  try {
    decodeURIComponent(match[2] ?? "");
  } catch (error) {
    if (error instanceof URIError) return invalidField("url");
    throw error;
  }

  return value;
};

export function createWikipediaRevisionIdentity(
  source: WikipediaRevisionIdentitySource,
): WikipediaRevisionIdentity {
  return Object.freeze({
    wikiPageId: requireNumericId(source.wikiPageId, "wikiPageId"),
    revisionId: requireNumericId(source.revisionId, "revisionId"),
    title: normalizeRequiredText(source.title, "title"),
    language: normalizeLanguage(source.language),
  });
}

export function createWikipediaSearchResult(
  source: WikipediaSearchResultSource,
): WikipediaSearchResult {
  return Object.freeze({
    wikiPageId: requireNumericId(source.wikiPageId, "wikiPageId"),
    title: normalizeRequiredText(source.title, "title"),
    description: normalizeDescription(source.description),
    url: normalizeWikipediaArticleUrl(source.url),
  });
}
