import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  type ArticleContextRequest,
  type ContextBlock,
  type ContextChartBlock,
  type ContextChartCell,
  type ContextChartColumn,
  type ContextChartSeries,
  type ContextCoordinate,
  type ContextDateValue,
  type ContextDiagramBlock,
  type ContextManifest,
  type ContextSection,
  type ContextSource,
  type ContextTimelineBlock,
  type ContextTimelineEvent,
} from "./article-context-types";
import {
  ArticleContextInputError,
  asString,
  buildBaseBlock,
  cleanWikitext,
  fetchRevisionMatchedMediaWikiSource,
  findHtmlSectionBoundaries,
  findWikitextSection,
  finiteNumber,
  isRecord,
  normalizeArticleContextRequest,
  normalizeWikipediaTitle,
  parseAttributes,
  sanitizeContextCaption,
  sanitizeContextText,
  sectionAtOffset,
  sha256,
  uniqueId,
  validCoordinate,
  type ArticleContextExtractorOptions,
  type ArticleOrderedBlockCandidate,
  type BlockCandidate,
  type CandidatePositionSpace,
  type JsonRecord,
  type MediaWikiParsedSource,
  type SectionBoundary,
} from "./article-context-foundations";
import {
  extractHtmlMapCandidates,
  extractOsmLocationMapCandidates,
  extractWikitextMapCandidates,
} from "./article-context-maps";

export {
  ArticleContextInputError,
  fetchRevisionMatchedMediaWikiSource,
  normalizeArticleContextRequest,
  sanitizeContextCaption,
  sanitizeContextText,
} from "./article-context-foundations";
export { ArticleContextUpstreamError } from "./article-context-foundations";
export type {
  ArticleContextExtractorOptions,
  MediaWikiParsedSource,
  MediaWikiSectionSource,
} from "./article-context-foundations";

const MAX_CHART_ATTRIBUTE_BYTES = 750_000;
const MAX_TABLE_COLUMNS = 12;
const MAX_TABLE_ROWS = 250;
const MAX_TABLE_CELLS = 3_000;
const MAX_BLOCKS_PER_ARTICLE = 6;
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

  const yearOnly = text.match(
    /^(-?(?:\d{1,4}|\d{1,3}(?:,\d{3})+))(?:\s*(BC|BCE|AD|CE))?$/i,
  );
  if (yearOnly) {
    let year = Number(yearOnly[1].replace(/,/g, ""));
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
    /^(?:(c\.?|ca\.?|circa)\s*)?(-?(?:\d{1,4}|\d{1,3}(?:,\d{3})+))\s*(?:–|—|-|to)\s*(-?(?:\d{1,4}|\d{1,3}(?:,\d{3})+))\s*(BC|BCE|AD|CE)?$/i,
  );
  if (yearRange) {
    const era = yearRange[4]?.toUpperCase();
    let startYear = Number(yearRange[2].replace(/,/g, ""));
    let endYear = Number(yearRange[3].replace(/,/g, ""));
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
  const rawUnit = match ? sanitizeContextText(match[1], 40) : "";
  if (!rawUnit) return undefined;

  const unit = rawUnit
    .replace(/\b(km|mi|m|ft)\s*(?:2|²)\b/gi, "$1²")
    .replace(/^\/\s*/, "per ")
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+/g, " ")
    .trim();

  const normalizedUnit = unit
    .toLocaleLowerCase()
    .replace(/²/g, "2")
    .replace(/\s+/g, " ")
    .trim();
  // Wikipedia frequently puts a source, edition, or reference year in the
  // same parentheses where a genuine unit sometimes appears. Treating
  // "GDP (IMF)" or "Population (2026)" as units produces misleading axes.
  if (
    /^(?:1[0-9]{3}|20[0-9]{2}|21[0-9]{2})(?:\s*[-–]\s*(?:[0-9]{2}|[12][0-9]{3}))?$/.test(
      normalizedUnit,
    ) ||
    /^(?:imf|world bank|un(?:desa)?|united nations|oecd|eurostat|census|estimate|estimated|projection|projected|forecast|source|official|revised|cia|who|fao)$/i.test(
      normalizedUnit,
    )
  ) {
    return undefined;
  }

  const looksLikeMeasurementUnit =
    /^(?:%|[$£€¥]|(?:(?:usd|eur|gbp|jpy|cad|aud|cny|[$£€¥])\s*)?(?:thousand|million|billion|trillion)s?(?:\s+(?:people|persons?|residents?|inhabitants?|households?|dollars?|euros?|pounds?|yen))?|(?:usd|eur|gbp|jpy|cad|aud|cny)|(?:people|persons?|residents?|inhabitants?|households?|units?|years?|months?|days?|hours?|minutes?|seconds?)|(?:km|km2|m|m2|cm|mm|mi|mi2|ft|ft2|kg|g|mg|lb|lbs|metric tons?|tonnes?|tons?|litres?|liters?|mw|gw|kw|kwh|mwh|gwh)|(?:per\s+.+)|(?:.+\s+per\s+.+)|(?:[a-z]{1,8}\s*\/\s*[a-z0-9^ ]{1,12}))$/i.test(
      normalizedUnit,
    );
  return looksLikeMeasurementUnit ? unit : undefined;
};

