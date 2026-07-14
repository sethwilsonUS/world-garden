import { createHash } from "node:crypto";
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  type ArticleContextRequest,
  type ContextBlock,
  type ContextBlockBase,
  type ContextCoordinate,
  type ContextSection,
  type ContextSource,
} from "./article-context-types";

const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia context reader)";
const FETCH_TIMEOUT_MS = 25_000;
const MAX_MEDIAWIKI_RESPONSE_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_LENGTH = 5_000;

export type JsonRecord = Record<string, unknown>;

export type MediaWikiSectionSource = {
  index: string;
  line: string;
  anchor?: string;
  level?: string;
};

export type MediaWikiParsedSource = {
  pageId: string;
  title: string;
  revisionId: string;
  language: string;
  html: string;
  wikitext: string;
  sections: MediaWikiSectionSource[];
};

export type ArticleContextExtractorOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

export type SectionBoundary = ContextSection & {
  start: number;
};

export type BlockCandidate = {
  block: ContextBlock;
  position: number;
  priority: number;
};

export type CandidatePositionSpace = "html" | "wikitext";

export type ArticleOrderedBlockCandidate = BlockCandidate & {
  positionSpace: CandidatePositionSpace;
};

export const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const asString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const decodeHtmlEntities = (value: string): string => {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    laquo: "«",
    ldquo: "“",
    lsquo: "‘",
    lt: "<",
    mdash: "—",
    nbsp: " ",
    ndash: "–",
    quot: '"',
    raquo: "»",
    rdquo: "”",
    rsquo: "’",
    harr: "↔",
    larr: "←",
    rarr: "→",
    thinsp: " ",
    times: "×",
    minus: "−",
    deg: "°",
  };

  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    })
    .replace(/&#(\d+);?/g, (_match, decimal: string) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "";
    })
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name] ?? match);
};

const stripUnsafeBlocks = (value: string): string =>
  value
    .replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<sup\b[^>]*class="[^"]*\breference\b[^"]*"[^>]*>[\s\S]*?<\/sup>/gi, " ")
    .replace(/<math\b[^>]*>[\s\S]*?<\/math>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ");

export const sanitizeContextText = (
  value: string,
  maxLength = MAX_TEXT_LENGTH,
): string => {
  const clean = decodeHtmlEntities(stripUnsafeBlocks(value))
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (clean.length <= maxLength) return clean;
  const clipped = clean.slice(0, Math.max(1, maxLength - 1)).trimEnd();
  return `${clipped}…`;
};

/**
 * Captions often contain presentational arrows and spacing artifacts that are
 * awkward in prose and assistive technology. Keep this narrower than the
 * general source-text sanitizer so proper names such as “Drive-Thru Records”
 * remain untouched in titles, places, and labels.
 */
export const sanitizeContextCaption = (
  value: string,
  maxLength = MAX_TEXT_LENGTH,
): string => {
  const polished = sanitizeContextText(value, maxLength)
    .replace(/^(?:[←→↔⇒⇐⇔➝➞➜➔]+|[-=]+>)\s*/u, "")
    .replace(/\s*(?:[←→↔⇒⇐⇔➝➞➜➔]+|[-=]+>|<[-=]+)$/u, "")
    .replace(/\s*(?:↔|⇔)\s*/gu, " and ")
    .replace(/\s*(?:→|⇒|➝|➞|➜|➔|[-=]+>)\s*/gu, " to ")
    .replace(/\s*(?:←|⇐|<[-=]+)\s*/gu, " from ")
    .replace(/“\s*([^”]*?)\s*”/g, "“$1”")
    .replace(/‘\s*([^’]*?)\s*’/g, "‘$1’")
    .replace(/"\s*([^"\r\n]*?)\s*"/g, '"$1"')
    .replace(/\bthru\b/g, "through")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+([)\]}])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return sanitizeContextText(polished, maxLength);
};

export const cleanWikitext = (value: string, maxLength = MAX_TEXT_LENGTH): string => {
  const withoutLinks = value
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\[(?:https?:\/\/[^\s\]]+)\s+([^\]]+)\]/g, "$1")
    .replace(/'{2,5}/g, "")
    .replace(/\{\{[^{}]*\}\}/g, " ")
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, " ")
    .replace(/<ref\b[^>]*\/\s*>/gi, " ")
    .replace(/_/g, " ");
  return sanitizeContextText(withoutLinks, maxLength);
};

export const parseAttributes = (attributeSource: string): Record<string, string> => {
  const result: Record<string, string> = {};
  const attributePattern =
    /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of attributeSource.matchAll(attributePattern)) {
    result[match[1].toLowerCase()] = decodeHtmlEntities(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }
  return result;
};

