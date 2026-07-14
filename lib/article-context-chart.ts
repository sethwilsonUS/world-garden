import type {
  ContextChartBlock,
  ContextChartCell,
  ContextChartColumn,
  ContextChartSeries,
} from "./article-context-types";

const DEFAULT_RANKING_OVERVIEW_LIMIT = 8;
const DEFAULT_CATEGORY_OVERVIEW_LIMIT = 12;
const MAX_STANDARD_FAMILY_SERIES = 6;
const MAX_STANDARD_DEFAULT_SERIES = 4;
const MAX_STANDARD_SERIES_OPTIONS = 6;
const MAX_STANDARD_SCALE_FAMILIES = 4;

const normalizeLabel = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/[._/]+/g, " ")
    .replace(/[^a-z0-9#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const isRankLabel = (value: string): boolean =>
  /^(?:pos|position|rank|ranks|ranking|place|seed)$/.test(
    normalizeLabel(value),
  );

const isOrdinalPositionLabel = (value: string): boolean => {
  const withoutTrailingContext = value.trim().replace(
    /\s*(?:\([^()]{1,40}\)|[-–—]\s*(?:[A-Z]{2,4}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3}))\s*$/,
    "",
  );
  return /^(?:(?:peak|highest|best)(?: chart)? position|chart position|pos|position|rank|ranks|ranking|place|seed)$/.test(
    normalizeLabel(withoutTrailingContext),
  );
};

const isEntityLabel = (value: string): boolean =>
  /^(?:team|player|club|country|nation|national olympic committee|noc|competitor|participant|entrant|driver|constructor|school|institution|university|candidate|artist|album|company|organization|title|film|song|work|name|location|city|state|county|region|territory|borough|prefecture|province|municipality|district|department|language|species|genus|island|site|religion|ethnic group)$/.test(
    normalizeLabel(value),
  );

const isOutcomeLabel = (value: string): boolean =>
  /^(?:final result|result|outcome|status|stage|finish|final position)$/.test(
    normalizeLabel(value),
  );

const hasDisplayValue = (value: ContextChartCell | undefined): boolean =>
  value !== null && value !== undefined && String(value).trim() !== "";

export type RankedChartPresentation = {
  rankColumn: ContextChartColumn;
  entityColumn: ContextChartColumn;
  measureSeries: ContextChartSeries;
  availableSeries: ContextChartSeries[];
  outcomeColumn?: ContextChartColumn;
  rows: ContextChartBlock["chart"]["rows"];
  visibleRows: ContextChartBlock["chart"]["rows"];
  hiddenRowCount: number;
};

export type OrdinalPositionPresentation = {
  categoryColumn: ContextChartColumn;
  measureColumn: ContextChartColumn;
  measureSeries: ContextChartSeries;
  rows: ContextChartBlock["chart"]["rows"];
  visibleRows: ContextChartBlock["chart"]["rows"];
  truncatedRowCount: number;
  unusableRowCount: number;
};

/**
 * A chart peak or rank is an ordinal result: first is better than thirteenth,
 * but it is not thirteen times as large. Return a compact source-order view so
 * callers can avoid encoding these values as misleading bar lengths.
 */
export const getOrdinalPositionPresentation = (
  block: ContextChartBlock,
  limit = DEFAULT_CATEGORY_OVERVIEW_LIMIT,
): OrdinalPositionPresentation | null => {
  if (getRankedChartPresentation(block)) return null;
  const usableSeries = block.chart.series.filter((series) =>
    block.chart.rows.some((row) => {
      const value = row[series.yColumn];
      return typeof value === "number" && Number.isFinite(value);
    }),
  );
  if (usableSeries.length !== 1) return null;

  const measureSeries = usableSeries[0];
  const categoryColumn = block.chart.columns.find(
    (column) => column.key === measureSeries.xColumn,
  );
  const measureColumn = block.chart.columns.find(
    (column) => column.key === measureSeries.yColumn,
  );
  if (
    !categoryColumn ||
    !measureColumn ||
    !isOrdinalPositionLabel(measureSeries.label) &&
      !isOrdinalPositionLabel(measureColumn.label)
  ) {
    return null;
  }

  const displayableRows = block.chart.rows.filter((row) =>
    hasDisplayValue(row[categoryColumn.key]),
  );
  const numericValues = displayableRows.flatMap((row) => {
    const value = row[measureSeries.yColumn];
    return typeof value === "number" && Number.isFinite(value) ? [value] : [];
  });
  if (
    numericValues.some((value) => !Number.isSafeInteger(value) || value < 1)
  ) {
    return null;
  }

  const rows = displayableRows.filter((row) => {
    const value = row[measureSeries.yColumn];
    return typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 1;
  });
  if (rows.length < 2) return null;
  const safeLimit = Number.isSafeInteger(limit) && limit >= 3
    ? limit
    : DEFAULT_CATEGORY_OVERVIEW_LIMIT;
  const visibleRows = rows.slice(0, safeLimit);

  return {
    categoryColumn,
    measureColumn,
    measureSeries,
    rows,
    visibleRows,
    truncatedRowCount: Math.max(0, rows.length - visibleRows.length),
    unusableRowCount: Math.max(0, block.chart.rows.length - rows.length),
  };
};

/**
 * Ranked tables are better presented as compact leaderboards than as several
 * overlapping series. The extractor identifies one informative measure and
 * names the competitor as its x column; this helper derives the display-only
 * leaderboard without adding presentation metadata to the public manifest.
 */
export const getRankedChartPresentation = (
  block: ContextChartBlock,
  limit = DEFAULT_RANKING_OVERVIEW_LIMIT,
): RankedChartPresentation | null => {
  const rankColumn = block.chart.columns.find((column) =>
    column.dataType === "number" && isRankLabel(column.label),
  );
  const entityColumn = block.chart.columns.find((column) =>
    isEntityLabel(column.label),
  );
  const availableSeries = block.chart.series.filter(
    (series) => entityColumn && series.xColumn === entityColumn.key,
  );
  const measureSeries = availableSeries[0];
  if (!rankColumn || !entityColumn || !measureSeries) return null;

  const rows = block.chart.rows.filter(
    (row) =>
      hasDisplayValue(row[rankColumn.key]) &&
      hasDisplayValue(row[entityColumn.key]),
  );
  if (rows.length < 3) return null;
  const safeLimit = Number.isSafeInteger(limit) && limit >= 3
    ? limit
    : DEFAULT_RANKING_OVERVIEW_LIMIT;
  const visibleRows = rows.slice(0, safeLimit);

  return {
    rankColumn,
    entityColumn,
    measureSeries,
    availableSeries,
    outcomeColumn: block.chart.columns.find((column) =>
      isOutcomeLabel(column.label),
    ),
    rows,
    visibleRows,
    hiddenRowCount: Math.max(0, rows.length - visibleRows.length),
  };
};

export type RankedBarGeometry = {
  zeroPercent: number;
  startPercent: number;
  widthPercent: number;
  direction: "negative" | "positive" | "zero";
};

export const getRankedBarGeometry = (
  values: ContextChartCell[],
  value: ContextChartCell | undefined,
): RankedBarGeometry | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const numericValues = values.filter(
    (candidate): candidate is number =>
      typeof candidate === "number" && Number.isFinite(candidate),
  );
  if (numericValues.length === 0) return null;
  const minimum = Math.min(0, ...numericValues);
  const maximum = Math.max(0, ...numericValues);
  const span = maximum - minimum || 1;
  const zeroPercent = ((0 - minimum) / span) * 100;
  const valuePercent = ((value - minimum) / span) * 100;
  return {
    zeroPercent,
    startPercent: Math.min(zeroPercent, valuePercent),
    widthPercent: Math.abs(valuePercent - zeroPercent),
    direction: value < 0 ? "negative" : value > 0 ? "positive" : "zero",
  };
};

