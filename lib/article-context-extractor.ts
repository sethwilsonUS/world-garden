import { createHash } from "node:crypto";
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  type ArticleContextRequest,
  type ContextBlock,
  type ContextBlockBase,
  type ContextChartBlock,
  type ContextChartCell,
  type ContextChartColumn,
  type ContextChartSeries,
  type ContextCoordinate,
  type ContextDateValue,
  type ContextDiagramBlock,
  type ContextMapArea,
  type ContextMapBlock,
  type ContextMapPlace,
  type ContextMapRoute,
  type ContextManifest,
  type ContextSection,
  type ContextSource,
  type ContextTimelineBlock,
  type ContextTimelineEvent,
} from "./article-context-types";

const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia context reader)";
const FETCH_TIMEOUT_MS = 25_000;
const MAX_MEDIAWIKI_RESPONSE_BYTES = 15 * 1024 * 1024;
const MAX_CHART_ATTRIBUTE_BYTES = 750_000;
const MAX_TABLE_COLUMNS = 12;
const MAX_TABLE_ROWS = 250;
const MAX_TABLE_CELLS = 3_000;
const MAX_MAP_FEATURES = 200;
const MAX_MAP_COORDINATES = 2_000;
const MAX_BLOCKS_PER_ARTICLE = 6;
const MAX_TEXT_LENGTH = 5_000;

type JsonRecord = Record<string, unknown>;

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

type SectionBoundary = ContextSection & {
  start: number;
};

type BlockCandidate = {
  block: ContextBlock;
  position: number;
  priority: number;
};

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown): string | null =>
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

