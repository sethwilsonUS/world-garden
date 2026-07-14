import { describe, expect, it } from "vitest";
import type { ContextChartBlock } from "./article-context-types";
import {
  formatContextChartCell,
  getContextChartPayloadKey,
  getOrdinalPositionPresentation,
  getRankedBarGeometry,
  getRankedChartPresentation,
  getStandardChartFamilyView,
  getStandardChartPresentation,
  shouldStandardChartUseZeroBaseline,
} from "./article-context-chart";

describe("chart payload readiness keys", () => {
  it("changes for interior plotted values and selected-series metadata", () => {
    const rows = [
      { region: "North", population: 10 },
      { region: "Central", population: 20 },
      { region: "South", population: 30 },
    ];
    const series = [{
      id: "population",
      label: "Population",
      type: "bar" as const,
      xColumn: "region",
      yColumn: "population",
      unit: "people",
    }];
    const original = getContextChartPayloadKey(rows, series);

    expect(getContextChartPayloadKey(
      rows.map((row, index) => index === 1 ? { ...row, population: 25 } : row),
      series,
    )).not.toBe(original);
    expect(getContextChartPayloadKey(rows, [
      { ...series[0], label: "Residents" },
    ])).not.toBe(original);
    expect(getContextChartPayloadKey(rows.map((row) => ({ ...row })), series))
      .toBe(original);
  });
});

const base = {
  id: "ranking",
  kind: "chart" as const,
  title: "Rankings",
  caption: "Ranking caption.",
  longDescription: "Ranking description.",
  section: { index: "1", title: "Rankings" },
  order: 1,
  sources: [],
  provenance: {
    articleUrl: "https://en.wikipedia.org/wiki/Example",
    articleRevisionUrl: "https://en.wikipedia.org/w/index.php?oldid=1",
    sourceHash: "hash",
    extractorVersion: "2.0.3",
    descriptionMethod: "deterministic" as const,
  },
};