export type StandardChartScaleKind =
  | "area"
  | "count"
  | "currency"
  | "density"
  | "duration"
  | "index"
  | "percent"
  | "rate"
  | "scaled-count"
  | "unspecified";

export type StandardChartMarkFamily = "bar" | "line" | "pie";

export type StandardChartRenderKind =
  | "bar"
  | "exact-only"
  | "line"
  | "pie";

export const getContextChartPayloadKey = (
  rows: ContextChartBlock["chart"]["rows"],
  series: ContextChartSeries[],
): string => JSON.stringify({
  series: series.map(({ id, label, type, xColumn, yColumn, unit }) => [
    id,
    label,
    type,
    xColumn,
    yColumn,
    unit ?? null,
  ]),
  values: rows.map((row) =>
    series.map(({ xColumn, yColumn }) => [row[xColumn], row[yColumn]]),
  ),
});

export type StandardChartScaleFamily = {
  id: string;
  label: string;
  scaleKey: string;
  scaleKind: StandardChartScaleKind;
  markFamily: StandardChartMarkFamily;
  unit?: string;
  series: ContextChartSeries[];
  primarySeries: ContextChartSeries;
  hiddenSeriesCount: number;
  selectionSummary: string;
  zeroBaseline: boolean;
};

export type StandardChartRowSelection =
  | "all"
  | "chronological"
  | "exact-only"
  | "source-order"
  | "top-values";