const formatChartValue = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: 4 });

const normalizeTableHeader = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[._/]+/g, " ")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isRankingPositionHeader = (value: string): boolean =>
  /^(?:pos|position|rank|ranks|ranking|place|seed)$/i.test(
    normalizeTableHeader(value),
  );

const isSerialNumberHeader = (value: string): boolean =>
  /^(?:#|no|number)$/i.test(normalizeTableHeader(value));

const isRankingEntityHeader = (value: string): boolean =>
  /^(?:team|player|club|country|nation|national olympic committee|noc|competitor|participant|entrant|driver|constructor|school|institution|university|candidate|artist|album|company|organization|title|film|song|work|name|location|city|state|county|region|territory|borough|prefecture|province|municipality|district|department|language|species|genus|island|site|religion|ethnic group)$/i.test(
    normalizeTableHeader(value),
  );

const isTeamRankingEntityHeader = (value: string): boolean =>
  /^(?:team|club|country|nation|constructor|school)$/i.test(
    normalizeTableHeader(value),
  );

const isBenchmarkMetricHeader = (value: string): boolean =>
  /(?:^|\b)(?:target|goal|baseline|benchmark|limit|threshold|reference|quota|minimum|maximum|cap)(?:\b|$)/i.test(
    normalizeTableHeader(value),
  );

const isNamedRankingEntity = (value: string): boolean => {
  const normalized = sanitizeContextText(value, 300).trim();
  return Boolean(normalized) &&
    !/^(?:[-–—]|n\/?a|none|not available|tbd|to be determined|unknown)$/i.test(
      normalized,
    );
};

const isRankingMetadataMetric = (value: string): boolean =>
  /^(?:previous rank|previous position|peak|peak position|change|rank change|change in rank|year|date|season|round|group|seed|minutes|minutes played)$/i.test(
    normalizeTableHeader(value),
  );

const contextMetricPriority = (
  rawHeader: string,
  table: ParsedHtmlTable,
): number => {
  const header = normalizeTableHeader(
    rawHeader.replace(/\s*\([^()]*\)\s*$/, ""),
  );
  const normalizedCaption = normalizeTableHeader(table.caption);
  const normalizedSection = normalizeTableHeader(table.section.title);
  const contexts = [
    { text: normalizedCaption, weight: 400 },
    { text: normalizedSection, weight: 200 },
  ];
  const aliases: Array<[RegExp, RegExp, number?]> = [
    [
      /^(?:density|population density)(?: \d{4})?$/,
      /\b(?:population\s+)?dens(?:e|er|est|ity|ely)\b/,
      2,
    ],
    [
      /^(?:population|pop)(?: \d{4})?$/,
      /\bpopulat(?:ion|ed|ing)\b(?!\s+density)/,
    ],
    [/^(?:revenue|sales|gross)(?: \d{4})?$/, /\b(?:revenue|sales|gross)\b/],
    [/^(?:gdp|gross domestic product)(?: \d{4})?$/, /\b(?:gdp|gross domestic product)\b/],
    [/^(?:area|land area)(?: \d{4})?$/, /\b(?:land\s+)?area\b/],
    [/^(?:capacity|attendance)(?: \d{4})?$/, /\b(?:capacity|attendance)\b/],
    [/^(?:income|median income)(?: \d{4})?$/, /\bincome\b/],
    [/^(?:growth|change|growth rate)(?: \d{4})?$/, /\b(?:growth|change)\b/],
    [/^(?:life expectancy|expectancy)(?: \d{4})?$/, /\blife expectancy\b/],
    [/^(?:votes?|vote share)(?: \d{4})?$/, /\bvote/],
  ];
  const alias = aliases.find(([metricPattern]) => metricPattern.test(header));
  const meaningfulTokens = header
    .split(" ")
    .filter((token) => token.length >= 4 && !/^(?:total|overall|average)$/.test(token));

  return contexts.reduce((score, context) => {
    if (!context.text) return score;
    if (alias) {
      return alias[1].test(context.text)
        ? score + context.weight * (alias[2] ?? 1)
        : score;
    }
    if (
      meaningfulTokens.some((token) =>
        new RegExp(`(?:^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?(?:$|\\s)`).test(
          context.text,
        ),
      )
    ) {
      return score + context.weight;
    }
    return score;
  }, 0);
};

const rankingMetricPriority = (
  table: ParsedHtmlTable,
  index: number,
): number => {
  const headers = table.headers;
  const normalizeMetricHeader = (value: string): string =>
    normalizeTableHeader(value.replace(/\s*\([^()]*\)\s*$/, ""));
  const header = normalizeMetricHeader(headers[index]);
  const normalizedHeaders = headers.map(normalizeMetricHeader);
  const hasHeader = (pattern: RegExp): boolean =>
    normalizedHeaders.some((candidate) => pattern.test(candidate));

  const isMedalTable =
    hasHeader(/^gold(?: medals?)?$/) &&
    hasHeader(/^silver(?: medals?)?$/) &&
    hasHeader(/^bronze(?: medals?)?$/);
  if (isMedalTable) {
    if (/^gold(?: medals?)?$/.test(header)) return 140 + contextMetricPriority(header, table);
    if (/^silver(?: medals?)?$/.test(header)) return 130 + contextMetricPriority(header, table);
    if (/^bronze(?: medals?)?$/.test(header)) return 120 + contextMetricPriority(header, table);
    if (/^(?:total|totals|overall)$/.test(header)) return 110 + contextMetricPriority(header, table);
  }

  const isLeagueTable =
    hasHeader(/^(?:points?|pts)$/) &&
    hasHeader(/^(?:wins?|won|victories|goal difference|goals? for|gf)$/);
  if (isLeagueTable) {
    if (/^(?:points?|pts)$/.test(header)) return 140 + contextMetricPriority(header, table);
    if (/^(?:goal difference|goals? difference|gd|difference|net)$/.test(header)) return 130 + contextMetricPriority(header, table);
    if (/^(?:wins?|won|victories)$/.test(header)) return 120 + contextMetricPriority(header, table);
    if (/^(?:goals? for|gf|goals? scored)$/.test(header)) return 110 + contextMetricPriority(header, table);
    if (/^(?:played|pld|games played|appearances)$/.test(header)) return 70 + contextMetricPriority(header, table);
    if (/^(?:draws?|drawn)$/.test(header)) return 60 + contextMetricPriority(header, table);
    if (/^(?:losses|lost)$/.test(header)) return 50 + contextMetricPriority(header, table);
    if (/^(?:goals? against|ga)$/.test(header)) return 40 + contextMetricPriority(header, table);
  }

  const isScoringTable =
    hasHeader(/^player$/) && hasHeader(/^(?:goals?|scores?|points?)$/);
  if (isScoringTable) {
    if (/^(?:goals?|scores?|points?)$/.test(header)) return 140 + contextMetricPriority(header, table);
    if (/^assists?$/.test(header)) return 130 + contextMetricPriority(header, table);
    if (/^(?:appearances|games played|played)$/.test(header)) return 110 + contextMetricPriority(header, table);
  }

  const contextualPriority = contextMetricPriority(header, table);
  if (/^(?:points?|pts|score|scores|rating|ratings|index|coefficient)$/.test(header)) return 140 + contextualPriority;
  if (/^(?:votes?|vote share|percentage|percent|pct)$/.test(header)) return 130 + contextualPriority;
  if (/^(?:revenue|gross|sales|value|population|density|population density|area|capacity|attendance|gdp|gross domestic product|income|median income)$/.test(header)) return 120 + contextualPriority;
  if (/^(?:difference|margin|net|goal difference|goals? difference|gd)$/.test(header)) return 110 + contextualPriority;
  if (/^(?:wins?|won|victories|goals?|medals?|podiums?|gold|silver|bronze)$/.test(header)) return 100 + contextualPriority;
  if (/^(?:total|totals|overall|average|avg)$/.test(header)) return 90 + contextualPriority;
  if (/^(?:assists?|appearances|played|pld)$/.test(header)) return 80 + contextualPriority;
  return 10 + contextualPriority;
};

const contextualUnitsFromText = (
  context: string,
  options: { includeSemantic?: boolean } = {},
): string[] => {
  const units = new Set<string>();
  if (/(?:%|\bpercent(?:age)?\b|\bpct\b)/i.test(context)) units.add("%");

  const scaleMatches = context.matchAll(
    /(?:\(|\b(?:in|measured in|expressed in)\s+)(thousand|million|billion|trillion)s?\b/gi,
  );
  for (const match of scaleMatches) units.add(`${match[1].toLowerCase()}s`);

  if (/\(\s*years?\s*\)|\b(?:in|measured in|expressed in)\s+years?\b/i.test(context)) {
    units.add("years");
  }
  if (options.includeSemantic !== false) {
    if (/\blife expectancy\b/i.test(context)) units.add("years");
    if (/\bdecadal growth rate\b/i.test(context)) units.add("%");
  }
  const currency = context.match(
    /(?:\(|\b(?:in|measured in|expressed in)\s+)(USD|EUR|GBP|JPY|CAD|AUD|CNY|[$£€¥])(?:\)|\s|$)/iu,
  )?.[1];
  if (currency) units.add(currency.toUpperCase());
  return [...units];
};

const contextualTableUnits = (table: ParsedHtmlTable): string[] =>
  contextualUnitsFromText(
    `${table.caption} ${table.section.title} ${table.context}`,
  );

const inferContextualTableUnit = (
  table: ParsedHtmlTable,
  seriesIndex: number,
  selectedSeriesIndexes: number[],
): string | undefined => {
  const units = contextualTableUnits(table);
  if (units.length !== 1) return undefined;
  const hasMetricContext = contextMetricPriority(
    table.headers[seriesIndex],
    table,
  ) > 0;
  const allSeriesAreComponents = selectedSeriesIndexes.every((index) =>
    /^(?:total|overall|male|males|men|female|females|women|both sexes)$/i.test(
      normalizeTableHeader(table.headers[index]),
    ),
  );
  const allSeriesArePeriods = selectedSeriesIndexes.every((index) =>
    /^(?:\d{2,4}\s*[-–—/]\s*\d{2,4}|(?:fy\s*)?\d{4})$/i.test(
      table.headers[index].trim(),
    ),
  );
  const semanticUnitAppliesToPeriods =
    allSeriesArePeriods &&
    /\bdecadal growth rate\b/i.test(
      `${table.caption} ${table.section.title}`,
    );
  const hasTableScopedUnit =
    contextualUnitsFromText(table.context, { includeSemantic: false }).length ===
      1 && /\b(?:following|this)\s+table\b/i.test(table.context);
  return hasMetricContext ||
    selectedSeriesIndexes.length === 1 ||
    allSeriesAreComponents ||
    semanticUnitAppliesToPeriods ||
    hasTableScopedUnit
    ? units[0]
    : undefined;
};

const chartSeriesDescription = (
  chart: ContextChartBlock["chart"],
): { caption: string; longDescription: string } | null => {
  const rankColumn = chart.columns.find((column) =>
    isRankingPositionHeader(column.label),
  );
  const ranked = Boolean(
    rankColumn && chart.series.some((series) => series.xColumn !== rankColumn.key),
  );
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
      x == null || x === ""
        ? ""
        : ranked
          ? ` for ${String(x)}`
          : ` at ${String(x)}`;
    descriptions.push(
      `${series.label} ${ranked ? "is listed for" : "has"} ${values.length} ${ranked ? "ranked entries" : "values"}; the lowest is ${formatChartValue(
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

const enclosingTableCaption = (html: string, position: number): string => {
  const prefix = html.slice(0, position);
  const lowerPrefix = prefix.toLocaleLowerCase();
  const tableStart = lowerPrefix.lastIndexOf("<table");
  const previousTableEnd = lowerPrefix.lastIndexOf("</table>");
  if (tableStart < 0 || tableStart < previousTableEnd) return "";
  const boundedTablePrefix = prefix.slice(Math.max(tableStart, position - 50_000));
  const captions = [
    ...boundedTablePrefix.matchAll(/<caption\b[^>]*>([\s\S]*?)<\/caption>/gi),
  ];
  const caption = captions.at(-1)?.[1];
  return caption ? sanitizeContextCaption(caption, 400) : "";
};

const isUnambiguousYearCategory = (value: ContextChartCell): boolean => {
  if (typeof value === "number") {
    return Number.isInteger(value) && Math.abs(value) >= 1_000;
  }
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  return /^(?:\d{4}|-\d{4}|(?:\d{1,3}(?:,\d{3})+|\d{1,4})\s*(?:BC|BCE|AD|CE))$/i.test(
    normalized,
  );
};

const normalizeChartExtension = (
  value: unknown,
  context = "",
): { chart: ContextChartBlock["chart"]; title?: string } | null => {
  if (!isRecord(value) || !isRecord(value.spec)) return null;
  const spec = value.spec;
  if (!Array.isArray(spec.series) || spec.series.length === 0) return null;
  // One category column plus every source series must fit the public chart
  // contract. Silently keeping only an arbitrary prefix changes the data.
  if (spec.series.length + 1 > MAX_TABLE_COLUMNS) return null;
  const xAxis = firstAxisRecord(spec.xAxis);
  const yAxis = firstAxisRecord(spec.yAxis);
  const xLabel = axisName(xAxis, "Category");
  const yLabel = axisName(yAxis, "Value");
  const inheritedUnits = contextualUnitsFromText(context, {
    includeSemantic: false,
  });
  const inheritedUnit = inheritedUnits.length === 1 ? inheritedUnits[0] : undefined;
  const categoryValues = Array.isArray(xAxis?.data)
    ? xAxis.data.map(safeChartScalar)
    : [];
  if (categoryValues.some((value) => value === undefined)) return null;

  const normalizedSeries: Array<{
    label: string;
    type: ContextChartSeries["type"];
    data: Array<{ x?: ContextChartCell; y: number; label?: string }>;
  }> = [];
  for (const seriesValue of spec.series) {
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
    const safeName = rawName ? sanitizeContextText(rawName, 160) : "";
    const label = safeName || `${yLabel} ${normalizedSeries.length + 1}`;
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
    const unit = inferUnit(normalized.label) ?? inferUnit(yLabel) ?? inheritedUnit;
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
  const xIsYear =
    /^(?:category|categories|x|x axis|horizontal axis)$/i.test(
      normalizeTableHeader(xLabel),
    ) &&
    rows.length >= 3 &&
    rows.every((row) => isUnambiguousYearCategory(row[xKey]));
  columns[0] = {
    ...columns[0],
    label: xIsYear ? "Year" : xLabel,
    dataType: xIsNumeric ? "number" : "string",
  };

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
    const position = match.index ?? 0;
    const normalized = normalizeChartExtension(
      payload,
      enclosingTableCaption(source.html, position),
    );
    if (!normalized) continue;
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
  context: string;
  headers: string[];
  rows: string[][];
  position: number;
  section: ContextSection;
};

type ParsedHtmlTableCell = {
  value: string;
  isHeader: boolean;
  colspan: number;
  rowspan: number;
};

type ParsedHtmlTableRow = {
  cells: ParsedHtmlTableCell[];
  headerCount: number;
};

const parseTableSpan = (value: string | undefined, maximum: number): number | null => {
  if (value == null) return 1;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum
    ? parsed
    : null;
};

const sanitizeTableCellText = (value: string): string =>
  sanitizeContextText(
    value
      .replace(
        /<(?:div|span)\b[^>]*class="[^"]*\b(?:navbar|mw-editsection)\b[^"]*"[^>]*>[\s\S]*?<\/(?:div|span)>/gi,
        " ",
      )
      .replace(
        /<abbr\b([^>]*)>([\s\S]*?)<\/abbr>/gi,
        (_match, attributeSource: string, inner: string) =>
          parseAttributes(attributeSource).title || inner,
      ),
    1_000,
  );

const precedingTableParagraphContext = (
  html: string,
  position: number,
  boundaries: SectionBoundary[],
): string => {
  let sectionStart = 0;
  for (const boundary of boundaries) {
    if (boundary.start > position) break;
    sectionStart = boundary.start;
  }
  const boundedStart = Math.max(sectionStart, position - 4_000);
  const prefix = html.slice(boundedStart, position);
  const paragraphs = [...prefix.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)];
  const nearest = paragraphs.at(-1);
  if (!nearest) return "";
  const paragraphEnd = (nearest.index ?? 0) + nearest[0].length;
  // Avoid borrowing prose from a distant part of a long section.
  if (prefix.length - paragraphEnd > 1_200) return "";
  return sanitizeContextText(nearest[1], 600);
};

/**
 * Expand simple rowspans into a rectangular data grid. Wikipedia standings
 * commonly group a shared outcome (for example, "Eliminated in quarterfinals")
 * across several rows. Reject unsupported or malformed geometry as a whole so
 * a chart can never be built from only the fragment that happened to be flat.
 */
const normalizeTableDataRows = (
  rows: ParsedHtmlTableRow[],
  width: number,
): string[][] | null => {
  const activeSpans = new Map<
    number,
    { value: string; remainingRows: number }
  >();
  const normalizedRows: string[][] = [];

  for (const row of rows) {
    const values: Array<string | undefined> = Array.from({ length: width });
    for (const [columnIndex, span] of activeSpans) {
      if (columnIndex >= width || values[columnIndex] !== undefined) return null;
      values[columnIndex] = span.value;
      span.remainingRows -= 1;
      if (span.remainingRows === 0) activeSpans.delete(columnIndex);
    }

    let cursor = 0;
    for (const cell of row.cells) {
      // Multi-column cells require a full header/grid association algorithm.
      // Declining those tables is safer than guessing which metric they mean.
      if (cell.colspan !== 1) return null;
      while (cursor < width && values[cursor] !== undefined) cursor += 1;
      if (cursor >= width) return null;
      values[cursor] = cell.value;
      if (cell.rowspan > 1) {
        if (activeSpans.has(cursor)) return null;
        activeSpans.set(cursor, {
          value: cell.value,
          remainingRows: cell.rowspan - 1,
        });
      }
      cursor += 1;
    }

    if (values.some((value) => value === undefined)) return null;
    normalizedRows.push(values as string[]);
  }

  return activeSpans.size === 0 ? normalizedRows : null;
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
    const parsedRows: ParsedHtmlTableRow[] = [];
    let malformedSpan = false;
    for (const rowMatch of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells: ParsedHtmlTableCell[] = [];
      let headerCount = 0;
      for (const cellMatch of rowMatch[1].matchAll(
        /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
      )) {
        const cellAttrs = parseAttributes(cellMatch[2]);
        const colspan = parseTableSpan(cellAttrs.colspan, MAX_TABLE_COLUMNS);
        const rowspan = parseTableSpan(cellAttrs.rowspan, MAX_TABLE_ROWS);
        if (colspan == null || rowspan == null) {
          malformedSpan = true;
          continue;
        }
        const isHeader = cellMatch[1].toLowerCase() === "th";
        if (isHeader) headerCount += 1;
        cells.push({
          value: sanitizeTableCellText(cellMatch[3]),
          isHeader,
          colspan,
          rowspan,
        });
      }
      if (cells.length > 0) parsedRows.push({ cells, headerCount });
    }
    if (malformedSpan) continue;
    const headerIndex = parsedRows.findIndex(
      (row) =>
        row.cells.every((cell) => cell.colspan === 1 && cell.rowspan === 1) &&
        row.cells.length >= 2 &&
        row.cells.length <= MAX_TABLE_COLUMNS &&
        row.headerCount >= Math.ceil(row.cells.length / 2),
    );
    if (headerIndex < 0) continue;
    const headers = parsedRows[headerIndex].cells.map((cell) => cell.value);
    if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) {
      continue;
    }
    const normalizedDataRows = normalizeTableDataRows(
      parsedRows.slice(headerIndex + 1),
      headers.length,
    );
    if (!normalizedDataRows) continue;
    const rows = normalizedDataRows
      .filter(
        (row) =>
          row.length === headers.length &&
          row.some(Boolean) &&
          row.some(
            (value, index) => value.toLowerCase() !== headers[index].toLowerCase(),
          ),
      )
      .slice(0, MAX_TABLE_ROWS + 1)
      .map((row) => row);
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
      context: precedingTableParagraphContext(html, position, boundaries),
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

const isSafeTableMetricLabel = (value: string): boolean => {
  const label = sanitizeContextText(value, 160).trim();
  return Boolean(label) &&
    !/^(?:[-–—?]|n\/?a|none|unknown|unnamed)$/i.test(label);
};

const isChronologicalTableColumn = (
  table: ParsedHtmlTable,
  rows: string[][],
  columnIndex: number,
): boolean => {
  const header = normalizeTableHeader(table.headers[columnIndex]);
  if (!/^(?:(?:(?:calendar|census|fiscal|reporting) )?years?(?: ended)?|dates?|months?|quarters?|periods?|time|weeks?|days?)$/i.test(header)) {
    return false;
  }
  const nonempty = rows
    .map((row) => row[columnIndex])
    .filter((value) => value.trim() !== "");
  const unambiguous = nonempty.filter(
    (value) =>
      !/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?$/i.test(
        value.trim(),
      ),
  );
  return nonempty.length >= 3 &&
    unambiguous.length === nonempty.length &&
    nonempty.filter((value) => parseContextDateRange(value)).length /
      nonempty.length >=
      0.8;
};

const isSecondaryCategoricalDimensionHeader = (value: string): boolean =>
  isRankingEntityHeader(value) ||
  /(?:^|\s)(?:areas?|colon(?:y|ies)|categories|category|types?|sex|genders?|races?|ethnicities|ethnicity|ages?|age groups?|cohorts?|groups?|classes|divisions?|sectors?|industries|occupations?|labels?|pairings?|provinces?|states?|territories|territory|regions?|counties|boroughs?|prefectures?)(?:\s|$)/i.test(
    normalizeTableHeader(value),
  );

const hasVaryingSecondaryCategoricalDimension = (
  table: ParsedHtmlTable,
  rows: string[][],
  numericColumns: boolean[],
  xColumnIndex: number,
): boolean =>
  table.headers.some((header, columnIndex) => {
    if (
      columnIndex === xColumnIndex ||
      numericColumns[columnIndex] ||
      !isSecondaryCategoricalDimensionHeader(header)
    ) {
      return false;
    }
    const values = rows
      .map((row) => normalizeTableHeader(row[columnIndex]))
      .filter(Boolean);
    return new Set(values).size > 1;
  });

const seriesHeaderYear = (value: string): number | null => {
  const matches = Array.from(
    value.matchAll(/(?:^|\D)((?:1[0-9]{3}|20[0-9]{2}|21[0-9]{2}))(?!\d)/g),
  );
  if (matches.length === 0) return null;
  const years = matches.map((match) => Number(match[1]));
  return Math.max(...years);
};

const prioritizeTableSeries = (
  indexes: number[],
  table: ParsedHtmlTable,
): number[] => {
  const datedSeriesCount = indexes.filter(
    (index) => seriesHeaderYear(table.headers[index]) != null,
  ).length;
  return [...indexes].sort((left, right) => {
    if (datedSeriesCount >= 2) {
      const leftYear = seriesHeaderYear(table.headers[left]);
      const rightYear = seriesHeaderYear(table.headers[right]);
      if (leftYear == null && rightYear != null) return 1;
      if (leftYear != null && rightYear == null) return -1;
      if (leftYear != null && rightYear != null && leftYear !== rightYear) {
        return rightYear - leftYear;
      }
    }
    return contextMetricPriority(table.headers[right], table) -
      contextMetricPriority(table.headers[left], table) || left - right;
  });
};

const extractChartFromTable = (
  table: ParsedHtmlTable,
): ContextChartBlock["chart"] | null => {
  const rankingPositionIndex = table.headers.findIndex(isRankingPositionHeader);
  const rankingEntityIndex = table.headers.findIndex(isRankingEntityHeader);
  const isRankingTable = rankingPositionIndex >= 0 && rankingEntityIndex >= 0;
  const sourceRows = isRankingTable
    ? table.rows.filter((row) => isNamedRankingEntity(row[rankingEntityIndex]))
    : table.rows;
  if (sourceRows.length < 3) return null;

  const usedKeys = new Set<string>();
  const keys = table.headers.map((header) => uniqueColumnKey(header, usedKeys));
  const numericColumns = table.headers.map((_, columnIndex) => {
    const nonempty = sourceRows
      .map((row) => row[columnIndex])
      .filter((value) => value.trim() !== "");
    const numeric = nonempty.filter((value) => parseTableNumber(value) != null);
    return nonempty.length >= 3 && numeric.length / nonempty.length >= 0.8;
  });
  if (
    numericColumns.some(
      (numeric, index) => numeric && !isSafeTableMetricLabel(table.headers[index]),
    )
  ) {
    return null;
  }
  const chronologicalColumnIndex = table.headers.findIndex((_, columnIndex) =>
    isChronologicalTableColumn(table, sourceRows, columnIndex),
  );
  const serialEntityIndex = isSerialNumberHeader(table.headers[0] ?? "")
    ? table.headers.findIndex(
        (header, index) =>
          index > 0 &&
          isRankingEntityHeader(header) &&
          !numericColumns[index],
      )
    : -1;
  const xColumnIndex = isRankingTable
    ? rankingEntityIndex
    : chronologicalColumnIndex >= 0
      ? chronologicalColumnIndex
      : serialEntityIndex >= 0
        ? serialEntityIndex
        : 0;
  if (
    chronologicalColumnIndex >= 0 &&
    xColumnIndex === chronologicalColumnIndex &&
    hasVaryingSecondaryCategoricalDimension(
      table,
      sourceRows,
      numericColumns,
      xColumnIndex,
    )
  ) {
    return null;
  }
  const plottableSeriesIndexes = numericColumns
    .map((numeric, index) => (numeric && index !== xColumnIndex ? index : -1))
    .filter((index) => index >= 0)
    .filter((index) => index !== rankingPositionIndex)
    .filter((index) => !isSerialNumberHeader(table.headers[index]))
    .filter((index) => isSafeTableMetricLabel(table.headers[index]));
  const varyingSeriesIndexes = plottableSeriesIndexes.filter((index) => {
      const values = sourceRows.flatMap((row) => {
        const value = parseTableNumber(row[index]);
        return value == null ? [] : [value];
      });
      return new Set(values).size >= 2;
    });
  const seriesIndexes = isRankingTable
    ? varyingSeriesIndexes
        .filter((index) => !isRankingMetadataMetric(table.headers[index]))
        .sort(
          (left, right) =>
            rankingMetricPriority(table, right) -
              rankingMetricPriority(table, left) || left - right,
        )
        .filter((index, position, sortedIndexes) => {
          const vector = sourceRows
            .map((row) => parseTableNumber(row[index]))
            .join("\u0000");
          return sortedIndexes.findIndex(
            (candidateIndex) =>
              sourceRows
                .map((row) => parseTableNumber(row[candidateIndex]))
                .join("\u0000") === vector,
          ) === position;
        })
        .slice(0, 4)
    : varyingSeriesIndexes.length > 0
      ? prioritizeTableSeries(
          plottableSeriesIndexes.filter(
            (index) =>
              varyingSeriesIndexes.includes(index) ||
              isBenchmarkMetricHeader(table.headers[index]),
          ),
          table,
        ).slice(0, 8)
      : [];
  if (seriesIndexes.length === 0) return null;
  const columns: ContextChartColumn[] = table.headers.map((header, index) => {
    const unit = inferUnit(
      header,
      sourceRows.map((row) => row[index]).filter(Boolean),
    ) ?? (seriesIndexes.includes(index)
      ? inferContextualTableUnit(table, index, seriesIndexes)
      : undefined);
    return {
      key: keys[index],
      label: header,
      dataType: numericColumns[index] ? "number" : "string",
      ...(unit ? { unit } : {}),
    };
  });
  const rows: Record<string, ContextChartCell>[] = sourceRows.flatMap((row) => {
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
  const xLooksChronological = isChronologicalTableColumn(
    table,
    sourceRows,
    xColumnIndex,
  );
  const chronologicalPointCount = xLooksChronological
    ? sourceRows.filter((row) => parseContextDateRange(row[xColumnIndex])).length
    : 0;
  const series: ContextChartSeries[] = seriesIndexes.map((index, seriesIndex) => ({
    id: uniqueId("series", table.headers[index], seriesIndex),
    label: table.headers[index],
    type:
      isRankingTable || !xLooksChronological || chronologicalPointCount < 4
        ? "bar"
        : "line",
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

/** Network + pure extraction convenience; callers may wrap this in any cache. */
export const fetchArticleContextManifest = async (
  input: ArticleContextRequest,
  options: ArticleContextExtractorOptions = {},
): Promise<ContextManifest> => {
  const request = normalizeArticleContextRequest(input);
  const source = await fetchRevisionMatchedMediaWikiSource(request, options);
  return extractArticleContextFromSource(source, request, { now: options.now });
};
