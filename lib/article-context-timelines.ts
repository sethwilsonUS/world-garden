import {
  type ArticleContextRequest,
  type ContextDateValue,
  type ContextSection,
  type ContextTimelineBlock,
  type ContextTimelineEvent,
} from "./article-context-types";
import {
  buildBaseBlock,
  cleanWikitext,
  findWikitextSection,
  sanitizeContextText,
  sha256,
  uniqueId,
  type BlockCandidate,
  type MediaWikiParsedSource,
} from "./article-context-foundations";

const MAX_TIMELINE_EVENTS = 250;

type TimelineTable = {
  headers: string[];
  rows: string[][];
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
  if (
    numericDate &&
    options.numericFormat &&
    options.numericFormat !== "year"
  ) {
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

const timelineFinalDate = (events: ContextTimelineEvent[]): ContextDateValue =>
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
  const omitted =
    events.length > 12
      ? ` The remaining ${events.length - 12} events are available in the ordered event list.`
      : "";
  return `The chronology contains ${events.length} events from ${first.start.display} through ${
    finalDate.display
  }. ${examples}.${omitted}`;
};

export const createTimelineCandidate = ({
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
  if (events.length < 3 || events.length > MAX_TIMELINE_EVENTS) return null;
  const subject =
    section.index === "__summary__" ? request.title : section.title;
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
): ContextDateValue | null =>
  parseSingleDate(value.trim(), { numericFormat: format });

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

export const extractEasyTimelineCandidates = ({
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
      if (events.length > MAX_TIMELINE_EVENTS) break;
      const barMatch = line.match(/^\s*(?:bar|barset)\s*:\s*([^\s]+)/i);
      if (barMatch) currentBar = barMatch[1];
      const extent = line.match(
        /\bfrom\s*:\s*([^\s]+)\s+till\s*:\s*([^\s]+)([\s\S]*)$/i,
      );
      if (!extent || /^(month|months|axis|year|years)$/i.test(currentBar))
        continue;
      const trailing = extent[3];
      const textMatch = trailing.match(/\btext\s*:\s*(?:"([^"]+)"|(.+?))\s*$/i);
      if (!textMatch) continue;
      const label = cleanWikitext(textMatch[1] ?? textMatch[2] ?? "", 300);
      if (
        !label ||
        /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i.test(
          label,
        )
      ) {
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

export const extractTimelineFromTable = (
  table: TimelineTable,
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