const cleanWikitext = (value: string, maxLength = MAX_TEXT_LENGTH): string => {
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

const parseAttributes = (attributeSource: string): Record<string, string> => {
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

const normalizeWikipediaTitle = (title: string): string =>
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

const sha256 = (value: string): string =>
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

const findHtmlSectionBoundaries = (
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

const sectionAtOffset = (
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

const findWikitextSection = (
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

const finiteNumber = (value: unknown): number | null => {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : null;
};

const validCoordinate = (latitude: number, longitude: number): boolean =>
  latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;

const formatCoordinate = ({
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

const buildBaseBlock = ({
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

const uniqueId = (prefix: string, value: string, index: number): string =>
  `${prefix}-${sha256(`${value}:${index}`).slice(0, 10)}`;

type NormalizedMapData = {
  places: ContextMapPlace[];
  routes: ContextMapRoute[];
  areas: ContextMapArea[];
  suggestedZoom?: number;
};

const dedupeMapData = (data: NormalizedMapData): NormalizedMapData => {
  const placeKeys = new Set<string>();
  const places = data.places.filter((place) => {
    const key = `${place.latitude.toFixed(6)}:${place.longitude.toFixed(6)}:${place.name.toLowerCase()}`;
    if (placeKeys.has(key)) return false;
    placeKeys.add(key);
    return true;
  });
  const routeKeys = new Set<string>();
  const routes = data.routes.filter((route) => {
    const key = `${route.name.toLowerCase()}:${route.points
      .map((point) => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`)
      .join(";")}`;
    if (routeKeys.has(key)) return false;
    routeKeys.add(key);
    return true;
  });
  const areaKeys = new Set<string>();
  const areas = data.areas.filter((area) => {
    const first = area.rings[0]?.[0];
    const key = `${area.name.toLowerCase()}:${first?.latitude}:${first?.longitude}`;
    if (areaKeys.has(key)) return false;
    areaKeys.add(key);
    return true;
  });
  return { ...data, places, routes, areas };
};

const mapCenter = (data: NormalizedMapData): ContextCoordinate | null => {
  const coordinates: ContextCoordinate[] = [
    ...data.places,
    ...data.routes.flatMap((route) => route.points),
    ...data.areas.flatMap((area) => area.rings.flatMap((ring) => ring)),
  ];
  if (coordinates.length === 0) return null;
  const totals = coordinates.reduce<{
    latitude: number;
    longitude: number;
    longitudeSine: number;
    longitudeCosine: number;
  }>(
    (sum, coordinate) => ({
      latitude: sum.latitude + coordinate.latitude,
      longitude: sum.longitude + coordinate.longitude,
      longitudeSine:
        sum.longitudeSine + Math.sin((coordinate.longitude * Math.PI) / 180),
      longitudeCosine:
        sum.longitudeCosine + Math.cos((coordinate.longitude * Math.PI) / 180),
    }),
    { latitude: 0, longitude: 0, longitudeSine: 0, longitudeCosine: 0 },
  );
  const circularMagnitude = Math.hypot(
    totals.longitudeSine,
    totals.longitudeCosine,
  );
  const longitude =
    circularMagnitude < 1e-12
      ? totals.longitude / coordinates.length
      : (Math.atan2(totals.longitudeSine, totals.longitudeCosine) * 180) /
        Math.PI;
  return {
    latitude: totals.latitude / coordinates.length,
    longitude,
  };
};

const mapLongDescription = (data: NormalizedMapData): string => {
  const parts: string[] = [];
  if (data.places.length > 0) {
    const placeDescriptions = data.places
      .slice(0, 20)
      .map(
        (place) =>
          `${place.name} is at ${formatCoordinate(place)}${
            place.description ? `: ${place.description}` : ""
          }`,
      );
    parts.push(
      `The source identifies ${data.places.length} ${
        data.places.length === 1 ? "place" : "places"
      }. ${placeDescriptions.join(". ")}.`,
    );
  }
  if (data.routes.length > 0) {
    parts.push(
      `It includes ${data.routes.length} ${
        data.routes.length === 1 ? "route" : "routes"
      }: ${data.routes
        .map(
          (route) =>
            `${route.name}, represented by ${route.points.length} coordinate points`,
        )
        .join("; ")}.`,
    );
  }
  if (data.areas.length > 0) {
    parts.push(
      `It outlines ${data.areas.length} ${
        data.areas.length === 1 ? "area" : "areas"
      }: ${data.areas.map((area) => area.name).join(", ")}.`,
    );
  }
  return parts.join(" ");
};

const createMapCandidate = ({
  data: unnormalized,
  request,
  sourceHash,
  generatedAt,
  section,
  position,
  priority,
  sourceIdentity,
}: {
  data: NormalizedMapData;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  section: ContextSection;
  position: number;
  priority: number;
  sourceIdentity: string;
}): BlockCandidate | null => {
  const data = dedupeMapData(unnormalized);
  const featureCount = data.places.length + data.routes.length + data.areas.length;
  const coordinateCount =
    data.places.length +
    data.routes.reduce((sum, route) => sum + route.points.length, 0) +
    data.areas.reduce(
      (sum, area) =>
        sum + area.rings.reduce((ringSum, ring) => ringSum + ring.length, 0),
      0,
    );
  if (
    featureCount === 0 ||
    featureCount > MAX_MAP_FEATURES ||
    coordinateCount > MAX_MAP_COORDINATES
  ) {
    return null;
  }
  const center = mapCenter(data);
  if (!center || !validCoordinate(center.latitude, center.longitude)) return null;

  const subject = section.index === "__summary__" ? request.title : section.title;
  const overview = [
    data.places.length > 0
      ? `${data.places.length} ${data.places.length === 1 ? "place" : "places"}`
      : null,
    data.routes.length > 0
      ? `${data.routes.length} ${data.routes.length === 1 ? "route" : "routes"}`
      : null,
    data.areas.length > 0
      ? `${data.areas.length} ${data.areas.length === 1 ? "area" : "areas"}`
      : null,
  ].filter((part): part is string => Boolean(part));
  const caption = `The source map identifies ${overview.join(", ")} associated with ${subject}.`;
  const base = buildBaseBlock({
    request,
    sourceHash,
    generatedAt,
    kind: "map",
    section,
    title: `Map of ${subject}`,
    caption,
    longDescription: mapLongDescription(data),
    sourceIdentity,
  });
  const block: ContextMapBlock = {
    ...base,
    kind: "map",
    map: {
      center,
      ...(data.suggestedZoom != null
        ? { suggestedZoom: data.suggestedZoom }
        : {}),
      places: data.places,
      routes: data.routes,
      areas: data.areas,
    },
  };
  return { block, position, priority };
};

const extractGeoCoordinates = (
  html: string,
  boundaries: SectionBoundary[],
): Array<{ coordinate: ContextCoordinate; section: ContextSection; position: number }> => {
  const coordinates: Array<{
    coordinate: ContextCoordinate;
    section: ContextSection;
    position: number;
  }> = [];
  const pattern =
    /<span\b[^>]*class="[^"]*\bgeo\b[^"]*"[^>]*>\s*(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?)\s*<\/span>/gi;
  for (const match of html.matchAll(pattern)) {
    const latitude = finiteNumber(match[1]);
    const longitude = finiteNumber(match[2]);
    if (
      latitude == null ||
      longitude == null ||
      !validCoordinate(latitude, longitude)
    ) {
      continue;
    }
    const position = match.index ?? 0;
    coordinates.push({
      coordinate: { latitude, longitude },
      section: sectionAtOffset(boundaries, position),
      position,
    });
  }
  return coordinates;
};

const extractHtmlMapCandidates = ({
  source,
  request,
  sourceHash,
  generatedAt,
  boundaries,
}: {
  source: MediaWikiParsedSource;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  boundaries: SectionBoundary[];
}): BlockCandidate[] => {
  const candidates: BlockCandidate[] = [];
  const geos = extractGeoCoordinates(source.html, boundaries);
  const mapTagPattern =
    /<(?:a|span)\b([^>]*\bdata-mw-kartographer=(?:"(?:mapframe|maplink)"|'(?:mapframe|maplink)')[^>]*)>([\s\S]*?)<\/(?:a|span)>/gi;
  let mapIndex = 0;
  for (const match of source.html.matchAll(mapTagPattern)) {
    const attrs = parseAttributes(match[1]);
    const position = match.index ?? 0;
    const section = sectionAtOffset(boundaries, position);
    let latitude = finiteNumber(attrs["data-lat"]);
    let longitude = finiteNumber(attrs["data-lon"]);
    if (
      latitude == null ||
      longitude == null ||
      !validCoordinate(latitude, longitude)
    ) {
      const sameSectionGeos = geos.filter(
        (geo) => geo.section.index === section.index,
      );
      const fallback =
        sameSectionGeos.length === 1 ? sameSectionGeos[0] : undefined;
      latitude = fallback?.coordinate.latitude ?? null;
      longitude = fallback?.coordinate.longitude ?? null;
    }
    if (
      latitude == null ||
      longitude == null ||
      !validCoordinate(latitude, longitude)
    ) {
      continue;
    }
    const innerLabel = sanitizeContextText(match[2], 200);
    const subject = section.index === "__summary__" ? request.title : section.title;
    const name =
      innerLabel && !/^(map|click for interactive|\u00a0)+$/i.test(innerLabel)
        ? innerLabel
        : subject;
    const zoomNumber = finiteNumber(attrs["data-zoom"]);
    const suggestedZoom =
      zoomNumber != null
        ? Math.min(18, Math.max(1, Math.round(zoomNumber)))
        : undefined;
    const place: ContextMapPlace = {
      id: uniqueId("place", `${name}:${latitude}:${longitude}`, mapIndex),
      name,
      latitude,
      longitude,
      description: `Location supplied by Wikipedia's interactive map.`,
    };
    const candidate = createMapCandidate({
      data: {
        places: [place],
        routes: [],
        areas: [],
        ...(suggestedZoom ? { suggestedZoom } : {}),
      },
      request,
      sourceHash,
      generatedAt,
      section,
      position,
      priority: attrs["data-mw-kartographer"] === "mapframe" ? 95 : 93,
      sourceIdentity: `kartographer:${mapIndex}:${latitude}:${longitude}`,
    });
    if (candidate) candidates.push(candidate);
    mapIndex += 1;
  }
  return candidates;
};

const geoJsonName = (properties: JsonRecord | null, fallback: string): string => {
  for (const key of ["title", "name", "label"]) {
    const value = properties ? asString(properties[key]) : null;
    const clean = value ? cleanWikitext(value, 200) : "";
    if (clean) return clean;
  }
  return fallback;
};

const geoJsonDescription = (properties: JsonRecord | null): string | undefined => {
  for (const key of ["description", "caption"]) {
    const value = properties ? asString(properties[key]) : null;
    const clean = value ? cleanWikitext(value, 600) : "";
    if (clean) return clean;
  }
  return undefined;
};

const coordinatePair = (value: unknown): ContextCoordinate | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = finiteNumber(value[0]);
  const latitude = finiteNumber(value[1]);
  return latitude != null && longitude != null && validCoordinate(latitude, longitude)
    ? { latitude, longitude }
    : null;
};

const normalizeGeoJson = (
  value: unknown,
  fallbackName: string,
): NormalizedMapData | null => {
  const places: ContextMapPlace[] = [];
  const routes: ContextMapRoute[] = [];
  const areas: ContextMapArea[] = [];
  let featureCount = 0;
  let coordinateCount = 0;

  const addGeometry = (
    geometry: JsonRecord,
    properties: JsonRecord | null,
    index: number,
  ) => {
    if (featureCount >= MAX_MAP_FEATURES) return;
    const type = asString(geometry.type);
    const coordinates = geometry.coordinates;
    const name = geoJsonName(properties, `${fallbackName} ${index + 1}`);
    const description = geoJsonDescription(properties);
    if (type === "Point") {
      const coordinate = coordinatePair(coordinates);
      if (!coordinate) return;
      coordinateCount += 1;
      featureCount += 1;
      places.push({
        id: uniqueId("place", `${name}:${coordinate.latitude}:${coordinate.longitude}`, index),
        name,
        ...coordinate,
        ...(description ? { description } : {}),
      });
      return;
    }
    if (type === "LineString" && Array.isArray(coordinates)) {
      const points = coordinates
        .map(coordinatePair)
        .filter((point): point is ContextCoordinate => Boolean(point));
      if (points.length < 2 || points.length !== coordinates.length) return;
      coordinateCount += points.length;
      featureCount += 1;
      routes.push({
        id: uniqueId("route", `${name}:${points.length}`, index),
        name,
        ...(description ? { description } : {}),
        points,
      });
      return;
    }
    if (type === "Polygon" && Array.isArray(coordinates)) {
      const rings = coordinates.flatMap((ring) => {
        if (!Array.isArray(ring)) return [];
        const points = ring
          .map(coordinatePair)
          .filter((point): point is ContextCoordinate => Boolean(point));
        return points.length >= 4 && points.length === ring.length ? [points] : [];
      });
      if (rings.length === 0) return;
      coordinateCount += rings.reduce((sum, ring) => sum + ring.length, 0);
      featureCount += 1;
      areas.push({
        id: uniqueId("area", `${name}:${rings.length}`, index),
        name,
        ...(description ? { description } : {}),
        rings,
      });
    }
  };

  const visit = (node: unknown, inheritedProperties: JsonRecord | null = null) => {
    if (!isRecord(node) || featureCount >= MAX_MAP_FEATURES) return;
    const type = asString(node.type);
    if (type === "FeatureCollection" && Array.isArray(node.features)) {
      node.features.slice(0, MAX_MAP_FEATURES).forEach((feature) =>
        visit(feature, inheritedProperties),
      );
      return;
    }
    if (type === "Feature") {
      const properties = isRecord(node.properties) ? node.properties : null;
      if (isRecord(node.geometry)) {
        addGeometry(node.geometry, properties, featureCount);
      }
      return;
    }
    if (type === "GeometryCollection" && Array.isArray(node.geometries)) {
      node.geometries.slice(0, MAX_MAP_FEATURES).forEach((geometry) => {
        if (isRecord(geometry)) addGeometry(geometry, inheritedProperties, featureCount);
      });
      return;
    }
    if (["Point", "LineString", "Polygon"].includes(type ?? "")) {
      addGeometry(node, inheritedProperties, featureCount);
    }
  };

  visit(value);
  if (
    featureCount === 0 ||
    featureCount > MAX_MAP_FEATURES ||
    coordinateCount > MAX_MAP_COORDINATES
  ) {
    return null;
  }
  return { places, routes, areas };
};

const extractWikitextMapCandidates = ({
  source,
  request,
  sourceHash,
  generatedAt,
}: {
  source: MediaWikiParsedSource;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
}): BlockCandidate[] => {
  const candidates: BlockCandidate[] = [];
  const pattern = /<(mapframe|maplink)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let index = 0;
  for (const match of source.wikitext.matchAll(pattern)) {
    const rawPayload = match[3].trim();
    if (!rawPayload || rawPayload.length > 1_000_000) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      continue;
    }
    const position = match.index ?? 0;
    const section = findWikitextSection(
      source.wikitext,
      position,
      source.sections,
    );
    const normalized = normalizeGeoJson(payload, section.title || request.title);
    if (!normalized) continue;
    const attrs = parseAttributes(match[2]);
    const zoom = finiteNumber(attrs.zoom);
    const candidate = createMapCandidate({
      data: {
        ...normalized,
        ...(zoom != null
          ? { suggestedZoom: Math.min(18, Math.max(1, Math.round(zoom))) }
          : {}),
      },
      request,
      sourceHash,
      generatedAt,
      section,
      position,
      priority: 98,
      sourceIdentity: `geojson:${index}:${sha256(rawPayload)}`,
    });
    if (candidate) candidates.push(candidate);
    index += 1;
  }
  return candidates;
};

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

const MONTH_DISPLAY_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const numericDateDisplay = ({
  year,
  month,
  day,
  format,
  circa,
}: {
  year: number;
  month: number;
  day: number;
  format: "dmy" | "mdy";
  circa: boolean;
}): string => {
  const monthName = MONTH_DISPLAY_NAMES[month - 1];
  const readable =
    format === "dmy"
      ? `${day} ${monthName} ${year}`
      : `${monthName} ${day}, ${year}`;
  return circa ? `circa ${readable}` : readable;
};

const chronologySortKey = (year: number, month = 0, day = 0): number =>
  year * 10_000 + month * 100 + day;

const padYear = (year: number): string => String(year).padStart(4, "0");

const isLeapYear = (year: number): boolean => {
  const absoluteYear = Math.abs(year);
  return (
    absoluteYear % 4 === 0 &&
    (absoluteYear % 100 !== 0 || absoluteYear % 400 === 0)
  );
};

const isValidCalendarDate = (
  year: number,
  month: number,
  day: number,
): boolean => {
  if (!Number.isInteger(year) || year === 0) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;
  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return day <= daysInMonth[month - 1];
};

const dateValue = ({
  display,
  year,
  month,
  day,
  precision,
}: {
  display: string;
  year: number;
  month?: number;
  day?: number;
  precision: ContextDateValue["precision"];
}): ContextDateValue => {
  const canUseIso = year > 0 && year <= 9999;
  const iso = canUseIso
    ? month && day
      ? `${padYear(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
      : month
        ? `${padYear(year)}-${String(month).padStart(2, "0")}`
        : padYear(year)
    : undefined;
  return {
    display,
    ...(iso ? { iso } : {}),
    sortKey: chronologySortKey(year, month, day),
    precision,
  };
};

const parseSingleDate = (
  original: string,
  options: { numericFormat?: "dmy" | "mdy" | "year" } = {},
): ContextDateValue | null => {
  const display = sanitizeContextText(original, 120);
  if (!display) return null;
  const circa = /^(?:c\.?|ca\.?|circa|approximately|about)\s+/i.test(display);
  const text = display.replace(
    /^(?:c\.?|ca\.?|circa|approximately|about)\s+/i,
    "",
  );

  const numericDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{1,4})$/);
  if (numericDate && options.numericFormat && options.numericFormat !== "year") {
    const first = Number(numericDate[1]);
    const second = Number(numericDate[2]);
    const year = Number(numericDate[3]);
    const month = options.numericFormat === "dmy" ? second : first;
    const day = options.numericFormat === "dmy" ? first : second;
    if (year > 0 && isValidCalendarDate(year, month, day)) {
      return dateValue({
        display: numericDateDisplay({
          year,
          month,
          day,
          format: options.numericFormat,
          circa,
        }),
        year,
        month,
        day,
        precision: circa ? "circa" : "day",
      });
    }
  }

  const isoDate = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    if (isValidCalendarDate(year, month, day)) {
      return dateValue({
        display,
        year,
        month,
        day,
        precision: circa ? "circa" : "day",
      });
    }
  }

  const monthFirst = text.match(
    /^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{1,4})(?:\s*(BC|BCE|AD|CE))?$/i,
  );
  const dayFirst = text.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{1,4})(?:\s*(BC|BCE|AD|CE))?$/i,
  );
  const dateMatch = monthFirst ?? dayFirst;
  if (dateMatch) {
    const monthName = (monthFirst ? dateMatch[1] : dateMatch[2]).toLowerCase();
    const month = MONTHS[monthName];
    const day = Number(monthFirst ? dateMatch[2] : dateMatch[1]);
    let year = Number(dateMatch[3]);
    const era = dateMatch[4]?.toUpperCase();
    if (era === "BC" || era === "BCE") year = -year;
    if (month && isValidCalendarDate(year, month, day)) {
      return dateValue({
        display,
        year,
        month,
        day,
        precision: circa ? "circa" : "day",
      });
    }
  }

  const monthYear = text.match(
    /^([A-Za-z]+)\s+(\d{1,4})(?:\s*(BC|BCE|AD|CE))?$/i,
  );
  if (monthYear) {
    const month = MONTHS[monthYear[1].toLowerCase()];
    let year = Number(monthYear[2]);
    const era = monthYear[3]?.toUpperCase();
    if (era === "BC" || era === "BCE") year = -year;
    if (month && year !== 0) {
      return dateValue({
        display,
        year,
        month,
        precision: circa ? "circa" : "month",
      });
    }
  }

  const yearOnly = text.match(/^(-?\d{1,4})(?:\s*(BC|BCE|AD|CE))?$/i);
  if (yearOnly) {
    let year = Number(yearOnly[1]);
    const era = yearOnly[2]?.toUpperCase();
    if ((era === "BC" || era === "BCE") && year > 0) year = -year;
    if (year !== 0) {
      return dateValue({
        display,
        year,
        precision: circa ? "circa" : "year",
      });
    }
  }

  return null;
};

export const parseContextDateRange = (
  value: string,
  options: { numericFormat?: "dmy" | "mdy" | "year" } = {},
): { start: ContextDateValue; end?: ContextDateValue } | null => {
  const clean = sanitizeContextText(value, 180);
  if (!clean) return null;

  const yearRange = clean.match(
    /^(?:(c\.?|ca\.?|circa)\s*)?(-?\d{1,4})\s*(?:–|—|-|to)\s*(-?\d{1,4})\s*(BC|BCE|AD|CE)?$/i,
  );
  if (yearRange) {
    const era = yearRange[4]?.toUpperCase();
    let startYear = Number(yearRange[2]);
    let endYear = Number(yearRange[3]);
    if (era === "BC" || era === "BCE") {
      startYear = -Math.abs(startYear);
      endYear = -Math.abs(endYear);
    }
    if (startYear !== 0 && endYear !== 0) {
      return {
        start: dateValue({
          display: yearRange[2] + (era ? ` ${era}` : ""),
          year: startYear,
          precision: yearRange[1] ? "circa" : "range",
        }),
        end: dateValue({
          display: yearRange[3] + (era ? ` ${era}` : ""),
          year: endYear,
          precision: "range",
        }),
      };
    }
  }

  const preciseRange = clean.match(/^(.+?)\s+(?:to|until|through)\s+(.+)$/i);
  if (preciseRange) {
    const start = parseSingleDate(preciseRange[1], options);
    const end = parseSingleDate(preciseRange[2], options);
    if (start && end) return { start: { ...start, precision: "range" }, end };
  }

  const single = parseSingleDate(clean, options);
  return single ? { start: single } : null;
};

const timelineFinalDate = (
  events: ContextTimelineEvent[],
): ContextDateValue =>
  events.reduce((latest, event) => {
    const candidate = event.end ?? event.start;
    return candidate.sortKey > latest.sortKey ? candidate : latest;
  }, events[0].end ?? events[0].start);

const timelineLongDescription = (events: ContextTimelineEvent[]): string => {
  const first = events[0];
  const finalDate = timelineFinalDate(events);
  const examples = events
    .slice(0, 12)
    .map(
      (event) =>
        `${event.start.display}${event.end ? ` to ${event.end.display}` : ""}: ${
          event.label
        }${event.description ? `. ${event.description}` : ""}`,
    )
    .join("; ");
  const omitted = events.length > 12 ? ` The remaining ${events.length - 12} events are available in the ordered event list.` : "";
  return `The chronology contains ${events.length} events from ${first.start.display} through ${
    finalDate.display
  }. ${examples}.${omitted}`;
};

const createTimelineCandidate = ({
  events: sourceEvents,
  request,
  sourceHash,
  generatedAt,
  section,
  position,
  priority,
  sourceIdentity,
}: {
  events: ContextTimelineEvent[];
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  section: ContextSection;
  position: number;
  priority: number;
  sourceIdentity: string;
}): BlockCandidate | null => {
  const events = sourceEvents
    .filter((event) => event.label && Number.isFinite(event.start.sortKey))
    .sort((a, b) => a.start.sortKey - b.start.sortKey)
    .filter(
      (event, index, all) =>
        index === 0 ||
        event.start.sortKey !== all[index - 1].start.sortKey ||
        event.label.toLowerCase() !== all[index - 1].label.toLowerCase(),
    );
  if (events.length < 3 || events.length > MAX_TABLE_ROWS) return null;
  const subject = section.index === "__summary__" ? request.title : section.title;
  const first = events[0];
  const finalDate = timelineFinalDate(events);
  const caption = `This chronology follows ${events.length} events from ${first.start.display} through ${
    finalDate.display
  }.`;
  const base = buildBaseBlock({
    request,
    sourceHash,
    generatedAt,
    kind: "timeline",
    section,
    title: `Timeline of ${subject}`,
    caption,
    longDescription: timelineLongDescription(events),
    sourceIdentity,
  });
  const block: ContextTimelineBlock = {
    ...base,
    kind: "timeline",
    timeline: { chronological: true, events },
  };
  return { block, position, priority };
};

const parseEasyTimelineDate = (
  value: string,
  format: "dmy" | "mdy" | "year",
): ContextDateValue | null => parseSingleDate(value.trim(), { numericFormat: format });

const STORM_TIMELINE_CATEGORIES: Record<string, string> = {
  TD: "Tropical depression",
  TS: "Tropical storm",
  SD: "Subtropical depression",
  SS: "Subtropical storm",
  C1: "Category 1 hurricane",
  C2: "Category 2 hurricane",
  C3: "Category 3 hurricane",
  C4: "Category 4 hurricane",
  C5: "Category 5 hurricane",
};

const normalizeEasyTimelineCategory = (
  value: string,
  context: string,
): string => {
  const category = sanitizeContextText(value, 80);
  if (!/(?:hurricane|storm|cyclone|typhoon|tropical)/i.test(context)) {
    return category;
  }
  return STORM_TIMELINE_CATEGORIES[category.toUpperCase()] ?? category;
};

const extractEasyTimelineCandidates = ({
  source,
  request,
  sourceHash,
  generatedAt,
}: {
  source: MediaWikiParsedSource;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
}): BlockCandidate[] => {
  const candidates: BlockCandidate[] = [];
  let timelineIndex = 0;
  for (const match of source.wikitext.matchAll(
    /<timeline\b[^>]*>([\s\S]*?)<\/timeline>/gi,
  )) {
    const body = match[1];
    if (body.length > 1_000_000) continue;
    const formatMatch = body.match(/^\s*DateFormat\s*=\s*([^\s#]+)/im);
    const formatText = formatMatch?.[1]?.toLowerCase() ?? "yyyy";
    const numericFormat: "dmy" | "mdy" | "year" = formatText.startsWith("dd")
      ? "dmy"
      : formatText.startsWith("mm")
        ? "mdy"
        : "year";
    const position = match.index ?? 0;
    const section = findWikitextSection(
      source.wikitext,
      position,
      source.sections,
    );
    const lines = body.split(/\r?\n/);
    const events: ContextTimelineEvent[] = [];
    let currentBar = "";
    for (const line of lines) {
      const barMatch = line.match(/^\s*(?:bar|barset)\s*:\s*([^\s]+)/i);
      if (barMatch) currentBar = barMatch[1];
      const extent = line.match(
        /\bfrom\s*:\s*([^\s]+)\s+till\s*:\s*([^\s]+)([\s\S]*)$/i,
      );
      if (!extent || /^(month|months|axis|year|years)$/i.test(currentBar)) continue;
      const trailing = extent[3];
      const textMatch = trailing.match(/\btext\s*:\s*(?:"([^"]+)"|(.+?))\s*$/i);
      if (!textMatch) continue;
      const label = cleanWikitext(textMatch[1] ?? textMatch[2] ?? "", 300);
      if (!label || /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(label)) {
        continue;
      }
      const start = parseEasyTimelineDate(extent[1], numericFormat);
      const end = parseEasyTimelineDate(extent[2], numericFormat);
      if (!start || !end) continue;
      const category = trailing.match(/\bcolor\s*:\s*([^\s]+)/i)?.[1];
      const categoryContext = `${currentBar} ${section.title}`;
      events.push({
        id: uniqueId("event", `${start.sortKey}:${label}`, events.length),
        label,
        start: { ...start, precision: "range" },
        end: { ...end, precision: "range" },
        ...(category
          ? {
              category: normalizeEasyTimelineCategory(
                category,
                categoryContext,
              ),
            }
          : {}),
      });
    }
    const candidate = createTimelineCandidate({
      events,
      request,
      sourceHash,
      generatedAt,
      section,
      position,
      priority: 92,
      sourceIdentity: `easytimeline:${timelineIndex}:${sha256(body)}`,
    });
    if (candidate) candidates.push(candidate);
    timelineIndex += 1;
  }
  return candidates;
};

const firstAxisRecord = (value: unknown): JsonRecord | null => {
  if (isRecord(value)) return value;
  if (Array.isArray(value)) {
    const first = value.find(isRecord);
    return first ?? null;
  }
  return null;
};

const safeChartScalar = (value: unknown): ContextChartCell | undefined => {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string") {
    const clean = sanitizeContextText(value, 240);
    return clean || null;
  }
  return undefined;
};

const safeSeriesDatum = (
  value: unknown,
): { x?: ContextChartCell; y: number; label?: string } | null => {
  if (typeof value === "number" && Number.isFinite(value)) return { y: value };
  if (Array.isArray(value) && value.length >= 2) {
    const x = safeChartScalar(value[0]);
    const y = finiteNumber(value[1]);
    return x !== undefined && y != null ? { x, y } : null;
  }
  if (isRecord(value)) {
    const name = asString(value.name);
    if (Array.isArray(value.value) && value.value.length >= 2) {
      const x = safeChartScalar(value.value[0]);
      const y = finiteNumber(value.value[1]);
      return x !== undefined && y != null
        ? { x, y, ...(name ? { label: sanitizeContextText(name, 200) } : {}) }
        : null;
    }
    const y = finiteNumber(value.value);
    if (y != null) {
      return {
        y,
        ...(name ? { label: sanitizeContextText(name, 200) } : {}),
      };
    }
  }
  return null;
};

const uniqueColumnKey = (label: string, used: Set<string>): string => {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "value";
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
};

const axisName = (axis: JsonRecord | null, fallback: string): string => {
  const name = axis ? asString(axis.name) : null;
  return name ? sanitizeContextText(name, 160) || fallback : fallback;
};

const inferUnit = (label: string, values: string[] = []): string | undefined => {
  const labelCurrency = label.trim().match(/^([$£€¥])/u)?.[1];
  if (labelCurrency) return labelCurrency;
  const numericValues = values.filter(
    (value) => parseTableNumber(value) != null,
  );
  const valueCurrencies = numericValues.map(
    (value) => value.trim().match(/^([$£€¥])/u)?.[1],
  );
  if (
    valueCurrencies.length > 0 &&
    valueCurrencies.every(
      (currency): currency is string =>
        Boolean(currency) && currency === valueCurrencies[0],
    )
  ) {
    return valueCurrencies[0];
  }
  if (
    numericValues.length > 0 &&
    numericValues.every((value) => /%\s*$/.test(value))
  ) {
    return "%";
  }
  const match = label.match(/\(([^()]{1,30})\)\s*$/);
  const unit = match ? sanitizeContextText(match[1], 40) : "";
  return unit || undefined;
};

const formatChartValue = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

const chartSeriesDescription = (
  chart: ContextChartBlock["chart"],
): { caption: string; longDescription: string } | null => {
  const descriptions: string[] = [];
  for (const series of chart.series) {
    const values = chart.rows.flatMap((row) => {
      const y = row[series.yColumn];
      const x = row[series.xColumn];
      return typeof y === "number" ? [{ x, y }] : [];
    });
    if (values.length === 0) continue;
    let minimum = values[0];
    let maximum = values[0];
    for (const value of values.slice(1)) {
      if (value.y < minimum.y) minimum = value;
      if (value.y > maximum.y) maximum = value;
    }
    const unit = series.unit ? ` ${series.unit}` : "";
    const at = (x: ContextChartCell) =>
      x == null || x === "" ? "" : ` at ${String(x)}`;
    descriptions.push(
      `${series.label} has ${values.length} values; the lowest is ${formatChartValue(
        minimum.y,
      )}${unit}${at(minimum.x)}, and the highest is ${formatChartValue(maximum.y)}${unit}${at(
        maximum.x,
      )}`,
    );
  }
  if (descriptions.length === 0) return null;
  return {
    caption: `${descriptions[0]}.`,
    longDescription: `${descriptions.join(". ")}. The exact source values are available in the accompanying data table.`,
  };
};

const createChartCandidate = ({
  chart,
  request,
  sourceHash,
  generatedAt,
  section,
  position,
  priority,
  sourceIdentity,
  title,
}: {
  chart: ContextChartBlock["chart"];
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  section: ContextSection;
  position: number;
  priority: number;
  sourceIdentity: string;
  title?: string;
}): BlockCandidate | null => {
  if (
    chart.columns.length < 2 ||
    chart.columns.length > MAX_TABLE_COLUMNS ||
    chart.rows.length < 3 ||
    chart.rows.length > MAX_TABLE_ROWS ||
    chart.rows.length * chart.columns.length > MAX_TABLE_CELLS ||
    chart.series.length === 0
  ) {
    return null;
  }
  const description = chartSeriesDescription(chart);
  if (!description) return null;
  const subject = section.index === "__summary__" ? request.title : section.title;
  const base = buildBaseBlock({
    request,
    sourceHash,
    generatedAt,
    kind: "chart",
    section,
    title: title || `${subject} data`,
    caption: description.caption,
    longDescription: description.longDescription,
    sourceIdentity,
  });
  const block: ContextChartBlock = { ...base, kind: "chart", chart };
  return { block, position, priority };
};

const normalizeChartExtension = (
  value: unknown,
): { chart: ContextChartBlock["chart"]; title?: string } | null => {
  if (!isRecord(value) || !isRecord(value.spec)) return null;
  const spec = value.spec;
  if (!Array.isArray(spec.series) || spec.series.length === 0) return null;
  const xAxis = firstAxisRecord(spec.xAxis);
  const yAxis = firstAxisRecord(spec.yAxis);
  const xLabel = axisName(xAxis, "Category");
  const yLabel = axisName(yAxis, "Value");
  const categoryValues = Array.isArray(xAxis?.data)
    ? xAxis.data.map(safeChartScalar)
    : [];
  if (categoryValues.some((value) => value === undefined)) return null;

  const normalizedSeries: Array<{
    label: string;
    type: ContextChartSeries["type"];
    data: Array<{ x?: ContextChartCell; y: number; label?: string }>;
  }> = [];
  for (const seriesValue of spec.series.slice(0, 8)) {
    if (!isRecord(seriesValue)) continue;
    const sourceType = asString(seriesValue.type)?.toLowerCase();
    if (!sourceType || !["line", "bar", "pie"].includes(sourceType)) continue;
    if (!Array.isArray(seriesValue.data)) continue;
    const data = seriesValue.data.map(safeSeriesDatum);
    if (data.some((datum) => !datum)) continue;
    const safeData = data.filter(
      (datum): datum is NonNullable<typeof datum> => Boolean(datum),
    );
    if (safeData.length < 3) continue;
    const rawName = asString(seriesValue.name);
    const label = rawName
      ? sanitizeContextText(rawName, 160)
      : `${yLabel} ${normalizedSeries.length + 1}`;
    const type: ContextChartSeries["type"] =
      sourceType === "line" && isRecord(seriesValue.areaStyle)
        ? "area"
        : (sourceType as "line" | "bar" | "pie");
    normalizedSeries.push({ label, type, data: safeData });
  }
  if (normalizedSeries.length === 0) return null;

  const usedKeys = new Set<string>();
  const xKey = uniqueColumnKey(xLabel, usedKeys);
  const columns: ContextChartColumn[] = [
    { key: xKey, label: xLabel, dataType: "string" },
  ];
  const series: ContextChartSeries[] = [];
  const rowMap = new Map<string, Record<string, ContextChartCell>>();
  const rowOrder: string[] = [];

  normalizedSeries.forEach((normalized, seriesIndex) => {
    const yKey = uniqueColumnKey(normalized.label, usedKeys);
    const unit = inferUnit(normalized.label) ?? inferUnit(yLabel);
    columns.push({
      key: yKey,
      label: normalized.label,
      dataType: "number",
      ...(unit ? { unit } : {}),
    });
    series.push({
      id: uniqueId("series", normalized.label, seriesIndex),
      label: normalized.label,
      type: normalized.type,
      xColumn: xKey,
      yColumn: yKey,
      ...(unit ? { unit } : {}),
    });
    normalized.data.forEach((datum, datumIndex) => {
      const x =
        datum.x ??
        datum.label ??
        categoryValues[datumIndex] ??
        String(datumIndex + 1);
      const rowKey = `${typeof x}:${String(x)}`;
      let row = rowMap.get(rowKey);
      if (!row) {
        row = { [xKey]: x };
        rowMap.set(rowKey, row);
        rowOrder.push(rowKey);
      }
      row[yKey] = datum.y;
    });
  });

  const rows = rowOrder.map((key) => {
    const row = rowMap.get(key)!;
    for (const column of columns) {
      if (!(column.key in row)) row[column.key] = null;
    }
    return row;
  });
  if (rows.length * columns.length > MAX_TABLE_CELLS) return null;
  const xIsNumeric = rows.every((row) => typeof row[xKey] === "number");
  columns[0] = { ...columns[0], dataType: xIsNumeric ? "number" : "string" };

  const titleRecord = firstAxisRecord(spec.title);
  const titleText = titleRecord ? asString(titleRecord.text) : null;
  return {
    chart: {
      columns,
      rows,
      series,
      sourceChartType: "chart-extension",
    },
    ...(titleText ? { title: sanitizeContextText(titleText, 240) } : {}),
  };
};

const extractChartExtensionCandidates = ({
  source,
  request,
  sourceHash,
  generatedAt,
  boundaries,
}: {
  source: MediaWikiParsedSource;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  boundaries: SectionBoundary[];
}): BlockCandidate[] => {
  const candidates: BlockCandidate[] = [];
  let chartIndex = 0;
  for (const match of source.html.matchAll(/<wiki-chart\b([^>]*)>/gi)) {
    const attrs = parseAttributes(match[1]);
    const raw = attrs["data-mw-chart"];
    if (!raw || raw.length > MAX_CHART_ATTRIBUTE_BYTES) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      continue;
    }
    const normalized = normalizeChartExtension(payload);
    if (!normalized) continue;
    const position = match.index ?? 0;
    const section = sectionAtOffset(boundaries, position);
    const candidate = createChartCandidate({
      chart: normalized.chart,
      request,
      sourceHash,
      generatedAt,
      section,
      position,
      priority: 100,
      sourceIdentity: `chart-extension:${chartIndex}:${sha256(raw)}`,
      title: normalized.title,
    });
    if (candidate) candidates.push(candidate);
    chartIndex += 1;
  }
  return candidates;
};

type ParsedHtmlTable = {
  caption: string;
  headers: string[];
  rows: string[][];
  position: number;
  section: ContextSection;
};

const parseWikitables = (
  html: string,
  boundaries: SectionBoundary[],
): ParsedHtmlTable[] => {
  const tables: ParsedHtmlTable[] = [];
  for (const tableMatch of html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)) {
    const attrs = parseAttributes(tableMatch[1]);
    if (!/(?:^|\s)wikitable(?:\s|$)/i.test(attrs.class ?? "")) continue;
    const body = tableMatch[2];
    if (/<table\b/i.test(body)) continue;
    const captionMatch = body.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    const caption = captionMatch
      ? sanitizeContextCaption(captionMatch[1], 300)
      : "";
    const parsedRows: Array<{
      values: string[];
      headerCount: number;
      invalidSpan: boolean;
    }> = [];
    for (const rowMatch of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: string[] = [];
      let headerCount = 0;
      let invalidSpan = false;
      for (const cellMatch of rowMatch[1].matchAll(
        /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
      )) {
        const cellAttrs = parseAttributes(cellMatch[2]);
        const colspan = Number(cellAttrs.colspan ?? "1");
        const rowspan = Number(cellAttrs.rowspan ?? "1");
        if (colspan !== 1 || rowspan !== 1) invalidSpan = true;
        if (cellMatch[1].toLowerCase() === "th") headerCount += 1;
        cells.push(sanitizeContextText(cellMatch[3], 1_000));
      }
      if (cells.length > 0) parsedRows.push({ values: cells, headerCount, invalidSpan });
    }
    const headerIndex = parsedRows.findIndex(
      (row) =>
        !row.invalidSpan &&
        row.values.length >= 2 &&
        row.values.length <= MAX_TABLE_COLUMNS &&
        row.headerCount >= Math.ceil(row.values.length / 2),
    );
    if (headerIndex < 0) continue;
    const headers = parsedRows[headerIndex].values;
    if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
      continue;
    }
    const rows = parsedRows
      .slice(headerIndex + 1)
      .filter(
        (row) =>
          !row.invalidSpan &&
          row.values.length === headers.length &&
          row.values.some(Boolean) &&
          row.values.some(
            (value, index) => value.toLowerCase() !== headers[index].toLowerCase(),
          ),
      )
      .slice(0, MAX_TABLE_ROWS + 1)
      .map((row) => row.values);
    if (
      rows.length < 3 ||
      rows.length > MAX_TABLE_ROWS ||
      rows.length * headers.length > MAX_TABLE_CELLS
    ) {
      continue;
    }
    const position = tableMatch.index ?? 0;
    tables.push({
      caption,
      headers,
      rows,
      position,
      section: sectionAtOffset(boundaries, position),
    });
  }
  return tables;
};

const extractTimelineFromTable = (
  table: ParsedHtmlTable,
): ContextTimelineEvent[] | null => {
  const dateColumn = table.headers.findIndex((header) =>
    /(?:^|\b)(date|year|years|period|time|dates)(?:\b|$)/i.test(header),
  );
  if (dateColumn < 0) return null;
  const eventColumn = table.headers.findIndex(
    (header, index) =>
      index !== dateColumn &&
      /(?:event|development|milestone|incident|description|name|storm|reign)/i.test(
        header,
      ),
  );
  // A year/value table is quantitative data, not a chronology. Require an
  // explicit source column that names events or descriptions before turning
  // dated rows into timeline events.
  if (eventColumn < 0) return null;
  const labelColumn = eventColumn;
  const categoryColumn = table.headers.findIndex((header) =>
    /^(?:category|type|classification)$/i.test(header),
  );
  const events: ContextTimelineEvent[] = [];
  for (const row of table.rows) {
    const parsedDate = parseContextDateRange(row[dateColumn]);
    const label = sanitizeContextText(row[labelColumn], 300);
    if (!parsedDate || !label) continue;
    const description = row
      .map((value, index) => ({ value, index }))
      .filter(
        ({ value, index }) =>
          index !== dateColumn &&
          index !== labelColumn &&
          index !== categoryColumn &&
          Boolean(value),
      )
      .map(({ value, index }) => `${table.headers[index]}: ${value}`)
      .join("; ");
    events.push({
      id: uniqueId(
        "event",
        `${parsedDate.start.sortKey}:${label}`,
        events.length,
      ),
      label,
      start: parsedDate.start,
      ...(parsedDate.end ? { end: parsedDate.end } : {}),
      ...(description
        ? { description: sanitizeContextText(description, 1_200) }
        : {}),
      ...(categoryColumn >= 0 && row[categoryColumn]
        ? { category: sanitizeContextText(row[categoryColumn], 120) }
        : {}),
    });
  }
  return events.length >= 3 ? events : null;
};

const parseTableNumber = (value: string): number | null => {
  const normalized = value
    .replace(/[−–]/g, "-")
    .replace(/[,$£€¥%\s]/g, "")
    .trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const extractChartFromTable = (
  table: ParsedHtmlTable,
): ContextChartBlock["chart"] | null => {
  const usedKeys = new Set<string>();
  const keys = table.headers.map((header) => uniqueColumnKey(header, usedKeys));
  const numericColumns = table.headers.map((_, columnIndex) => {
    const nonempty = table.rows
      .map((row) => row[columnIndex])
      .filter((value) => value.trim() !== "");
    const numeric = nonempty.filter((value) => parseTableNumber(value) != null);
    return nonempty.length >= 3 && numeric.length / nonempty.length >= 0.8;
  });
  const xColumnIndex = 0;
  const seriesIndexes = numericColumns
    .map((numeric, index) => (numeric && index !== xColumnIndex ? index : -1))
    .filter((index) => index >= 0)
    .slice(0, 8);
  if (seriesIndexes.length === 0) return null;
  const columns: ContextChartColumn[] = table.headers.map((header, index) => {
    const unit = inferUnit(
      header,
      table.rows.map((row) => row[index]).filter(Boolean),
    );
    return {
      key: keys[index],
      label: header,
      dataType: numericColumns[index] ? "number" : "string",
      ...(unit ? { unit } : {}),
    };
  });
  const rows: Record<string, ContextChartCell>[] = table.rows.flatMap((row) => {
    const normalized: Record<string, ContextChartCell> = {};
    for (let index = 0; index < columns.length; index += 1) {
      const raw = row[index].trim();
      normalized[keys[index]] = raw
        ? numericColumns[index]
          ? parseTableNumber(raw)
          : raw
        : null;
    }
    return seriesIndexes.some((index) => typeof normalized[keys[index]] === "number")
      ? [normalized]
      : [];
  });
  if (rows.length < 3) return null;
  const xLooksChronological =
    table.rows.filter((row) => parseContextDateRange(row[xColumnIndex])).length /
      table.rows.length >=
    0.8;
  const series: ContextChartSeries[] = seriesIndexes.map((index, seriesIndex) => ({
    id: uniqueId("series", table.headers[index], seriesIndex),
    label: table.headers[index],
    type: xLooksChronological ? "line" : "bar",
    xColumn: keys[xColumnIndex],
    yColumn: keys[index],
    ...(columns[index].unit ? { unit: columns[index].unit } : {}),
  }));
  return {
    columns,
    rows,
    series,
    sourceChartType: "wikitable",
  };
};

const extractTableCandidates = ({
  source,
  request,
  sourceHash,
  generatedAt,
  boundaries,
}: {
  source: MediaWikiParsedSource;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  boundaries: SectionBoundary[];
}): BlockCandidate[] => {
  const candidates: BlockCandidate[] = [];
  parseWikitables(source.html, boundaries).forEach((table, tableIndex) => {
    const timeline = extractTimelineFromTable(table);
    if (timeline) {
      const candidate = createTimelineCandidate({
        events: timeline,
        request,
        sourceHash,
        generatedAt,
        section: table.section,
        position: table.position,
        priority: 86,
        sourceIdentity: `date-table:${tableIndex}:${sha256(JSON.stringify(table.rows))}`,
      });
      if (candidate) candidates.push(candidate);
      return;
    }
    const chart = extractChartFromTable(table);
    if (!chart) return;
    const subject = table.section.index === "__summary__" ? request.title : table.section.title;
    const candidate = createChartCandidate({
      chart,
      request,
      sourceHash,
      generatedAt,
      section: table.section,
      position: table.position,
      priority: 72,
      sourceIdentity: `wikitable:${tableIndex}:${sha256(JSON.stringify(table.rows))}`,
      title: table.caption || `${subject} data`,
    });
    if (candidate) candidates.push(candidate);
  });
  return candidates;
};

const normalizeCommonsImageUrl = (value: string): string | null => {
  const candidate = value.startsWith("//") ? `https:${value}` : value;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "upload.wikimedia.org" ||
    !url.pathname.startsWith("/wikipedia/commons/") ||
    /\/math\//i.test(url.pathname) ||
    /\.svg$/i.test(url.pathname)
  ) {
    return null;
  }
  return url.toString();
};

const commonsFileSource = (
  figureHtml: string,
  accessedAt: string,
): ContextSource | null => {
  const anchor = figureHtml.match(
    /<a\b([^>]*)class="[^"]*\bmw-file-description\b[^"]*"[^>]*>/i,
  );
  const href = anchor ? parseAttributes(anchor[1]).href : null;
  if (!href) return null;
  const fileMatch = href.match(/\/wiki\/(?:File|Image):([^?#]+)/i);
  if (!fileMatch) return null;
  let fileName: string;
  try {
    fileName = decodeURIComponent(fileMatch[1]).replace(/_/g, " ");
  } catch {
    fileName = fileMatch[1].replace(/_/g, " ");
  }
  const safeName = sanitizeContextText(fileName, 300);
  if (!safeName) return null;
  return {
    label: `Wikimedia Commons file: ${safeName}`,
    url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(
      safeName.replace(/ /g, "_"),
    )}`,
    accessedAt,
  };
};

/**
 * Favor precision when promoting figures. Topic nouns such as "system",
 * "orbit", "body", and "part" occur frequently in ordinary photo captions
 * and do not establish that an image encodes relationships worth exploring as
 * a diagram. In addition to explicit diagram language, accept two narrow forms
 * of visual notation used by genuine Wikipedia diagrams whose captions do not
 * call themselves diagrams.
 */
const EXPLICIT_DIAGRAM_CAPTION_PATTERN =
  /\b(diagram|schematic|flow\s*chart|cross[- ]section|cutaway|infographic|anatomical\s+(?:diagram|illustration))\b/i;

const DIAGRAM_ARROW_NOTATION_PATTERN =
  /(?:\barrows?\b.{0,100}\b(?:show|indicate|represent|connect|trace)\b|\b(?:show|indicate|represent|connect|trace)\b.{0,100}\barrows?\b)/i;

const DIAGRAM_CIRCULAR_SEQUENCE_PATTERN =
  /(?:\bsequence\b.{0,180}\b(?:circle|spiral)\b|\b(?:circle|spiral)\b.{0,180}\bsequence\b)/i;

const isDiagramCaption = (caption: string): boolean =>
  EXPLICIT_DIAGRAM_CAPTION_PATTERN.test(caption) ||
  DIAGRAM_ARROW_NOTATION_PATTERN.test(caption) ||
  DIAGRAM_CIRCULAR_SEQUENCE_PATTERN.test(caption);

const captionWalkthrough = (caption: string): string[] => {
  const sentences = caption
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sanitizeContextText(sentence, 800))
    .filter(Boolean)
    .slice(0, 12);
  return sentences.length > 0 ? sentences : [caption];
};

const extractDiagramCandidates = ({
  source,
  request,
  sourceHash,
  generatedAt,
  boundaries,
}: {
  source: MediaWikiParsedSource;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  boundaries: SectionBoundary[];
}): BlockCandidate[] => {
  const candidates: BlockCandidate[] = [];
  let figureIndex = 0;
  for (const match of source.html.matchAll(
    /<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi,
  )) {
    const figureHtml = match[2];
    if (/<(?:video|audio|wiki-chart)\b/i.test(figureHtml)) continue;
    const imageMatch = figureHtml.match(/<img\b([^>]*)>/i);
    const captionMatch = figureHtml.match(
      /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i,
    );
    if (!imageMatch || !captionMatch) continue;
    const imageAttrs = parseAttributes(imageMatch[1]);
    const src = normalizeCommonsImageUrl(imageAttrs.src ?? "");
    const caption = sanitizeContextCaption(captionMatch[1], 2_500);
    if (!src || caption.length < 40 || !isDiagramCaption(caption)) {
      continue;
    }
    const width = finiteNumber(imageAttrs.width);
    const height = finiteNumber(imageAttrs.height);
    if ((width != null && width < 100) || (height != null && height < 100)) {
      continue;
    }
    const parts = [...figureHtml.matchAll(/<area\b([^>]*)>/gi)]
      .slice(0, 100)
      .flatMap((areaMatch, index) => {
        const attrs = parseAttributes(areaMatch[1]);
        const label = sanitizeContextText(attrs.alt || attrs.title || "", 200);
        return label
          ? [
              {
                id: uniqueId("part", label, index),
                label,
                ...(attrs.title && attrs.title !== label
                  ? { description: sanitizeContextText(attrs.title, 500) }
                  : {}),
              },
            ]
          : [];
      })
      .filter(
        (part, index, all) =>
          all.findIndex(
            (candidate) => candidate.label.toLowerCase() === part.label.toLowerCase(),
          ) === index,
      );
    const walkthrough = captionWalkthrough(caption);
    if (walkthrough.length === 0 && parts.length === 0) continue;
    const relationships: ContextDiagramBlock["diagram"]["relationships"] = [];
    const section = sectionAtOffset(boundaries, match.index ?? 0);
    const subject = section.index === "__summary__" ? request.title : section.title;
    const blockCaption = sanitizeContextText(walkthrough[0] || caption, 800);
    const fileSource = commonsFileSource(figureHtml, generatedAt);
    const base = buildBaseBlock({
      request,
      sourceHash,
      generatedAt,
      kind: "diagram",
      section,
      title: `${subject} diagram`,
      caption: blockCaption,
      longDescription: `${caption}${
        parts.length > 0
          ? ` Named regions in the source image are ${parts
              .map((part) => part.label)
              .join(", ")}.`
          : ""
      }`,
      sourceIdentity: `figure:${figureIndex}:${src}:${caption}`,
      extraSources: fileSource ? [fileSource] : [],
    });
    const block: ContextDiagramBlock = {
      ...base,
      kind: "diagram",
      diagram: {
        image: {
          src,
          alt: caption,
          ...(width != null && width > 0 ? { width: Math.round(width) } : {}),
          ...(height != null && height > 0 ? { height: Math.round(height) } : {}),
        },
        parts,
        relationships,
        walkthrough,
        caption,
      },
    };
    candidates.push({ block, position: match.index ?? 0, priority: 62 });
    figureIndex += 1;
  }
  return candidates;
};

const blockTextFields = (block: ContextBlock): string[] => [
  block.title,
  block.caption,
  block.longDescription,
  block.section.title,
  ...block.sources.flatMap((source) => [source.label, source.url]),
];

const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

/**
 * Returns human-readable invariant violations. An empty array means the
 * manifest is safe to expose to clients.
 */
export const validateContextManifest = (manifest: ContextManifest): string[] => {
  const errors: string[] = [];
  if (manifest.schemaVersion !== ARTICLE_CONTEXT_SCHEMA_VERSION) {
    errors.push("Unsupported context schema version");
  }
  if (manifest.blocks.length > MAX_BLOCKS_PER_ARTICLE) {
    errors.push("Too many context blocks");
  }
  const ids = new Set<string>();
  for (const block of manifest.blocks) {
    if (!block.id || ids.has(block.id)) errors.push(`Duplicate or empty block ID: ${block.id}`);
    ids.add(block.id);
    if (
      !block.title ||
      !block.caption ||
      !block.longDescription ||
      block.sources.length === 0
    ) {
      errors.push(`Block ${block.id} is missing its accessibility copy or sources`);
    }
    if (
      blockTextFields(block).some((text) =>
        /<(?:script|style|svg|iframe|object|embed)\b/i.test(text),
      )
    ) {
      errors.push(`Block ${block.id} contains unsafe markup`);
    }
    if (block.sources.some((source) => !isHttpsUrl(source.url))) {
      errors.push(`Block ${block.id} contains a non-HTTPS source`);
    }
    if (block.kind === "map") {
      const featureCount =
        block.map.places.length + block.map.routes.length + block.map.areas.length;
      if (featureCount === 0) errors.push(`Map ${block.id} has no semantic features`);
      const coordinates: ContextCoordinate[] = [
        block.map.center,
        ...block.map.places,
        ...block.map.routes.flatMap((route) => route.points),
        ...block.map.areas.flatMap((area) => area.rings.flatMap((ring) => ring)),
      ];
      if (
        coordinates.some(
          (coordinate) =>
            !Number.isFinite(coordinate.latitude) ||
            !Number.isFinite(coordinate.longitude) ||
            !validCoordinate(coordinate.latitude, coordinate.longitude),
        )
      ) {
        errors.push(`Map ${block.id} contains an invalid coordinate`);
      }
      if (block.map.routes.some((route) => route.points.length < 2)) {
        errors.push(`Map ${block.id} contains an incomplete route`);
      }
    } else if (block.kind === "timeline") {
      if (block.timeline.events.length < 3 || block.timeline.events.length > MAX_TABLE_ROWS) {
        errors.push(`Timeline ${block.id} has an unsupported event count`);
      }
      if (
        block.timeline.events.some(
          (event, index, events) =>
            !event.label ||
            !Number.isFinite(event.start.sortKey) ||
            (index > 0 && event.start.sortKey < events[index - 1].start.sortKey),
        )
      ) {
        errors.push(`Timeline ${block.id} has invalid or unsorted events`);
      }
    } else if (block.kind === "chart") {
      const columnKeys = new Set(block.chart.columns.map((column) => column.key));
      if (
        block.chart.columns.length < 2 ||
        columnKeys.size !== block.chart.columns.length ||
        block.chart.rows.length < 3 ||
        block.chart.rows.length > MAX_TABLE_ROWS ||
        block.chart.rows.length * block.chart.columns.length > MAX_TABLE_CELLS
      ) {
        errors.push(`Chart ${block.id} has an invalid table shape`);
      }
      if (
        block.chart.series.some(
          (series) =>
            !columnKeys.has(series.xColumn) ||
            !columnKeys.has(series.yColumn) ||
            !block.chart.rows.some((row) => typeof row[series.yColumn] === "number"),
        )
      ) {
        errors.push(`Chart ${block.id} has an invalid series`);
      }
    } else if (block.kind === "diagram") {
      if (
        !normalizeCommonsImageUrl(block.diagram.image.src) ||
        !block.diagram.caption ||
        block.diagram.walkthrough.length === 0
      ) {
        errors.push(`Diagram ${block.id} is missing its safe semantic equivalent`);
      }
    }
  }
  return errors;
};

const selectCandidates = (
  candidates: BlockCandidate[],
  sections: MediaWikiSectionSource[],
): ContextBlock[] => {
  const perSectionKind = new Map<
    string,
    { candidate: BlockCandidate; candidateIndex: number }
  >();
  candidates.forEach((candidate, candidateIndex) => {
    const key = `${candidate.block.section.index}\u0000${candidate.block.kind}`;
    const existing = perSectionKind.get(key);
    if (
      !existing ||
      candidate.priority > existing.candidate.priority ||
      (candidate.priority === existing.candidate.priority &&
        (candidate.position < existing.candidate.position ||
          (candidate.position === existing.candidate.position &&
            candidate.block.id.localeCompare(existing.candidate.block.id) < 0)))
    ) {
      perSectionKind.set(key, { candidate, candidateIndex });
    }
  });
  const articleOrder = new Map<string, number>([["__summary__", 0]]);
  sections.forEach((section, index) => articleOrder.set(section.index, index + 1));
  return [...perSectionKind.values()]
    .sort(
      (a, b) => {
        const candidateOrder =
          (articleOrder.get(a.candidate.block.section.index) ??
            Number.MAX_SAFE_INTEGER) -
            (articleOrder.get(b.candidate.block.section.index) ??
              Number.MAX_SAFE_INTEGER) ||
          a.candidate.position - b.candidate.position;
        if (candidateOrder !== 0) return candidateOrder;
        return (
          b.candidate.priority - a.candidate.priority ||
          a.candidate.block.kind.localeCompare(b.candidate.block.kind) ||
          a.candidate.block.id.localeCompare(b.candidate.block.id) ||
          a.candidateIndex - b.candidateIndex
        );
      },
    )
    .slice(0, MAX_BLOCKS_PER_ARTICLE)
    .map(({ candidate }, order) => ({ ...candidate.block, order }));
};

/** Pure extraction entry point used by fixtures, persistence jobs, and local mode. */
export const extractArticleContextFromSource = (
  source: MediaWikiParsedSource,
  input: ArticleContextRequest,
  options: Pick<ArticleContextExtractorOptions, "now"> = {},
): ContextManifest => {
  const request = normalizeArticleContextRequest(input);
  if (
    source.pageId !== request.wikiPageId ||
    source.revisionId !== request.revisionId ||
    source.language !== request.language ||
    normalizeWikipediaTitle(source.title) !== normalizeWikipediaTitle(request.title)
  ) {
    throw new ArticleContextInputError(
      "The parsed source does not match the requested article revision",
    );
  }
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const sourceHash = sha256(
    JSON.stringify({
      pageId: source.pageId,
      revisionId: source.revisionId,
      html: source.html,
      wikitext: source.wikitext,
      sections: source.sections,
    }),
  );
  const boundaries = findHtmlSectionBoundaries(source.html, source.sections);
  const shared = { source, request, sourceHash, generatedAt };
  const candidates = [
    ...extractChartExtensionCandidates({ ...shared, boundaries }),
    ...extractWikitextMapCandidates(shared),
    ...extractHtmlMapCandidates({ ...shared, boundaries }),
    ...extractEasyTimelineCandidates(shared),
    ...extractTableCandidates({ ...shared, boundaries }),
    ...extractDiagramCandidates({ ...shared, boundaries }),
  ];
  const manifest: ContextManifest = {
    schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
    wikiPageId: request.wikiPageId,
    title: source.title,
    revisionId: request.revisionId,
    language: request.language!,
    sourceHash,
    extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
    generatedAt,
    blocks: selectCandidates(candidates, source.sections),
  };
  const errors = validateContextManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Article context validation failed: ${errors.join("; ")}`);
  }
  return manifest;
};

/** Network + pure extraction convenience; callers may wrap this in any cache. */
export const fetchArticleContextManifest = async (
  input: ArticleContextRequest,
  options: ArticleContextExtractorOptions = {},
): Promise<ContextManifest> => {
  const request = normalizeArticleContextRequest(input);
  const source = await fetchRevisionMatchedMediaWikiSource(request, options);
  return extractArticleContextFromSource(source, request, { now: options.now });
};
