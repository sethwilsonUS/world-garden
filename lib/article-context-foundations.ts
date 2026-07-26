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

const MAX_TEXT_LENGTH = 5_000;

export type JsonRecord = Record<string, unknown>;

export type ArticleContextExtractorOptions = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  signal?: AbortSignal;
};

export type BlockCandidate = {
  block: ContextBlock;
  position: number;
  priority: number;
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

export const sanitizeContextText = (
  value: string,
  maxLength = MAX_TEXT_LENGTH,
): string => {
  const clean = decodeHtmlEntities(value)
    // Semantic adapters receive text, never markup. Neutralize delimiters as
    // characters instead of attempting to recover an HTML tree here.
    .replace(/[<>]/g, " ")
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

export const normalizeArticleContextRequest = (
  input: ArticleContextRequest,
): ArticleContextRequest => {
  const wikiPageId = String(input.wikiPageId ?? "").trim();
  const revisionId = String(input.revisionId ?? "").trim();
  const title = sanitizeContextText(String(input.title ?? ""), 300);
  const language = String(input.language ?? "en")
    .trim()
    .toLowerCase();

  if (!/^\d{1,20}$/.test(wikiPageId) || wikiPageId === "0") {
    throw new ArticleContextInputError(
      "wikiPageId must be a positive numeric ID",
    );
  }
  if (!/^\d{1,20}$/.test(revisionId) || revisionId === "0") {
    throw new ArticleContextInputError(
      "revisionId must be a positive numeric ID",
    );
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

export const uniqueId = (
  prefix: string,
  value: string,
  index: number,
): string => `${prefix}-${sha256(`${value}:${index}`).slice(0, 10)}`;