describe("ranked chart presentation", () => {
  it("derives a bounded leaderboard from semantic ranking columns", () => {
    const block: ContextChartBlock = {
      ...base,
      chart: {
        columns: [
          { key: "position", label: "Position", dataType: "number" },
          { key: "team", label: "Team", dataType: "string" },
          { key: "points", label: "Points", dataType: "number" },
          { key: "result", label: "Final result", dataType: "string" },
        ],
        rows: Array.from({ length: 15 }, (_, index) => ({
          position: index + 1,
          team: `Team ${index + 1}`,
          points: 15 - index,
          result: "Published",
        })),
        series: [
          {
            id: "points",
            label: "Points",
            type: "bar",
            xColumn: "team",
            yColumn: "points",
          },
        ],
        sourceChartType: "wikitable",
      },
    };

    expect(getRankedChartPresentation(block)).toMatchObject({
      rankColumn: { key: "position" },
      entityColumn: { key: "team" },
      measureSeries: { yColumn: "points" },
      outcomeColumn: { key: "result" },
      hiddenRowCount: 7,
      visibleRows: expect.arrayContaining([
        expect.objectContaining({ team: "Team 1" }),
      ]),
    });
    expect(getRankedChartPresentation(block)?.visibleRows).toHaveLength(8);
  });

  it("does not reinterpret an ordinary category chart as a ranking", () => {
    const block: ContextChartBlock = {
      ...base,
      chart: {
        columns: [
          { key: "city", label: "City", dataType: "string" },
          { key: "capacity", label: "Capacity", dataType: "number" },
        ],
        rows: [
          { city: "A", capacity: 1 },
          { city: "B", capacity: 2 },
          { city: "C", capacity: 3 },
        ],
        series: [
          {
            id: "capacity",
            label: "Capacity",
            type: "bar",
            xColumn: "city",
            yColumn: "capacity",
          },
        ],
        sourceChartType: "wikitable",
      },
    };

    expect(getRankedChartPresentation(block)).toBeNull();
    expect(formatContextChartCell(null)).toBe("Not available");
    expect(formatContextChartCell(0)).toBe("0");
    expect(formatContextChartCell(8_232_000_000)).toBe("8,232,000,000");
    expect(formatContextChartCell(-1_234_567.89)).toBe("-1,234,567.89");
    expect(
      formatContextChartCell(2025, {
        key: "year",
        label: "Year",
        dataType: "number",
      }),
    ).toBe("2025");
    expect(
      formatContextChartCell(123_456, {
        key: "country-code",
        label: "Country code",
        dataType: "number",
      }),
    ).toBe("123456");
  });

  it("requires a usable rank for every leaderboard row", () => {
    const block: ContextChartBlock = {
      ...base,
      chart: {
        columns: [
          { key: "position", label: "Position", dataType: "number" },
          { key: "team", label: "Team", dataType: "string" },
          { key: "points", label: "Points", dataType: "number" },
        ],
        rows: [
          { position: 1, team: "Alpha", points: 9 },
          { position: null, team: "Beta", points: 6 },
          { position: 3, team: "Gamma", points: 3 },
          { position: 4, team: "Delta", points: 0 },
        ],
        series: [
          {
            id: "points",
            label: "Points",
            type: "bar",
            xColumn: "team",
            yColumn: "points",
          },
        ],
        sourceChartType: "wikitable",
      },
    };

    expect(getRankedChartPresentation(block)?.rows.map((row) => row.team)).toEqual([
      "Alpha",
      "Gamma",
      "Delta",
    ]);
  });

  it("recognizes the geographic and subject entity aliases used by extraction", () => {
    const block: ContextChartBlock = {
      ...base,
      chart: {
        columns: [
          { key: "rank", label: "Rank", dataType: "number" },
          { key: "region", label: "Region", dataType: "string" },
          { key: "population", label: "Population", dataType: "number" },
        ],
        rows: [
          { rank: 1, region: "North", population: 30 },
          { rank: 2, region: "South", population: 20 },
          { rank: 3, region: "West", population: 10 },
        ],
        series: [
          {
            id: "population",
            label: "Population",
            type: "bar",
            xColumn: "region",
            yColumn: "population",
          },
        ],
        sourceChartType: "wikitable",
      },
    };

    expect(getRankedChartPresentation(block)).toMatchObject({
      entityColumn: { key: "region" },
      visibleRows: expect.arrayContaining([
        expect.objectContaining({ region: "North" }),
      ]),
    });
  });

  it("positions negative, zero, and positive bars around a true zero baseline", () => {
    const values = [-4, 0, 8];
    const negative = getRankedBarGeometry(values, -4);
    const zero = getRankedBarGeometry(values, 0);
    const positive = getRankedBarGeometry(values, 8);
    expect(negative).toMatchObject({ startPercent: 0, direction: "negative" });
    expect(negative?.zeroPercent).toBeCloseTo(100 / 3);
    expect(negative?.widthPercent).toBeCloseTo(100 / 3);
    expect(zero).toMatchObject({ widthPercent: 0, direction: "zero" });
    expect(zero?.zeroPercent).toBeCloseTo(100 / 3);
    expect(zero?.startPercent).toBeCloseTo(100 / 3);
    expect(positive).toMatchObject({ direction: "positive" });
    expect(positive?.zeroPercent).toBeCloseTo(100 / 3);
    expect(positive?.startPercent).toBeCloseTo(100 / 3);
    expect(positive?.widthPercent).toBeCloseTo(200 / 3);
    expect(getRankedBarGeometry([5, 5], 5)).toMatchObject({
      zeroPercent: 0,
      startPercent: 0,
      widthPercent: 100,
    });
    expect(getRankedBarGeometry(values, null)).toBeNull();
  });
});

const standardBlock = (
  chart: ContextChartBlock["chart"],
): ContextChartBlock => ({
  ...base,
  id: "standard",
  title: "Demographic data",
  chart,
});

