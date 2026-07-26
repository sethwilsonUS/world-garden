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