export const normalizeWikipediaTitle = (title: string): string =>
  title.replace(/_/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();

export const normalizeArticleContextRequest = (
  input: ArticleContextRequest,
): ArticleContextRequest => {
  const wikiPageId = String(input.wikiPageId ?? "").trim();
  const revisionId = String(input.revisionId ?? "").trim();
  const title = sanitizeContextText(String(input.title ?? ""), 300);
  const language = String(input.language ?? "en").trim().toLowerCase();

  if (!/^\d{1,20}$/.test(wikiPageId) || wikiPageId === "0") {
    throw new ArticleContextInputError("wikiPageId must be a positive numeric ID");
  }
  if (!/^\d{1,20}$/.test(revisionId) || revisionId === "0") {
    throw new ArticleContextInputError("revisionId must be a positive numeric ID");
  }
  if (!title) {
    throw new ArticleContextInputError("title is required");
  }
  if (language !== "en") {
    throw new ArticleContextInputError(
      "Context extraction currently supports English Wikipedia only",
    );
  }

  return { wikiPageId, revisionId, title, language };
};

export class ArticleContextInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArticleContextInputError";
  }
}

export class ArticleContextUpstreamError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "ArticleContextUpstreamError";
    this.statusCode = statusCode;
  }
}

const wikipediaBaseUrl = (language: string): string =>
  `https://${language}.wikipedia.org`;

const articleUrl = (request: ArticleContextRequest): string =>
  `${wikipediaBaseUrl(request.language ?? "en")}/wiki/${encodeURIComponent(
    request.title.replace(/ /g, "_"),
  )}`;

const articleRevisionUrl = (request: ArticleContextRequest): string =>
  `${wikipediaBaseUrl(request.language ?? "en")}/w/index.php?oldid=${encodeURIComponent(
    request.revisionId,
  )}`;

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const parseMediaWikiSections = (value: unknown): MediaWikiSectionSource[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((section) => {
    if (!isRecord(section)) return [];
    const index = asString(section.index);
    const line = asString(section.line);
    if (!index || !line) return [];
    return [
      {
        index,
        line: sanitizeContextText(line, 300),
        ...(asString(section.anchor)
          ? { anchor: sanitizeContextText(asString(section.anchor)!, 300) }
          : {}),
        ...(asString(section.level) ? { level: asString(section.level)! } : {}),
      },
    ];
  });
};