export type StandardChartFamilyView = {
  familyId: string;
  categoryColumn: ContextChartColumn;
  selectedSeries: ContextChartSeries[];
  anchorSeries: ContextChartSeries;
  renderKind: StandardChartRenderKind;
  sourceRows: ContextChartBlock["chart"]["rows"];
  visualRows: ContextChartBlock["chart"]["rows"];
  sourceRowCount: number;
  eligibleRowCount: number;
  visibleRowCount: number;
  hiddenRowCount: number;
  aggregateRowCount: number;
  unusableRowCount: number;
  truncatedRowCount: number;
  chronological: boolean;
  preserveSourceOrder: boolean;
  rowSelection: StandardChartRowSelection;
  rowSummary: string;
  zeroBaseline: boolean;
};

export type StandardChartPresentation = {
  categoryColumn: ContextChartColumn;
  families: StandardChartScaleFamily[];
  primaryFamily: StandardChartScaleFamily;
  primaryView: StandardChartFamilyView;
  availableSeries: ContextChartSeries[];
  defaultSeries: ContextChartSeries[];
  optionalSeries: ContextChartSeries[];
  sourceRows: ContextChartBlock["chart"]["rows"];
  visualRows: ContextChartBlock["chart"]["rows"];
  sourceRowCount: number;
  visibleRowCount: number;
  hiddenRowCount: number;
  aggregateRowCount: number;
  unusableRowCount: number;
  truncatedRowCount: number;
  hiddenSeriesCount: number;
  chronological: boolean;
  preserveSourceOrder: boolean;
  rowSelection: StandardChartRowSelection;
  rowSummary: string;
  selectionSummary: string;
  renderKind: StandardChartRenderKind;
  zeroBaseline: boolean;
};

type SeriesScale = {
  key: string;
  kind: StandardChartScaleKind;
  label: string;
  unit?: string;
};

const normalizeUnit = (value: string): string =>
  value
    .toLocaleLowerCase()
    .replace(/²/g, "2")
    .replace(/\bsq(?:uare)?\.?\s*/g, "square ")
    .replace(/\bkilometres?\b/g, "kilometers")
    .replace(/\bmetres?\b/g, "meters")
    .replace(/\s+/g, " ")
    .trim();

const scaleFromUnit = (unit: string): SeriesScale => {
  const normalized = normalizeUnit(unit);
  if (/^(?:%|percent|percentage|pct)$/.test(normalized)) {
    return { key: "percent", kind: "percent", label: "Percent (%)", unit };
  }

  const currency = (() => {
    if (/^(?:\$|us\$|usd|u s dollars?|dollars?)$/.test(normalized)) return "usd";
    if (/^(?:£|gbp|pounds?)$/.test(normalized)) return "gbp";
    if (/^(?:€|eur|euros?)$/.test(normalized)) return "eur";
    if (/^(?:¥|jpy|yen)$/.test(normalized)) return "jpy";
    return null;
  })();
  if (currency) {
    return {
      key: `currency:${currency}`,
      kind: "currency",
      label: `Currency (${unit})`,
      unit,
    };
  }

  if (/\b(?:per|\/).*\b(?:km2|kilometers?2|square (?:km|kilometers?)|mi2|square (?:mi|miles?))\b/.test(normalized)) {
    return {
      key: `density:${normalized}`,
      kind: "density",
      label: `Density (${unit})`,
      unit,
    };
  }
  if (/^(?:km2|kilometers?2|square (?:km|kilometers?)|mi2|square (?:mi|miles?)|m2|meters?2|square (?:m|meters?))$/.test(normalized)) {
    return {
      key: `area:${normalized}`,
      kind: "area",
      label: `Area (${unit})`,
      unit,
    };
  }
  if (/^(?:people|persons?|residents?|inhabitants?|population|households?)$/.test(normalized)) {
    return { key: "count:people", kind: "count", label: `Counts (${unit})`, unit };
  }
  if (/^(?:thousand|thousands|000|000s|million|millions|billion|billions)$/.test(normalized)) {
    return {
      key: `scaled-count:${normalized.replace(/s$/, "")}`,
      kind: "scaled-count",
      label: `Counts (${unit})`,
      unit,
    };
  }
  if (/^(?:year|years|yr|yrs|months?|days?|hours?)$/.test(normalized)) {
    return {
      key: `duration:${normalized.replace(/s$/, "")}`,
      kind: "duration",
      label: `Duration (${unit})`,
      unit,
    };
  }
  if (/\b(?:per|\/|ratio|rate)\b/.test(normalized)) {
    return {
      key: `rate:${normalized}`,
      kind: "rate",
      label: `Rate or ratio (${unit})`,
      unit,
    };
  }
  return {
    key: `unit:${normalized}`,
    kind: "unspecified",
    label: `Values in ${unit}`,
    unit,
  };
};

