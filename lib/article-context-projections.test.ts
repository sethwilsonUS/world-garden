import { describe, expect, it } from "vitest";
import { extractChartFromTable } from "./article-context-charts";
import { normalizeGeoJson } from "./article-context-geojson";
import type { ArticleContextTable } from "./article-context-table";
import {
  extractTimelineFromTable,
  parseContextDateRange,
} from "./article-context-timelines";

const table = (
  headers: string[],
  rows: string[][],
  context = "",
): ArticleContextTable => ({
  caption: "",
  context,
  headers,
  rows,
  position: 1,
  section: { index: "1", title: "Data" },
});

describe("semantic article-context projections", () => {
  it("recognizes complete quantitative tables after semantic normalization", () => {
    expect(
      extractChartFromTable(
        table(
          ["Year", "Population (millions)"],
          [
            ["2020", "10"],
            ["2021", "12"],
            ["2022", "15"],
          ],
        ),
      ),
    ).toMatchObject({
      sourceChartType: "wikitable",
      columns: [
        { label: "Year" },
        { label: "Population (millions)", unit: "millions" },
      ],
      series: [{ type: "bar", unit: "millions" }],
    });
  });

  it("declines categorical and partially numeric tables", () => {
    expect(
      extractChartFromTable(
        table(
          ["Place", "Description"],
          [
            ["A", "North"],
            ["B", "South"],
            ["C", "East"],
          ],
        ),
      ),
    ).toBeNull();
    expect(
      extractChartFromTable(
        table(
          ["Year", "Population"],
          [
            ["2020", "10"],
            ["2021", "approximately twelve"],
            ["2022", "15"],
          ],
        ),
      ),
    ).toBeNull();
  });

  it("keeps explicit tied ranking rows without admitting totals", () => {
    const chart = extractChartFromTable(
      table(
        ["Rank", "NOC", "Gold", "Silver"],
        [
          ["1", "Gondor", "12", "8"],
          ["=1", "Rohan", "11", "9"],
          ["4", "The Shire", "5", "4"],
          ["5th", "Dale", "4", "3"],
          ["", "Total (4 NOCs)", "38", "28"],
        ],
      ),
    );

    expect(chart?.rows).toEqual([
      { rank: 1, noc: "Gondor", gold: 12, silver: 8 },
      { rank: 1, noc: "Rohan", gold: 11, silver: 9 },
      { rank: 4, noc: "The Shire", gold: 5, silver: 4 },
      { rank: 5, noc: "Dale", gold: 4, silver: 3 },
    ]);
  });

  it("retains unranked rows without inheriting or fabricating a rank", () => {
    const rows = [
      ["1", "Gondor", "12", "8"],
      ["2", "Rohan", "11", "9"],
      ["3", "The Shire", "5", "4"],
      ["4", "Dale", "4", "3"],
    ];

    const olympicChart = extractChartFromTable(
      table(
        ["Rank", "NOC", "Gold", "Silver"],
        [...rows, ["–", "Individual Neutral Athletes", "1", "3"]],
      ),
    );
    const outcomeChart = extractChartFromTable(
      table(
        ["Rank", "NOC", "Gold", "Silver"],
        [...rows, ["DNF", "Mordor", "3", "2"]],
      ),
    );

    expect(olympicChart?.rows.at(-1)).toMatchObject({
      rank: null,
      noc: "Individual Neutral Athletes",
      gold: 1,
      silver: 3,
    });
    expect(outcomeChart?.rows.at(-1)).toMatchObject({
      rank: "DNF",
      noc: "Mordor",
      gold: 3,
      silver: 2,
    });
  });

  it("declines an explicitly ranked aggregate-looking entity instead of silently omitting it", () => {
    expect(
      extractChartFromTable(
        table(
          ["Rank", "Song", "Sales"],
          [
            ["1", "The Archer", "12"],
            ["2", "Overall", "10"],
            ["3", "The Prophecy", "8"],
          ],
        ),
      ),
    ).toBeNull();
  });

  it("requires an explicit event column before projecting a timeline", () => {
    expect(
      extractTimelineFromTable(
        table(
          ["Date", "Event"],
          [
            ["2020", "Founded"],
            ["2021", "Expanded"],
            ["2022", "Renamed"],
          ],
        ),
      ),
    ).toMatchObject([
      { label: "Founded", start: { iso: "2020" } },
      { label: "Expanded", start: { iso: "2021" } },
      { label: "Renamed", start: { iso: "2022" } },
    ]);
    expect(
      extractTimelineFromTable(
        table(
          ["Year", "Population"],
          [
            ["2020", "10"],
            ["2021", "12"],
            ["2022", "15"],
          ],
        ),
      ),
    ).toBeNull();
  });

  it("parses valid historical ranges while rejecting impossible dates", () => {
    expect(parseContextDateRange("218 to 201 BC")).toMatchObject({
      start: { sortKey: -2180000 },
      end: { sortKey: -2010000 },
    });
    expect(parseContextDateRange("2024-02-29")).not.toBeNull();
    expect(parseContextDateRange("2023-02-29")).toBeNull();
    expect(parseContextDateRange("31 April 2024")).toBeNull();
  });

  it("preserves every supported GeoJSON geometry and antimeridian data", () => {
    const normalized = normalizeGeoJson(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Places" },
            geometry: {
              type: "MultiPoint",
              coordinates: [
                [179, 10],
                [-179, 11],
              ],
            },
          },
          {
            type: "Feature",
            properties: { name: "Routes" },
            geometry: {
              type: "GeometryCollection",
              geometries: [
                {
                  type: "LineString",
                  coordinates: [
                    [170, 10],
                    [-170, 12],
                  ],
                },
                {
                  type: "Polygon",
                  coordinates: [
                    [
                      [170, 9],
                      [171, 9],
                      [171, 10],
                      [170, 9],
                    ],
                  ],
                },
              ],
            },
          },
        ],
      },
      "Example",
    );

    expect(normalized).toMatchObject({
      coordinateCount: 8,
      features: [
        { name: "Places", geometry: { type: "MultiPoint" } },
        { name: "Routes", geometry: { type: "GeometryCollection" } },
      ],
    });
    expect(normalized?.places).toHaveLength(2);
    expect(normalized?.routes).toHaveLength(1);
    expect(normalized?.areas).toHaveLength(1);
  });

  it("assigns collision-free IDs across nested and sibling geometries", () => {
    const normalized = normalizeGeoJson(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: "Cluster" },
            geometry: {
              type: "MultiPoint",
              coordinates: [
                [0, 0],
                [1, 1],
              ],
            },
          },
          {
            type: "Feature",
            properties: { name: "Cluster 2" },
            geometry: { type: "Point", coordinates: [1, 1] },
          },
        ],
      },
      "Example",
    );

    expect(normalized?.places).toHaveLength(3);
    expect(new Set(normalized?.places.map((place) => place.id)).size).toBe(3);
  });

  it("rejects malformed geometry atomically", () => {
    expect(
      normalizeGeoJson(
        {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [10, 20] },
            },
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [500, 20] },
            },
          ],
        },
        "Example",
      ),
    ).toBeNull();
    expect(
      normalizeGeoJson(
        {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ],
          ],
        },
        "Example",
      ),
    ).toBeNull();
  });
});
