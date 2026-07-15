import {
  type ArticleContextRequest,
  type ContextChartBlock,
  type ContextChartCell,
  type ContextChartColumn,
  type ContextChartSeries,
  type ContextSection,
} from "./article-context-types";
import {
  asString,
  buildBaseBlock,
  finiteNumber,
  isRecord,
  parseAttributes,
  sanitizeContextCaption,
  sanitizeContextText,
  sectionAtOffset,
  sha256,
  uniqueId,
  type BlockCandidate,
  type JsonRecord,
  type MediaWikiParsedSource,
  type SectionBoundary,
} from "./article-context-foundations";
import {
  MAX_CHART_ATTRIBUTE_BYTES,
  MAX_TABLE_CELLS,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
} from "./article-context-limits";
import {
  parseWikitables,
  type ParsedHtmlTable,
} from "./article-context-html-tables";
import {
  createTimelineCandidate,
  extractTimelineFromTable,
  parseContextDateRange,
} from "./article-context-timelines";

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

export const isRankingPositionHeader = (value: string): boolean =>
  /^(?:pos|position|rank|ranks|ranking|place|seed)$/i.test(
    normalizeTableHeader(value),
  );

const isSerialNumberHeader = (value: string): boolean =>
  /^(?:#|no|number)$/i.test(normalizeTableHeader(value));

export const isRankingEntityHeader = (value: string): boolean =>
  /^(?:team|player|club|country|nation|national olympic committee|noc|competitor|participant|entrant|driver|constructor|school|institution|university|candidate|artist|album|company|organization|title|film|song|work|name|location|city|state|county|region|territory|borough|prefecture|province|municipality|district|department|language|species|genus|island|site|religion|ethnic group)$/i.test(
    normalizeTableHeader(value),
  );

export const isTeamRankingEntityHeader = (value: string): boolean =>
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

export const extractChartExtensionCandidates = ({
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

export const extractTableCandidates = ({
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
