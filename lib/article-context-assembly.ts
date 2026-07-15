import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  type ArticleContextRequest,
  type ContextBlock,
  type ContextCoordinate,
  type ContextManifest,
} from "./article-context-types";
import {
  ArticleContextInputError,
  findHtmlSectionBoundaries,
  normalizeArticleContextRequest,
  normalizeWikipediaTitle,
  sha256,
  validCoordinate,
  type ArticleContextExtractorOptions,
  type ArticleOrderedBlockCandidate,
  type BlockCandidate,
  type CandidatePositionSpace,
  type MediaWikiParsedSource,
} from "./article-context-foundations";
import {
  extractChartExtensionCandidates,
  extractTableCandidates,
  isRankingEntityHeader,
  isRankingPositionHeader,
  isTeamRankingEntityHeader,
} from "./article-context-charts";
import {
  extractDiagramCandidates,
  normalizeCommonsImageUrl,
} from "./article-context-diagrams";
import {
  MAX_BLOCKS_PER_ARTICLE,
  MAX_TABLE_CELLS,
  MAX_TABLE_ROWS,
} from "./article-context-limits";
import {
  extractHtmlMapCandidates,
  extractOsmLocationMapCandidates,
  extractWikitextMapCandidates,
} from "./article-context-maps";
import { extractEasyTimelineCandidates } from "./article-context-timelines";

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

const withPositionSpace = (
  candidates: BlockCandidate[],
  positionSpace: CandidatePositionSpace,
): ArticleOrderedBlockCandidate[] =>
  candidates.map((candidate) => ({ ...candidate, positionSpace }));

const maskNonSectionContent = (value: string): string =>
  value
    .replace(/<!--[\s\S]*?(?:-->|$)/g, (match) => " ".repeat(match.length))
    .replace(
      /<(nowiki|pre|syntaxhighlight)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
      (match) => " ".repeat(match.length),
    );

const sourceSectionStarts = (
  value: string,
  positionSpace: CandidatePositionSpace,
): number[] => {
  const searchable = maskNonSectionContent(value);
  const headingPattern =
    positionSpace === "html"
      ? /<h[2-6]\b[^>]*>/gi
      : /^[ \t]*={2,6}[ \t]*.*?[ \t]*={2,6}[ \t]*$/gm;
  return [
    0,
    ...[...searchable.matchAll(headingPattern)]
      .map((match) => match.index ?? 0)
      .filter((start) => start > 0),
  ];
};

const normalizedSectionPosition = (
  candidate: ArticleOrderedBlockCandidate,
  sourceText: string,
  sectionStarts: number[],
): number => {
  const position = Math.max(0, Math.min(candidate.position, sourceText.length));
  let sectionStart = 0;
  let sectionEnd = sourceText.length;
  for (const start of sectionStarts) {
    if (start > position) {
      sectionEnd = start;
      break;
    }
    sectionStart = start;
  }
  return (position - sectionStart) / Math.max(1, sectionEnd - sectionStart);
};

const selectCandidates = (
  candidates: ArticleOrderedBlockCandidate[],
  source: Pick<MediaWikiParsedSource, "html" | "wikitext" | "sections">,
): ContextBlock[] => {
  const sectionStarts = {
    html: sourceSectionStarts(source.html, "html"),
    wikitext: sourceSectionStarts(source.wikitext, "wikitext"),
  };
  const sourceText = {
    html: source.html,
    wikitext: source.wikitext,
  };
  const articlePosition = (candidate: ArticleOrderedBlockCandidate): number =>
    normalizedSectionPosition(
      candidate,
      sourceText[candidate.positionSpace],
      sectionStarts[candidate.positionSpace],
    );
  const isRankedChartCandidate = (candidate: BlockCandidate): boolean =>
    candidate.block.kind === "chart" &&
    candidate.block.chart.columns.some((column) =>
      isRankingPositionHeader(column.label),
    ) &&
    candidate.block.chart.columns.some((column) =>
      isRankingEntityHeader(column.label),
    );
  const isGroupStandings = (candidate: BlockCandidate): boolean =>
    isRankedChartCandidate(candidate) &&
    /^(?:group|pool)\s+[a-z0-9]+$/i.test(candidate.block.section.title.trim());
  const hasAggregateRanking = candidates.some(
    (candidate) =>
      isRankedChartCandidate(candidate) &&
      !isGroupStandings(candidate) &&
      candidate.block.kind === "chart" &&
      candidate.block.chart.columns.some((column) =>
        isTeamRankingEntityHeader(column.label),
      ) &&
      candidate.block.chart.rows.length >= 8,
  );
  const eligibleCandidates = hasAggregateRanking
    ? candidates.filter((candidate) => !isGroupStandings(candidate))
    : candidates;
  const perSectionKind = new Map<
    string,
    {
      candidate: ArticleOrderedBlockCandidate;
      candidateIndex: number;
      articlePosition: number;
    }
  >();
  eligibleCandidates.forEach((candidate, candidateIndex) => {
    const key = `${candidate.block.section.index}\u0000${candidate.block.kind}`;
    const existing = perSectionKind.get(key);
    const candidateArticlePosition = articlePosition(candidate);
    if (
      !existing ||
      candidate.priority > existing.candidate.priority ||
      (candidate.priority === existing.candidate.priority &&
        (candidateArticlePosition < existing.articlePosition ||
          (candidateArticlePosition === existing.articlePosition &&
            candidate.block.id.localeCompare(existing.candidate.block.id) < 0)))
    ) {
      perSectionKind.set(key, {
        candidate,
        candidateIndex,
        articlePosition: candidateArticlePosition,
      });
    }
  });
  const articleOrder = new Map<string, number>([["__summary__", 0]]);
  source.sections.forEach((section, index) =>
    articleOrder.set(section.index, index + 1),
  );
  return [...perSectionKind.values()]
    .sort(
      (a, b) => {
        const sectionOrder =
          (articleOrder.get(a.candidate.block.section.index) ??
            Number.MAX_SAFE_INTEGER) -
          (articleOrder.get(b.candidate.block.section.index) ??
            Number.MAX_SAFE_INTEGER);
        const candidateOrder =
          sectionOrder ||
          // HTML and wikitext offsets are different byte spaces. Comparing
          // their section-relative progress keeps cross-source blocks in one
          // normalized article-order space without weakening section order.
          a.articlePosition - b.articlePosition;
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
  const osmLocationMaps = extractOsmLocationMapCandidates(shared);
  const candidates = [
    ...withPositionSpace(
      extractChartExtensionCandidates({ ...shared, boundaries }),
      "html",
    ),
    ...withPositionSpace(extractWikitextMapCandidates(shared), "wikitext"),
    ...withPositionSpace(osmLocationMaps.candidates, "wikitext"),
    ...withPositionSpace(
      extractHtmlMapCandidates({
        ...shared,
        boundaries,
        suppressedSectionIndexes: osmLocationMaps.sectionIndexes,
      }),
      "html",
    ),
    ...withPositionSpace(extractEasyTimelineCandidates(shared), "wikitext"),
    ...withPositionSpace(
      extractTableCandidates({ ...shared, boundaries }),
      "html",
    ),
    ...withPositionSpace(
      extractDiagramCandidates({ ...shared, boundaries }),
      "html",
    ),
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
    blocks: selectCandidates(candidates, source),
  };
  const errors = validateContextManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Article context validation failed: ${errors.join("; ")}`);
  }
  return manifest;
};