export const fetchRevisionMatchedMediaWikiSource = async (
  input: ArticleContextRequest,
  options: ArticleContextExtractorOptions = {},
): Promise<MediaWikiParsedSource> => {
  const request = normalizeArticleContextRequest(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = new URL(`${wikipediaBaseUrl(request.language!)}/w/api.php`);
  endpoint.search = new URLSearchParams({
    action: "parse",
    format: "json",
    formatversion: "2",
    oldid: request.revisionId,
    prop: "text|sections|wikitext",
    disableeditsection: "1",
    disablelimitreport: "1",
    origin: "*",
  }).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "Wikipedia context request timed out"
        : "Wikipedia context request failed";
    throw new ArticleContextUpstreamError(message);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new ArticleContextUpstreamError(
      `Wikipedia context request returned HTTP ${response.status}`,
      response.status === 404 ? 404 : 502,
    );
  }

  const responseText = await response.text();
  if (responseText.length > MAX_MEDIAWIKI_RESPONSE_BYTES) {
    throw new ArticleContextUpstreamError(
      "Wikipedia context response exceeded the safe size limit",
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(responseText);
  } catch {
    throw new ArticleContextUpstreamError(
      "Wikipedia returned an invalid context response",
    );
  }

  if (!isRecord(payload)) {
    throw new ArticleContextUpstreamError("Wikipedia returned no parse data");
  }
  if (isRecord(payload.error)) {
    const upstreamCode = asString(payload.error.code);
    throw new ArticleContextUpstreamError(
      upstreamCode === "missingrev"
        ? "The requested Wikipedia revision no longer exists"
        : "Wikipedia could not parse the requested revision",
      upstreamCode === "missingrev" ? 404 : 502,
    );
  }

  const parsed = isRecord(payload.parse) ? payload.parse : null;
  const pageId = parsed ? String(parsed.pageid ?? "") : "";
  const revisionId = parsed ? String(parsed.revid ?? "") : "";
  const title = parsed ? asString(parsed.title) : null;
  const html = parsed ? asString(parsed.text) : null;
  const wikitext = parsed ? asString(parsed.wikitext) : null;
  if (!parsed || !pageId || !revisionId || !title || html == null || wikitext == null) {
    throw new ArticleContextUpstreamError(
      "Wikipedia returned incomplete revision parse data",
    );
  }
  if (pageId !== request.wikiPageId || revisionId !== request.revisionId) {
    throw new ArticleContextUpstreamError(
      "Wikipedia returned a different page or revision than requested",
      409,
    );
  }
  if (normalizeWikipediaTitle(title) !== normalizeWikipediaTitle(request.title)) {
    throw new ArticleContextUpstreamError(
      "Wikipedia returned a different article title than requested",
      409,
    );
  }

  return {
    pageId,
    title: sanitizeContextText(title, 300),
    revisionId,
    language: request.language!,
    html,
    wikitext,
    sections: parseMediaWikiSections(parsed.sections),
  };
};

export const findHtmlSectionBoundaries = (
  html: string,
  sections: MediaWikiSectionSource[],
): SectionBoundary[] => {
  const boundaries: SectionBoundary[] = [
    { index: "__summary__", title: "Summary", start: 0 },
  ];
  const headings = [
    ...html.matchAll(/<h([2-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi),
  ];
  let sectionCursor = 0;
  for (const heading of headings) {
    const attributes = parseAttributes(heading[2]);
    const headingTitle = sanitizeContextText(heading[3], 300);
    if (!headingTitle) continue;
    const headingAnchor = attributes.id;
    let section = sections.find(
      (candidate) =>
        headingAnchor && candidate.anchor && candidate.anchor === headingAnchor,
    );
    if (!section) {
      const normalizedHeading = normalizeWikipediaTitle(headingTitle);
      const nextIndex = sections.findIndex(
        (candidate, index) =>
          index >= sectionCursor &&
          normalizeWikipediaTitle(candidate.line) === normalizedHeading,
      );
      if (nextIndex >= 0) {
        section = sections[nextIndex];
        sectionCursor = nextIndex + 1;
      }
    }
    if (!section) continue;
    boundaries.push({
      index: section.index,
      title: section.line || headingTitle,
      ...(section.anchor || headingAnchor
        ? { anchor: section.anchor || headingAnchor }
        : {}),
      start: heading.index ?? 0,
    });
  }
  return boundaries.sort((a, b) => a.start - b.start);
};

export const sectionAtOffset = (
  boundaries: SectionBoundary[],
  offset: number,
): ContextSection => {
  let current = boundaries[0];
  for (const boundary of boundaries) {
    if (boundary.start > offset) break;
    current = boundary;
  }
  return {
    index: current.index,
    title: current.title,
    ...(current.anchor ? { anchor: current.anchor } : {}),
  };
};

export const findWikitextSection = (
  wikitext: string,
  offset: number,
  sections: MediaWikiSectionSource[],
): ContextSection => {
  const before = wikitext.slice(0, offset);
  const headings = [
    ...before.matchAll(/^\s*(={2,6})\s*(.*?)\s*\1\s*$/gm),
  ];
  const lastHeading = headings.at(-1);
  if (!lastHeading) return { index: "__summary__", title: "Summary" };
  const title = cleanWikitext(lastHeading[2], 300);
  const normalized = normalizeWikipediaTitle(title);
  const matching = [...sections]
    .reverse()
    .find((section) => normalizeWikipediaTitle(section.line) === normalized);
  return matching
    ? {
        index: matching.index,
        title: matching.line,
        ...(matching.anchor ? { anchor: matching.anchor } : {}),
      }
    : { index: `heading-${sha256(title).slice(0, 8)}`, title };
};

export const finiteNumber = (value: unknown): number | null => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : null;
};

export const validCoordinate = (latitude: number, longitude: number): boolean =>
  latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

export const formatCoordinate = ({
  latitude,
  longitude,
}: ContextCoordinate): string => {
  const latitudeDirection = latitude < 0 ? "south" : "north";
  const longitudeDirection = longitude < 0 ? "west" : "east";
  const trim = (value: number) =>
    Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 5 });
  return `${trim(latitude)} degrees ${latitudeDirection}, ${trim(
    longitude,
  )} degrees ${longitudeDirection}`;
};

const buildSources = (
  request: ArticleContextRequest,
  accessedAt: string,
  extras: ContextSource[] = [],
): ContextSource[] => [
  {
    label: `${request.title} on Wikipedia`,
    url: articleRevisionUrl(request),
    revisionId: request.revisionId,
    license: "CC BY-SA 4.0",
    accessedAt,
  },
  ...extras,
];

export const buildBaseBlock = ({
  request,
  sourceHash,
  generatedAt,
  kind,
  section,
  title,
  caption,
  longDescription,
  sourceIdentity,
  extraSources,
}: {
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  kind: ContextBlock["kind"];
  section: ContextSection;
  title: string;
  caption: string;
  longDescription: string;
  sourceIdentity: string;
  extraSources?: ContextSource[];
}): ContextBlockBase => ({
  id: `context-${kind}-${sha256(
    `${request.wikiPageId}:${request.revisionId}:${section.index}:${sourceIdentity}`,
  ).slice(0, 16)}`,
  kind,
  title: sanitizeContextText(title, 240),
  caption: sanitizeContextText(caption, 800),
  longDescription: sanitizeContextText(longDescription, MAX_TEXT_LENGTH),
  section,
  order: 0,
  sources: buildSources(request, generatedAt, extraSources),
  provenance: {
    articleUrl: articleUrl(request),
    articleRevisionUrl: articleRevisionUrl(request),
    sourceHash,
    extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
    descriptionMethod: "deterministic",
  },
});

export const uniqueId = (prefix: string, value: string, index: number): string =>
  `${prefix}-${sha256(`${value}:${index}`).slice(0, 10)}`;
