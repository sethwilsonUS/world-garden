import { describe, expect, it } from "vitest";
import { extractChartFromTable } from "./article-context-charts";
import type { ArticleContextTable } from "./article-context-table";

const fifaTable = (
  section: Pick<ArticleContextTable["section"], "index" | "title">,
  headers: string[],
  rows: string[][],
  context: string,
  headerPaths = headers.map((header) => [header]),
): ArticleContextTable => ({
  caption: "",
  context,
  headers,
  headerPaths,
  rows,
  position: 1,
  section,
});

// Golden projection of the Prize money table parsed from 2022 FIFA World Cup,
// revision 1365646471. The source table remains available for exact-data and
// narration consumers even when it is not safe to promote to a visual chart.
const prizeMoney = fifaTable(
  { index: "2", title: "Prize money" },
  ["Place", "Teams", "Per team", "Total"],
  [
    ["Champions", "1", "$42", "$42"],
    ["Runner-up", "1", "$30", "$30"],
    ["Third place", "1", "$27", "$27"],
    ["Fourth place", "1", "$25", "$25"],
    ["5th–8th place (quarter-finals)", "4", "$17", "$68"],
    ["9th–16th place (round of 16)", "8", "$13", "$104"],
    ["17th–32nd place (group stage)", "16", "$9", "$144"],
  ],
  "In April 2022, FIFA announced the prizes for all participating nations. Each qualified team received $1.5 million before the competition to cover preparation costs with each team receiving at least $9 million in prize money. This edition's total prize pool was $440 million, $40 million greater than the prize pool of the previous tournament.",
  [
    ["Place"],
    ["Teams"],
    ["Amount (in millions)", "Per team"],
    ["Amount (in millions)", "Total"],
  ],
);

// Golden compact projection after the document reader removes MediaWiki's
// non-content navbar controls from the source Team header.
const groupA = fifaTable(
  { index: "19", title: "Group A" },
  [
    "Pos",
    "Team",
    "Pld",
    "W",
    "D",
    "L",
    "GF",
    "GA",
    "GD",
    "Pts",
    "Qualification",
  ],
  [
    [
      "1",
      "Netherlands",
      "3",
      "2",
      "1",
      "0",
      "5",
      "1",
      "+4",
      "7",
      "Advanced to knockout stage",
    ],
    [
      "2",
      "Senegal",
      "3",
      "2",
      "0",
      "1",
      "5",
      "4",
      "+1",
      "6",
      "Advanced to knockout stage",
    ],
    ["3", "Ecuador", "3", "1", "1", "1", "4", "3", "+1", "4", ""],
    ["4", "Qatar (H)", "3", "0", "0", "3", "1", "7", "− 6", "0", ""],
  ],
  "The first match of the tournament was held between Qatar and Ecuador in Group A.",
);

describe("2022 FIFA World Cup chart promotion regressions", () => {
  it("keeps prize money as exact source data without promoting incompatible measures", () => {
    const sourceRows = structuredClone(prizeMoney.rows);
    const chart = extractChartFromTable(prizeMoney);

    expect(prizeMoney.rows).toEqual(sourceRows);
    expect(chart).toBeNull();
  });

  it("identifies Team and Points instead of an ordinal x-axis for Group A", () => {
    const chart = extractChartFromTable(groupA);
    expect(chart).not.toBeNull();
    if (!chart) {
      return;
    }

    const categoryKeys = [
      ...new Set(chart.series.map((series) => series.xColumn)),
    ];
    const categoryLabels = categoryKeys.map(
      (key) => chart.columns.find((column) => column.key === key)?.label,
    );
    const categories =
      categoryKeys.length === 1
        ? chart.rows.map((row) => row[categoryKeys[0]])
        : [];

    expect({
      categoryLabels,
      categories,
      primarySeries: chart.series[0]?.label,
    }).toEqual({
      categoryLabels: ["Team"],
      categories: ["Netherlands", "Senegal", "Ecuador", "Qatar (H)"],
      primarySeries: "Pts",
    });
  });

  it("fails closed instead of using positions when the ranking entity is unresolved", () => {
    const unresolved = {
      ...groupA,
      headers: groupA.headers.map((header) =>
        header === "Team" ? "Team v t e" : header,
      ),
      headerPaths: groupA.headerPaths.map((path) =>
        path[0] === "Team" ? ["Team v t e"] : path,
      ),
    };

    expect(extractChartFromTable(unresolved)).toBeNull();
  });

  it("does not mistake a scientific Position measure for ranking metadata", () => {
    const motion = fifaTable(
      { index: "1", title: "Motion" },
      ["Time", "Position", "Velocity"],
      [
        ["0", "1", "4"],
        ["1", "5", "6"],
        ["2", "11", "8"],
      ],
      "Measurements from a moving body.",
    );

    expect(extractChartFromTable(motion)).not.toBeNull();
  });
});