const scaleFromLabel = (label: string, seriesId: string): SeriesScale => {
  const normalized = normalizeLabel(label);
  if (label.includes("%") || /(?:^| )(?:percent|percentage|pct|share)(?: |$)/.test(normalized)) {
    return { key: "percent", kind: "percent", label: "Percent" };
  }
  if (/[$£€¥]/u.test(label)) {
    return {
      key: `semantic:currency:${label.match(/[$£€¥]/u)?.[0] ?? "unspecified"}`,
      kind: "currency",
      label: "Currency values",
    };
  }
  if (/(?:^| )(?:density|per square|per km|per mile)(?: |$)/.test(normalized)) {
    return {
      key: `semantic:density:${normalized}`,
      kind: "density",
      label: "Density",
    };
  }
  if (/(?:^| )(?:income|revenue|sales|price|cost|gross domestic product|gdp)(?: |$)/.test(normalized)) {
    return { key: "semantic:currency", kind: "currency", label: "Currency values" };
  }
  if (/(?:^| )(?:land area|area|surface area)(?: |$)/.test(normalized)) {
    return { key: "semantic:area", kind: "area", label: "Area" };
  }
  if (/(?:^| )(?:median age|mean age|average age|duration|years old)(?: |$)/.test(normalized)) {
    return { key: "semantic:duration", kind: "duration", label: "Durations" };
  }
  if (/(?:^| )(?:ratio|rate|per 100|per 1000|per capita)(?: |$)/.test(normalized)) {
    return {
      key: `semantic:rate:${normalized}`,
      kind: "rate",
      label: "Rate or ratio",
    };
  }
  if (/(?:^| )(?:population|households?|residents?|inhabitants?|number|count)(?: |$)/.test(normalized)) {
    return { key: "semantic:count", kind: "count", label: "Counts" };
  }
  if (/(?:^| )(?:score|rating|index|coefficient)(?: |$)/.test(normalized)) {
    return {
      key: `semantic:index:${normalized}`,
      kind: "index",
      label: "Score or index",
    };
  }
  return {
    key: `semantic:unspecified:${seriesId}`,
    kind: "unspecified",
    label,
  };
};

const getSeriesScale = (
  block: ContextChartBlock,
  series: ContextChartSeries,
): SeriesScale => {
  const column = block.chart.columns.find(
    (candidate) => candidate.key === series.yColumn,
  );
  const unit = series.unit ?? column?.unit;
  return unit ? scaleFromUnit(unit) : scaleFromLabel(series.label, series.id);
};

const getMarkFamily = (
  series: ContextChartSeries,
): StandardChartMarkFamily =>
  series.type === "pie"
    ? "pie"
    : series.type === "bar"
      ? "bar"
      : "line";

const formatList = (values: string[]): string => {
  if (values.length < 2) return values[0] ?? "No series";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
};

const isAggregateCategory = (value: ContextChartCell | undefined): boolean => {
  if (typeof value !== "string") return false;
  const normalized = normalizeLabel(value.replace(/\[[^\]]+\]/g, ""));
  if (
    /^(?:all|combined|grand total|overall|overall total|total|totals|world|world total|worldwide)$/.test(
      normalized,
    )
  ) {
    return true;
  }
  return /^(?:all|total)(?: all)? (?:ages?|age groups?|categories|classes|cohorts?|countries|entries|ethnic groups?|genders?|groups?|households?|languages?|locations?|nations?|participants?|people|persons?|population|races?|regions?|residents?|respondents?|sexes|states?|territories|years?)$/.test(
    normalized,
  );
};