describe("standard chart presentation", () => {
  it("treats peak positions as ordinal results instead of bar magnitudes", () => {
    const block = standardBlock({
      columns: [
        { key: "chart", label: "Chart", dataType: "string" },
        { key: "peak", label: "Peak position", dataType: "number" },
      ],
      rows: [
        { chart: "Euro Digital Song Sales (Billboard)", peak: 1 },
        { chart: "Ireland (IRMA)", peak: 13 },
        { chart: "Scotland Singles (Official Charts)", peak: 2 },
        { chart: "UK Singles (Official Charts)", peak: 7 },
      ],
      series: [
        {
          id: "peak-position",
          label: "Peak position",
          type: "bar",
          xColumn: "chart",
          yColumn: "peak",
        },
      ],
      sourceChartType: "wikitable",
    });

    expect(getOrdinalPositionPresentation(block)).toMatchObject({
      categoryColumn: { key: "chart" },
      measureColumn: { key: "peak" },
      measureSeries: { id: "peak-position" },
      truncatedRowCount: 0,
      unusableRowCount: 0,
    });
    expect(
      getOrdinalPositionPresentation(block)?.visibleRows.map((row) => row.peak),
    ).toEqual([1, 13, 2, 7]);
  });

  it("keeps magnitude and non-integral position measures out of the ordinal view", () => {
    const capacity = standardBlock({
      columns: [
        { key: "venue", label: "Venue", dataType: "string" },
        { key: "capacity", label: "Capacity", dataType: "number" },
      ],
      rows: [
        { venue: "A", capacity: 80_000 },
        { venue: "B", capacity: 70_000 },
      ],
      series: [
        { id: "capacity", label: "Capacity", type: "bar", xColumn: "venue", yColumn: "capacity" },
      ],
      sourceChartType: "wikitable",
    });
    const decimalPosition = standardBlock({
      columns: [
        { key: "item", label: "Item", dataType: "string" },
        { key: "position", label: "Position", dataType: "number" },
      ],
      rows: [
        { item: "A", position: 1.5 },
        { item: "B", position: 2.5 },
      ],
      series: [
        { id: "position", label: "Position", type: "bar", xColumn: "item", yColumn: "position" },
      ],
      sourceChartType: "wikitable",
    });

    expect(getOrdinalPositionPresentation(capacity)).toBeNull();
    expect(getOrdinalPositionPresentation(decimalPosition)).toBeNull();
  });

  it("separates mixed units into compatible scale families", () => {
    const block = standardBlock({
      columns: [
        { key: "place", label: "Place", dataType: "string" },
        { key: "population", label: "Population", dataType: "number", unit: "people" },
        { key: "share", label: "Share", dataType: "number", unit: "%" },
        { key: "income", label: "Median income", dataType: "number", unit: "$" },
        { key: "density", label: "Density", dataType: "number", unit: "people per km²" },
      ],
      rows: [
        { place: "Alpha", population: 1000, share: 40, income: 52000, density: 80 },
        { place: "Beta", population: 800, share: 32, income: 61000, density: 60 },
        { place: "Gamma", population: 500, share: 20, income: 48000, density: 35 },
        { place: "Delta", population: 200, share: 8, income: 44000, density: 12 },
      ],
      series: [
        { id: "population", label: "Population", type: "bar", xColumn: "place", yColumn: "population" },
        { id: "share", label: "Share", type: "bar", xColumn: "place", yColumn: "share" },
        { id: "income", label: "Median income", type: "bar", xColumn: "place", yColumn: "income" },
        { id: "density", label: "Density", type: "bar", xColumn: "place", yColumn: "density" },
      ],
      sourceChartType: "wikitable",
    });

    const presentation = getStandardChartPresentation(block);
    expect(presentation?.families.map((family) => family.scaleKind)).toEqual([
      "count",
      "percent",
      "currency",
      "density",
    ]);
    expect(presentation?.defaultSeries.map((series) => series.id)).toEqual([
      "population",
    ]);
    expect(presentation?.optionalSeries.map((series) => series.id)).toEqual([
      "share",
      "income",
      "density",
    ]);
    expect(presentation?.primaryFamily.selectionSummary).toBe(
      "Population uses the counts (people) scale.",
    );
    expect(presentation?.selectionSummary).toContain(
      "3 other separately scaled groups can be viewed",
    );
  });

  it("keeps compatible same-unit series in one default family", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      year: 2000 + index,
      total: 30 + index / 10,
      male: 29 + index / 10,
      female: 31 + index / 10,
    }));
    const block = standardBlock({
      columns: [
        { key: "year", label: "Year", dataType: "number" },
        { key: "total", label: "Total", dataType: "number", unit: "years" },
        { key: "male", label: "Male", dataType: "number", unit: "years" },
        { key: "female", label: "Female", dataType: "number", unit: "years" },
      ],
      rows,
      series: [
        { id: "total", label: "Total", type: "line", xColumn: "year", yColumn: "total" },
        { id: "male", label: "Male", type: "line", xColumn: "year", yColumn: "male" },
        { id: "female", label: "Female", type: "line", xColumn: "year", yColumn: "female" },
      ],
      sourceChartType: "wikitable",
    });

    const presentation = getStandardChartPresentation(block);
    expect(presentation?.families).toHaveLength(1);
    expect(presentation?.defaultSeries.map((series) => series.id)).toEqual([
      "total",
      "male",
      "female",
    ]);
    expect(presentation?.primaryFamily.scaleKind).toBe("duration");
    expect(presentation?.chronological).toBe(true);
    expect(presentation?.visualRows).toEqual(rows);
  });

  it("recognizes percent and currency symbols when source units are missing", () => {
    const block = standardBlock({
      columns: [
        { key: "place", label: "Place", dataType: "string" },
        { key: "population", label: "Population", dataType: "number" },
        { key: "share", label: "% of world", dataType: "number" },
        { key: "income", label: "$ median income", dataType: "number" },
      ],
      rows: [
        { place: "Alpha", population: 100, share: 50, income: 60000 },
        { place: "Beta", population: 60, share: 30, income: 50000 },
        { place: "Gamma", population: 40, share: 20, income: 40000 },
      ],
      series: [
        { id: "population", label: "Population", type: "bar", xColumn: "place", yColumn: "population" },
        { id: "share", label: "% of world", type: "bar", xColumn: "place", yColumn: "share" },
        { id: "income", label: "$ median income", type: "bar", xColumn: "place", yColumn: "income" },
      ],
      sourceChartType: "wikitable",
    });

    expect(
      getStandardChartPresentation(block)?.families.map(
        (family) => family.scaleKind,
      ),
    ).toEqual(["count", "percent", "currency"]);
  });

  it("omits aggregate categories from the overview without changing exact rows", () => {
    const rows = [
      { place: "World", population: 8000 },
      { place: "All regions", population: 7600 },
      { place: "Total", population: 7400 },
      { place: "Alpha", population: 1000 },
      { place: "Beta", population: 800 },
      { place: "Gamma", population: 500 },
    ];
    const block = standardBlock({
      columns: [
        { key: "place", label: "Place", dataType: "string" },
        { key: "population", label: "Population", dataType: "number" },
      ],
      rows,
      series: [
        { id: "population", label: "Population", type: "bar", xColumn: "place", yColumn: "population" },
      ],
      sourceChartType: "wikitable",
    });

    const presentation = getStandardChartPresentation(block);
    expect(presentation?.sourceRows).toBe(rows);
    expect(presentation?.sourceRowCount).toBe(6);
    expect(presentation?.visualRows.map((row) => row.place)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ]);
    expect(presentation).toMatchObject({
      visibleRowCount: 3,
      hiddenRowCount: 3,
      aggregateRowCount: 3,
      truncatedRowCount: 0,
    });
    expect(presentation?.rowSummary).toContain(
      "3 aggregate rows kept in Exact chart data",
    );
  });

  it("turns a dense categorical table into a descending labeled top 12", () => {
    const rows = [
      { country: "World", population: 999999 },
      ...Array.from({ length: 240 }, (_, index) => ({
        country: `Country ${index + 1}`,
        population: index + 1,
      })),
    ];
    const block = standardBlock({
      columns: [
        { key: "country", label: "Country", dataType: "string" },
        { key: "population", label: "Population", dataType: "number" },
      ],
      rows,
      series: [
        { id: "population", label: "Population", type: "bar", xColumn: "country", yColumn: "population" },
      ],
      sourceChartType: "wikitable",
    });

    const presentation = getStandardChartPresentation(block);
    expect(presentation?.rowSelection).toBe("top-values");
    expect(presentation?.visualRows).toHaveLength(12);
    expect(presentation?.visualRows.map((row) => row.country)).toEqual(
      Array.from({ length: 12 }, (_, index) => `Country ${240 - index}`),
    );
    expect(presentation).toMatchObject({
      sourceRowCount: 241,
      visibleRowCount: 12,
      hiddenRowCount: 229,
      aggregateRowCount: 1,
      truncatedRowCount: 228,
    });
    expect(presentation?.rowSummary).toContain(
      "Showing the top 12 of 240 categories by Population",
    );
  });

  it("preserves meaningful source order when bounding age bands", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      age: `${index * 5}–${index * 5 + 4}`,
      population: index + 1,
    }));
    const block = standardBlock({
      columns: [
        { key: "age", label: "Age group", dataType: "string" },
        { key: "population", label: "Population", dataType: "number" },
      ],
      rows,
      series: [
        { id: "population", label: "Population", type: "bar", xColumn: "age", yColumn: "population" },
      ],
      sourceChartType: "wikitable",
    });

    const presentation = getStandardChartPresentation(block);
    expect(presentation?.rowSelection).toBe("source-order");
    expect(presentation?.visualRows.map((row) => row.age)).toEqual(
      rows.slice(0, 12).map((row) => row.age),
    );
    expect(presentation?.rowSummary).toContain("meaningful source order");
  });

  it("keeps a long chronological line complete and in source order", () => {
    const rows = Array.from({ length: 236 }, (_, index) => ({
      year: 1790 + index,
      population: 100 + index * 12,
    }));
    const block = standardBlock({
      columns: [
        { key: "year", label: "Year", dataType: "number" },
        { key: "population", label: "Population", dataType: "number", unit: "people" },
      ],
      rows,
      series: [
        { id: "population", label: "Population", type: "line", xColumn: "year", yColumn: "population" },
      ],
      sourceChartType: "wikitable",
    });

    const presentation = getStandardChartPresentation(block);
    expect(presentation).toMatchObject({
      chronological: true,
      preserveSourceOrder: true,
      rowSelection: "chronological",
      visibleRowCount: 236,
      hiddenRowCount: 0,
      truncatedRowCount: 0,
    });
    expect(presentation?.visualRows).toEqual(rows);
    expect(presentation?.rowSummary).toContain(
      "Showing all 236 chronological values in source order",
    );
  });

  it("recognizes BCE, CE, AD, and consecutive financial years", () => {
    const eraBlock = standardBlock({
      columns: [
        { key: "year", label: "Year", dataType: "string" },
        { key: "population", label: "Population", dataType: "number" },
      ],
      rows: [
        { year: "circa 500 BCE", population: 10 },
        { year: "100 BC", population: 20 },
        { year: "AD 1", population: 30 },
        { year: "100 CE", population: 40 },
      ],
      series: [
        { id: "population", label: "Population", type: "line", xColumn: "year", yColumn: "population" },
      ],
      sourceChartType: "wikitable",
    });
    const financialBlock = standardBlock({
      columns: [
        { key: "period", label: "Financial year", dataType: "string" },
        { key: "revenue", label: "Revenue", dataType: "number", unit: "$" },
      ],
      rows: [
        { period: "FY 2018–19", revenue: 10 },
        { period: "2019/20", revenue: 20 },
        { period: "2020-21", revenue: 30 },
        { period: "2021–2022", revenue: 40 },
      ],
      series: [
        { id: "revenue", label: "Revenue", type: "line", xColumn: "period", yColumn: "revenue" },
      ],
      sourceChartType: "wikitable",
    });

    expect(getStandardChartPresentation(eraBlock)).toMatchObject({
      chronological: true,
      renderKind: "line",
      visibleRowCount: 4,
    });
    expect(getStandardChartPresentation(financialBlock)).toMatchObject({
      chronological: true,
      renderKind: "line",
      visibleRowCount: 4,
    });
  });

  it("recognizes comma-formatted era years while preserving chronology", () => {
    const rows = [
      { year: "c. 10,000 BC", population: 10 },
      { year: "2,500 BCE", population: 20 },
      { year: "AD 1", population: 30 },
      { year: "2,000 CE", population: 40 },
    ];
    const block = standardBlock({
      columns: [
        { key: "year", label: "Year", dataType: "string" },
        { key: "population", label: "Population", dataType: "number" },
      ],
      rows,
      series: [
        { id: "population", label: "Population", type: "line", xColumn: "year", yColumn: "population" },
      ],
      sourceChartType: "wikitable",
    });

    expect(getStandardChartPresentation(block)).toMatchObject({
      chronological: true,
      renderKind: "line",
      visibleRowCount: 4,
      visualRows: rows,
    });

    expect(
      getStandardChartPresentation(
        standardBlock({
          ...block.chart,
          rows: [rows[0], rows[2], rows[1], rows[3]],
        }),
      ),
    ).toMatchObject({
      chronological: false,
      renderKind: "bar",
    });
  });

  it("converts a short invalid source line to bars without dropping rows", () => {
    const rows = [
      { year: 2020, population: 10 },
      { year: 2018, population: 20 },
      { year: 2021, population: 30 },
      { year: 2019, population: 40 },
    ];
    const block = standardBlock({
      columns: [
        { key: "year", label: "Year", dataType: "number" },
        { key: "population", label: "Population", dataType: "number" },
      ],
      rows,
      series: [
        { id: "population", label: "Population", type: "line", xColumn: "year", yColumn: "population" },
      ],
      sourceChartType: "wikitable",
    });

    expect(getStandardChartPresentation(block)).toMatchObject({
      chronological: false,
      renderKind: "bar",
      rowSelection: "all",
      visibleRowCount: 4,
      truncatedRowCount: 0,
      visualRows: rows,
      zeroBaseline: true,
    });
  });

  it("recommends exact data instead of truncating an invalid long line", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      year: index % 2 === 0 ? 2000 + index / 2 : 2020 - (index + 1) / 2,
      population: index + 1,
    }));
    const block = standardBlock({
      columns: [
        { key: "year", label: "Year", dataType: "number" },
        { key: "population", label: "Population", dataType: "number" },
      ],
      rows,
      series: [
        { id: "population", label: "Population", type: "line", xColumn: "year", yColumn: "population" },
      ],
      sourceChartType: "wikitable",
    });

    expect(getStandardChartPresentation(block)).toMatchObject({
      chronological: false,
      renderKind: "exact-only",
      rowSelection: "exact-only",
      visibleRowCount: 0,
      hiddenRowCount: 20,
      truncatedRowCount: 0,
      visualRows: [],
    });
  });

  it("uses exact data for repeated line categories even when the series is short", () => {
    const block = standardBlock({
      columns: [
        { key: "year", label: "Year", dataType: "number" },
        { key: "population", label: "Population", dataType: "number" },
      ],
      rows: [
        { year: 2020, population: 10 },
        { year: 2020, population: 20 },
        { year: 2021, population: 30 },
        { year: 2021, population: 40 },
      ],
      series: [
        { id: "population", label: "Population", type: "line", xColumn: "year", yColumn: "population" },
      ],
      sourceChartType: "wikitable",
    });

    expect(getStandardChartPresentation(block)).toMatchObject({
      renderKind: "exact-only",
      visibleRowCount: 0,
      truncatedRowCount: 0,
    });
  });

  it("keeps named All and Total entities while removing conservative aggregates", () => {
    const rows = [
      { name: "World", audience: 1000 },
      { name: "All ages", audience: 900 },
      { name: "Total population", audience: 800 },
      { name: "All Nippon Airways", audience: 700 },
      { name: "All Blacks", audience: 600 },
      { name: "Total Recall", audience: 500 },
    ];
    const block = standardBlock({
      columns: [
        { key: "name", label: "Name", dataType: "string" },
        { key: "audience", label: "Audience", dataType: "number" },
      ],
      rows,
      series: [
        { id: "audience", label: "Audience", type: "bar", xColumn: "name", yColumn: "audience" },
      ],
      sourceChartType: "wikitable",
    });

    const presentation = getStandardChartPresentation(block);
    expect(presentation?.aggregateRowCount).toBe(3);
    expect(presentation?.visualRows.map((row) => row.name)).toEqual([
      "All Nippon Airways",
      "All Blacks",
      "Total Recall",
    ]);
  });

  it("separates bar, line, and individual pie mark families", () => {
    const block = standardBlock({
      columns: [
        { key: "year", label: "Year", dataType: "number" },
        { key: "bars", label: "Bars", dataType: "number", unit: "people" },
        { key: "line", label: "Line", dataType: "number", unit: "people" },
        { key: "area", label: "Area", dataType: "number", unit: "people" },
        { key: "pie-a", label: "Pie A", dataType: "number", unit: "people" },
        { key: "pie-b", label: "Pie B", dataType: "number", unit: "people" },
      ],
      rows: [2020, 2021, 2022].map((year, index) => ({
        year,
        bars: index + 1,
        line: index + 2,
        area: index + 3,
        "pie-a": index + 4,
        "pie-b": index + 5,
      })),
      series: [
        { id: "bars", label: "Bars", type: "bar", xColumn: "year", yColumn: "bars" },
        { id: "line", label: "Line", type: "line", xColumn: "year", yColumn: "line" },
        { id: "area", label: "Area", type: "area", xColumn: "year", yColumn: "area" },
        { id: "pie-a", label: "Pie A", type: "pie", xColumn: "year", yColumn: "pie-a" },
        { id: "pie-b", label: "Pie B", type: "pie", xColumn: "year", yColumn: "pie-b" },
      ],
      sourceChartType: "chart-extension",
    });

    const presentation = getStandardChartPresentation(block);
    expect(presentation?.families.map((family) => family.markFamily)).toEqual([
      "bar",
      "line",
      "pie",
      "pie",
    ]);
    expect(presentation?.families[1].series.map((series) => series.id)).toEqual([
      "line",
      "area",
    ]);
    expect(presentation?.families[2].series).toHaveLength(1);
    expect(presentation?.families[3].series).toHaveLength(1);
  });

  it("gives unrelated unknown unitless metrics separate scales", () => {
    const block = standardBlock({
      columns: [
        { key: "place", label: "Place", dataType: "string" },
        { key: "elevation", label: "Elevation", dataType: "number" },
        { key: "latitude", label: "Latitude", dataType: "number" },
        { key: "longitude", label: "Longitude", dataType: "number" },
      ],
      rows: [
        { place: "A", elevation: 1, latitude: 10, longitude: -70 },
        { place: "B", elevation: 2, latitude: 20, longitude: -80 },
        { place: "C", elevation: 3, latitude: 30, longitude: -90 },
      ],
      series: [
        { id: "elevation", label: "Elevation", type: "bar", xColumn: "place", yColumn: "elevation" },
        { id: "latitude", label: "Latitude", type: "bar", xColumn: "place", yColumn: "latitude" },
        { id: "longitude", label: "Longitude", type: "bar", xColumn: "place", yColumn: "longitude" },
      ],
      sourceChartType: "wikitable",
    });

    const presentation = getStandardChartPresentation(block);
    expect(presentation?.families).toHaveLength(3);
    expect(presentation?.families.map((family) => family.series[0].id)).toEqual([
      "elevation",
      "latitude",
      "longitude",
    ]);
  });

  it("recomputes dense rows from the selected metric and excludes its blanks", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      place: `Place ${index + 1}`,
      population: 1000 - index,
      households: index === 19 ? null : index + 1,
    }));
    const block = standardBlock({
      columns: [
        { key: "place", label: "Place", dataType: "string" },
        { key: "population", label: "Population", dataType: "number", unit: "people" },
        { key: "households", label: "Households", dataType: "number", unit: "people" },
      ],
      rows,
      series: [
        { id: "population", label: "Population", type: "bar", xColumn: "place", yColumn: "population" },
        { id: "households", label: "Households", type: "bar", xColumn: "place", yColumn: "households" },
      ],
      sourceChartType: "wikitable",
    });
    const presentation = getStandardChartPresentation(block);
    const family = presentation?.primaryFamily;
    const households = family?.series.find((series) => series.id === "households");
    expect(family).toBeDefined();
    expect(households).toBeDefined();
    const view = getStandardChartFamilyView(
      block,
      family!,
      [households!],
    );

    expect(presentation?.visualRows[0].place).toBe("Place 1");
    expect(view).toMatchObject({
      anchorSeries: { id: "households" },
      eligibleRowCount: 19,
      visibleRowCount: 12,
      unusableRowCount: 1,
      rowSelection: "top-values",
    });
    expect(view?.visualRows.map((row) => row.place)).toEqual(
      Array.from({ length: 12 }, (_, index) => `Place ${19 - index}`),
    );
    expect(view?.rowSummary).toContain(
      "Showing the top 12 of 19 categories by Households",
    );
  });

  it("bounds optional series while keeping the primary family coherent", () => {
    const columns: ContextChartBlock["chart"]["columns"] = [
      { key: "place", label: "Place", dataType: "string" },
      ...Array.from({ length: 8 }, (_, index) => ({
        key: `value-${index + 1}`,
        label: `Value ${index + 1}`,
        dataType: "number" as const,
        unit: index < 5 ? "people" : index === 5 ? "%" : `$ unit ${index}`,
      })),
    ];
    const series: ContextChartBlock["chart"]["series"] = columns.slice(1).map(
      (column, index) => ({
        id: `value-${index + 1}`,
        label: column.label,
        type: "bar" as const,
        xColumn: "place",
        yColumn: column.key,
      }),
    );
    const block = standardBlock({
      columns,
      rows: ["Alpha", "Beta", "Gamma"].map((place, rowIndex) => ({
        place,
        ...Object.fromEntries(
          series.map((candidate, seriesIndex) => [
            candidate.yColumn,
            rowIndex + seriesIndex + 1,
          ]),
        ),
      })),
      series,
      sourceChartType: "wikitable",
    });

    const presentation = getStandardChartPresentation(block);
    expect(presentation?.availableSeries).toHaveLength(6);
    expect(presentation?.defaultSeries).toHaveLength(4);
    expect(presentation?.hiddenSeriesCount).toBe(2);
    expect(presentation?.primaryFamily.hiddenSeriesCount).toBe(0);
  });

  it("requires zero for absolute and signed bars but not positive-only lines", () => {
    const signedRows = [
      { category: "A", change: -4 },
      { category: "B", change: 0 },
      { category: "C", change: 8 },
    ];
    const barSeries = [
      { id: "change", label: "Change", type: "bar" as const, xColumn: "category", yColumn: "change" },
    ];
    const lineSeries = [
      { id: "change", label: "Change", type: "line" as const, xColumn: "category", yColumn: "change" },
    ];
    expect(shouldStandardChartUseZeroBaseline(barSeries, signedRows)).toBe(true);
    expect(
      shouldStandardChartUseZeroBaseline(barSeries, signedRows.map((row) => ({
        ...row,
        change: Math.abs(row.change) + 1,
      }))),
    ).toBe(true);
    expect(
      shouldStandardChartUseZeroBaseline(lineSeries, signedRows.slice(1)),
    ).toBe(false);
    expect(shouldStandardChartUseZeroBaseline(lineSeries, signedRows)).toBe(true);

    const block = standardBlock({
      columns: [
        { key: "category", label: "Category", dataType: "string" },
        { key: "change", label: "Change", dataType: "number" },
      ],
      rows: signedRows,
      series: barSeries,
      sourceChartType: "wikitable",
    });
    expect(getStandardChartPresentation(block)?.zeroBaseline).toBe(true);
    expect(
      shouldStandardChartUseZeroBaseline(
        [{ ...lineSeries[0], type: "area" }],
        signedRows.map((row) => ({ ...row, change: Math.abs(row.change) + 1 })),
      ),
    ).toBe(true);
  });
});