const temporalKey = (value: ContextChartCell | undefined): number | null => {
  if (typeof value === "number") {
    return Number.isInteger(value) && Math.abs(value) <= 9999
      ? value
      : null;
  }
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .replace(/\[[^\]]+\]/g, "")
    .replace(/^(?:c(?:irca)?\.?\s*)/i, "")
    .trim();
  const financialYear = normalized.match(
    /^(?:fy\s*)?(\d{4})\s*[-–—/]\s*(\d{2}|\d{4})$/i,
  );
  if (financialYear) {
    const start = Number(financialYear[1]);
    const rawEnd = financialYear[2];
    let end = Number(rawEnd);
    if (rawEnd.length === 2) {
      end += Math.floor(start / 100) * 100;
      if (end < start) end += 100;
    }
    if (end === start + 1) return start;
  }
  const eraYear = normalized.match(
    /^(?:(a\.?d\.?|c\.?e\.?|b\.?c\.?(?:e\.?)?)\s*)?(\d{1,4}|\d{1,3}(?:,\d{3})+)\s*(a\.?d\.?|c\.?e\.?|b\.?c\.?(?:e\.?)?)?$/i,
  );
  if (eraYear && (eraYear[1] || eraYear[3])) {
    const prefix = eraYear[1]?.replace(/\./g, "").toLocaleLowerCase();
    const suffix = eraYear[3]?.replace(/\./g, "").toLocaleLowerCase();
    if (prefix && suffix && prefix !== suffix) return null;
    const era = prefix ?? suffix;
    const year = Number(eraYear[2].replace(/,/g, ""));
    return era === "bc" || era === "bce" ? -year : year;
  }
  const year = normalized.match(/^(-?\d{1,4})(?:s)?$/);
  if (year) return Number(year[1]);
  const yearQuarter = normalized.match(/^(\d{4})\s*(?:[-–—]\s*)?q([1-4])$/i) ??
    normalized.match(/^q([1-4])\s*(\d{4})$/i);
  if (yearQuarter) {
    const firstIsYear = yearQuarter[1].length === 4;
    const parsedYear = Number(firstIsYear ? yearQuarter[1] : yearQuarter[2]);
    const quarter = Number(firstIsYear ? yearQuarter[2] : yearQuarter[1]);
    return parsedYear * 4 + quarter;
  }
  if (
    /^(?:\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{4})$/i.test(
      normalized,
    )
  ) {
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const isChronologicalPresentation = (
  categoryColumn: ContextChartColumn,
  rows: ContextChartBlock["chart"]["rows"],
  series: ContextChartSeries[],
): boolean => {
  if (!series.every((candidate) => candidate.type === "line" || candidate.type === "area")) {
    return false;
  }
  if (!/(?:^|\b)(?:date|year|month|quarter|period|time|week|day)(?:\b|$)/i.test(categoryColumn.label)) {
    return false;
  }
  const keys = rows.map((row) => temporalKey(row[categoryColumn.key]));
  if (keys.length < 3 || keys.some((key) => key === null)) return false;
  const values = keys as number[];
  const differences = values.slice(1).map((value, index) => value - values[index]);
  return differences.every((difference) => difference > 0) ||
    differences.every((difference) => difference < 0);
};

const hasSemanticSourceOrder = (
  block: ContextChartBlock,
  categoryColumn: ContextChartColumn,
  series: ContextChartSeries[],
): boolean =>
  block.chart.columns.some(
    (column) => column.dataType === "number" && isRankLabel(column.label),
  ) ||
  /(?:^|\b)(?:age|age group|band|bucket|class|grade|level|stage|phase|step|order|sequence|range|interval|month|quarter|period)(?:\b|$)/i.test(
    categoryColumn.label,
  ) ||
  series.every((candidate) => candidate.type === "line" || candidate.type === "area");

export const shouldStandardChartUseZeroBaseline = (
  series: ContextChartSeries[],
  rows: ContextChartBlock["chart"]["rows"],
): boolean => {
  if (
    series.some(
      (candidate) => candidate.type === "area" || candidate.type === "bar",
    )
  ) {
    return true;
  }
  const values = series.flatMap((candidate) =>
    rows.flatMap((row) => {
      const value = row[candidate.yColumn];
      return typeof value === "number" && Number.isFinite(value) ? [value] : [];
    }),
  );
  return values.some((value) => value < 0) && values.some((value) => value > 0);
};

const countLabel = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

const typedCategoryKey = (value: ContextChartCell | undefined): string =>
  `${typeof value}:${String(value)}`;

/**
 * Derives the rows and rendering recommendation for the currently selected
 * series in one compatible family. Call this again when the user's selection
 * changes so a dense top-N stays anchored to the metric actually on screen.
 */
export const getStandardChartFamilyView = (
  block: ContextChartBlock,
  family: StandardChartScaleFamily,
  selectedSeries: ContextChartSeries[] = family.series,
  categoryLimit = DEFAULT_CATEGORY_OVERVIEW_LIMIT,
): StandardChartFamilyView | null => {
  const requestedIds = new Set(selectedSeries.map((series) => series.id));
  const activeSeries = family.series.filter((series) =>
    requestedIds.has(series.id),
  );
  if (activeSeries.length === 0) activeSeries.push(family.primarySeries);
  const anchorSeries = activeSeries[0];
  const categoryColumn = block.chart.columns.find(
    (column) => column.key === anchorSeries.xColumn,
  );
  if (!categoryColumn) return null;

  const sourceRows = block.chart.rows;
  const categorizedRows = sourceRows.filter((row) =>
    hasDisplayValue(row[categoryColumn.key]),
  );
  const aggregateRowCount = categorizedRows.filter((row) =>
    isAggregateCategory(row[categoryColumn.key]),
  ).length;
  const nonAggregateRows = categorizedRows.filter(
    (row) => !isAggregateCategory(row[categoryColumn.key]),
  );
  const usableRows = nonAggregateRows.filter((row) =>
    activeSeries.some((series) => {
      const value = row[series.yColumn];
      return typeof value === "number" && Number.isFinite(value);
    }),
  );
  const unusableRowCount = sourceRows.length - aggregateRowCount - usableRows.length;
  const chronological = family.markFamily === "line" &&
    isChronologicalPresentation(categoryColumn, usableRows, activeSeries);
  const categoryKeys = usableRows.map((row) =>
    typedCategoryKey(row[categoryColumn.key]),
  );
  const hasUniqueMeaningfulCategories =
    categoryKeys.length >= 3 && new Set(categoryKeys).size === categoryKeys.length;
  const safeLimit = Number.isSafeInteger(categoryLimit) && categoryLimit >= 3
    ? categoryLimit
    : DEFAULT_CATEGORY_OVERVIEW_LIMIT;
  const renderKind: StandardChartRenderKind = family.markFamily === "line"
    ? chronological
      ? "line"
      : hasUniqueMeaningfulCategories && usableRows.length <= safeLimit
        ? "bar"
        : "exact-only"
    : family.markFamily;
  const preserveSourceOrder = chronological ||
    family.markFamily === "line" ||
    hasSemanticSourceOrder(block, categoryColumn, activeSeries);
  const canTruncate = renderKind === "bar" || renderKind === "pie";
  const truncated = canTruncate &&
    family.markFamily !== "line" &&
    usableRows.length > safeLimit;
  const orderedRows = truncated && !preserveSourceOrder
    ? usableRows
        .map((row, index) => ({ row, index }))
        .sort((left, right) => {
          const leftValue = left.row[anchorSeries.yColumn];
          const rightValue = right.row[anchorSeries.yColumn];
          const leftNumber = typeof leftValue === "number" && Number.isFinite(leftValue)
            ? leftValue
            : Number.NEGATIVE_INFINITY;
          const rightNumber = typeof rightValue === "number" && Number.isFinite(rightValue)
            ? rightValue
            : Number.NEGATIVE_INFINITY;
          return rightNumber - leftNumber || left.index - right.index;
        })
        .map(({ row }) => row)
    : usableRows;
  const visualRows = renderKind === "exact-only"
    ? []
    : truncated
      ? orderedRows.slice(0, safeLimit)
      : orderedRows;
  const truncatedRowCount = truncated
    ? usableRows.length - visualRows.length
    : 0;
  const hiddenRowCount = sourceRows.length - visualRows.length;
  const rowSelection: StandardChartRowSelection = renderKind === "exact-only"
    ? "exact-only"
    : chronological
      ? "chronological"
      : truncated
        ? preserveSourceOrder
          ? "source-order"
          : "top-values"
        : "all";
  const hiddenDetails = [
    aggregateRowCount > 0
      ? `${countLabel(aggregateRowCount, "aggregate row")} kept in Exact chart data`
      : "",
    unusableRowCount > 0
      ? `${countLabel(unusableRowCount, "row")} without usable values for the selected ${
          activeSeries.length === 1 ? "series" : "series family"
        } kept in Exact chart data`
      : "",
  ].filter(Boolean);
  const suffix = hiddenDetails.length > 0 ? ` ${hiddenDetails.join("; ")}.` : "";
  const rowSummary = renderKind === "exact-only"
    ? `The visual overview is omitted because the source line does not have a unique ordered chronology; all ${countLabel(sourceRows.length, "source row")} remain in Exact chart data.`
    : family.markFamily === "line" && !chronological
      ? `Showing all ${countLabel(visualRows.length, "category", "categories")} in source order as bars because the source line does not have a unique ordered chronology.${suffix}`
      : chronological
        ? `Showing all ${countLabel(visualRows.length, "chronological value")} in source order.${suffix}`
        : truncated
          ? preserveSourceOrder
            ? `Showing the first ${visualRows.length} of ${usableRows.length} categories in meaningful source order; ${truncatedRowCount} more remain in Exact chart data.${suffix}`
            : `Showing the top ${visualRows.length} of ${usableRows.length} categories by ${anchorSeries.label}; ${truncatedRowCount} more remain in Exact chart data.${suffix}`
          : `Showing all ${countLabel(visualRows.length, "non-aggregate category", "non-aggregate categories")}.${suffix}`;
  const zeroBaseline = renderKind === "bar" ||
    shouldStandardChartUseZeroBaseline(activeSeries, visualRows);

  return {
    familyId: family.id,
    categoryColumn,
    selectedSeries: activeSeries,
    anchorSeries,
    renderKind,
    sourceRows,
    visualRows,
    sourceRowCount: sourceRows.length,
    eligibleRowCount: usableRows.length,
    visibleRowCount: visualRows.length,
    hiddenRowCount,
    aggregateRowCount,
    unusableRowCount,
    truncatedRowCount,
    chronological,
    preserveSourceOrder,
    rowSelection,
    rowSummary,
    zeroBaseline,
  };
};

/**
 * Derives a bounded, honest overview for non-ranking charts. Exact source rows
 * remain untouched on the block for the accompanying data table.
 */
export const getStandardChartPresentation = (
  block: ContextChartBlock,
  categoryLimit = DEFAULT_CATEGORY_OVERVIEW_LIMIT,
): StandardChartPresentation | null => {
  if (getRankedChartPresentation(block)) return null;
  const usableSeries = block.chart.series.filter(
    (series) =>
      block.chart.columns.some((column) => column.key === series.xColumn) &&
      block.chart.rows.some((row) => {
        const value = row[series.yColumn];
        return typeof value === "number" && Number.isFinite(value);
      }),
  );
  const firstSeries = usableSeries[0];
  if (!firstSeries) return null;
  const categoryColumn = block.chart.columns.find(
    (column) => column.key === firstSeries.xColumn,
  );
  if (!categoryColumn) return null;

  const grouped = new Map<string, {
    markFamily: StandardChartMarkFamily;
    scale: SeriesScale;
    series: ContextChartSeries[];
  }>();
  for (const series of usableSeries) {
    const scale = getSeriesScale(block, series);
    const markFamily = getMarkFamily(series);
    const key = `${series.xColumn}:${scale.key}:${markFamily}${
      markFamily === "pie" ? `:${series.id}` : ""
    }`;
    const family = grouped.get(key);
    if (family) family.series.push(series);
    else grouped.set(key, { markFamily, scale, series: [series] });
  }

  let exposedSeriesCount = 0;
  const families: StandardChartScaleFamily[] = [];
  for (const family of grouped.values()) {
    if (
      families.length >= MAX_STANDARD_SCALE_FAMILIES ||
      exposedSeriesCount >= MAX_STANDARD_SERIES_OPTIONS
    ) {
      break;
    }
    const remainingOptionCount = MAX_STANDARD_SERIES_OPTIONS - exposedSeriesCount;
    const series = family.series.slice(
      0,
      Math.min(MAX_STANDARD_FAMILY_SERIES, remainingOptionCount),
    );
    const primarySeries = series[0];
    if (!primarySeries) continue;
    const zeroBaseline = shouldStandardChartUseZeroBaseline(
      series,
      block.chart.rows,
    );
    families.push({
      id: `scale-${families.length + 1}`,
      label: family.scale.label,
      scaleKey: family.scale.key,
      scaleKind: family.scale.kind,
      markFamily: family.markFamily,
      ...(family.scale.unit ? { unit: family.scale.unit } : {}),
      series,
      primarySeries,
      hiddenSeriesCount: family.series.length - series.length,
      selectionSummary: family.scale.kind === "unspecified"
        ? `${series[0].label} uses its own scale because the source does not state a compatible unit.`
        : `${formatList(series.map((candidate) => candidate.label))} ${
            series.length === 1 ? "uses" : "share"
          } the ${family.scale.label.toLocaleLowerCase()} scale.`,
      zeroBaseline,
    });
    exposedSeriesCount += series.length;
  }
  const primaryFamily = families[0];
  if (!primaryFamily) return null;
  const defaultSeries = primaryFamily.series.slice(
    0,
    MAX_STANDARD_DEFAULT_SERIES,
  );
  const familyDefaultViews = new Map<string, StandardChartFamilyView>();
  for (const family of families) {
    const view = getStandardChartFamilyView(
      block,
      family,
      family.id === primaryFamily.id ? defaultSeries : family.series,
      categoryLimit,
    );
    if (view) {
      family.zeroBaseline = view.zeroBaseline;
      familyDefaultViews.set(family.id, view);
    }
  }
  const primaryView = familyDefaultViews.get(primaryFamily.id);
  if (!primaryView) return null;
  const availableSeries = families.flatMap((family) => family.series);
  const availableIds = new Set(availableSeries.map((series) => series.id));
  const hiddenSeriesCount = usableSeries.filter(
    (series) => !availableIds.has(series.id),
  ).length;
  const unselectedCompatibleCount =
    primaryFamily.series.length - defaultSeries.length;
  const selectionSummary = `${primaryFamily.selectionSummary} ${
    unselectedCompatibleCount > 0
      ? `${formatList(defaultSeries.map((series) => series.label))} ${
          defaultSeries.length === 1 ? "is" : "are"
        } selected by default; ${countLabel(
          unselectedCompatibleCount,
          "compatible series",
          "compatible series",
        )} can be added.`
      : "This scale group is selected by default."
  }${
    families.length > 1
      ? ` ${countLabel(families.length - 1, "other separately scaled group")} can be viewed.`
      : ""
  }`;

  return {
    categoryColumn: primaryView.categoryColumn,
    families,
    primaryFamily,
    primaryView,
    availableSeries,
    defaultSeries,
    optionalSeries: availableSeries.filter(
      (series) => !defaultSeries.some((candidate) => candidate.id === series.id),
    ),
    sourceRows: primaryView.sourceRows,
    visualRows: primaryView.visualRows,
    sourceRowCount: primaryView.sourceRowCount,
    visibleRowCount: primaryView.visibleRowCount,
    hiddenRowCount: primaryView.hiddenRowCount,
    aggregateRowCount: primaryView.aggregateRowCount,
    unusableRowCount: primaryView.unusableRowCount,
    truncatedRowCount: primaryView.truncatedRowCount,
    hiddenSeriesCount,
    chronological: primaryView.chronological,
    preserveSourceOrder: primaryView.preserveSourceOrder,
    rowSelection: primaryView.rowSelection,
    rowSummary: primaryView.rowSummary,
    selectionSummary,
    renderKind: primaryView.renderKind,
    zeroBaseline: primaryView.zeroBaseline,
  };
};

export const formatContextChartCell = (
  value: ContextChartCell | undefined,
  column?: ContextChartColumn,
): string => {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "Not available";
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);

  const columnLabel = normalizeLabel(column?.label ?? "");
  const identifierColumn =
    /^(?:#|id|identifier|position|rank|seed)$/.test(columnLabel) ||
    /(?:^| )(?:catalog(?:ue)? number|code|fips|identifier|isbn|phone|postal|serial number|zip)(?: |$)/.test(
      columnLabel,
    );
  const fourDigitCalendarValue =
    Number.isInteger(value) &&
    Math.abs(value) >= 1000 &&
    Math.abs(value) <= 9999 &&
    /(?:^| )(?:date|year)(?: |$)/.test(columnLabel);
  if (identifierColumn || fourDigitCalendarValue) return String(value);

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 20,
    useGrouping: true,
  });
};
