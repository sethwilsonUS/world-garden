import { describe, expect, it, vi } from "vitest";
import { extractArticleContextFromDocument } from "../article-context-document";
import { loadMediaWikiDocument, type MediaWikiTableBlock } from "./index";

const request = {
  wikiPageId: "17742072",
  title: "2022 FIFA World Cup",
  revisionId: "1365646471",
  language: "en" as const,
};

describe("MediaWiki navigation chrome", () => {
  it("excludes navbar controls from semantic table headers and chart axes", async () => {
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      '<section data-mw-section-id="19"><h2 id="Group_A">Group A</h2>',
      '<table><thead><tr><th scope="col">Pos</th><th scope="col">',
      'Team <div class="navbar plainlinks hlist navbar-mini">',
      '<ul><li><abbr title="View">v</abbr></li>',
      '<li><abbr title="Talk">t</abbr></li>',
      '<li><abbr title="Edit">e</abbr></li></ul></div>',
      '<span class="navigation-not-searchable">non-content control</span></th>',
      '<th scope="col">Pld</th><th scope="col">W</th>',
      '<th scope="col">D</th><th scope="col">L</th>',
      '<th scope="col">GF</th><th scope="col">GA</th>',
      '<th scope="col">GD</th><th scope="col">Pts</th></tr></thead><tbody>',
      '<tr><td>1</td><th scope="row">Netherlands</th><td>3</td><td>2</td><td>1</td><td>0</td><td>5</td><td>1</td><td>+4</td><td>7</td></tr>',
      '<tr><td>2</td><th scope="row">Senegal</th><td>3</td><td>2</td><td>0</td><td>1</td><td>5</td><td>4</td><td>+1</td><td>6</td></tr>',
      '<tr><td>3</td><th scope="row">Ecuador</th><td>3</td><td>1</td><td>1</td><td>1</td><td>4</td><td>3</td><td>+1</td><td>4</td></tr>',
      '<tr><td>4</td><th scope="row">Qatar (H)</th><td>3</td><td>0</td><td>0</td><td>3</td><td>1</td><td>7</td><td>−6</td><td>0</td></tr>',
      "</tbody></table></section></section>",
    ].join("");
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            parse: {
              pageid: Number(request.wikiPageId),
              title: request.title,
              revid: Number(request.revisionId),
              tocdata: {
                sections: [
                  {
                    index: "19",
                    line: "Group A",
                    anchor: "Group_A",
                    level: 1,
                  },
                ],
              },
              text: html,
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );

    const document = await loadMediaWikiDocument(request, { fetchImpl });
    const table = document.sections[1]?.blocks.find(
      (block): block is MediaWikiTableBlock => block.kind === "table",
    );

    expect(table?.table.cells[1]).toMatchObject({
      kind: "header",
      text: "Team",
    });
    expect(document.sections[1]?.fallback.text).not.toContain("v t e");

    const chart = extractArticleContextFromDocument(document).blocks.find(
      (block) => block.kind === "chart",
    );
    expect(chart?.kind).toBe("chart");
    if (!chart || chart.kind !== "chart")
      throw new Error("chart not projected");
    expect(chart.chart.columns).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Team" })]),
    );
    expect(chart.chart.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ team: "Netherlands" }),
      ]),
    );
    expect(chart.chart.series[0]).toMatchObject({
      label: "Pts",
      xColumn: "team",
    });
  });

  it("keeps Group A through Group H after earlier valid visuals", async () => {
    const sectionTitles = [
      "Tournament overview",
      "Host venues",
      "Group A",
      "Group B",
      "Group C",
      "Group D",
      "Group E",
      "Group F",
      "Group G",
      "Group H",
      "Tournament ranking",
    ];
    const standingsTable = (group: string) =>
      [
        '<table class="wikitable"><thead><tr>',
        '<th scope="col">Pos</th><th scope="col">Team</th>',
        '<th scope="col">Pld</th><th scope="col">W</th>',
        '<th scope="col">D</th><th scope="col">L</th>',
        '<th scope="col">GF</th><th scope="col">GA</th>',
        '<th scope="col">GD</th><th scope="col">Pts</th>',
        "</tr></thead><tbody>",
        `<tr><td>1</td><th scope="row">${group} North</th><td>3</td><td>2</td><td>1</td><td>0</td><td>5</td><td>1</td><td>+4</td><td>7</td></tr>`,
        `<tr><td>2</td><th scope="row">${group} South</th><td>3</td><td>2</td><td>0</td><td>1</td><td>4</td><td>2</td><td>+2</td><td>6</td></tr>`,
        `<tr><td>3</td><th scope="row">${group} East</th><td>3</td><td>1</td><td>0</td><td>2</td><td>2</td><td>4</td><td>−2</td><td>3</td></tr>`,
        `<tr><td>4</td><th scope="row">${group} West</th><td>3</td><td>0</td><td>1</td><td>2</td><td>1</td><td>5</td><td>−4</td><td>1</td></tr>`,
        "</tbody></table>",
      ].join("");
    const html = [
      '<section data-mw-section-id="0"><p>Lead.</p>',
      ...sectionTitles.map(
        (title, index) =>
          `<section data-mw-section-id="${index + 1}"><h2>${title}</h2>${standingsTable(title)}</section>`,
      ),
      "</section>",
    ].join("");
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            parse: {
              pageid: Number(request.wikiPageId),
              title: request.title,
              revid: Number(request.revisionId),
              tocdata: {
                sections: sectionTitles.map((title, index) => ({
                  index: String(index + 1),
                  line: title,
                  anchor: title.replaceAll(" ", "_"),
                  level: 1,
                })),
              },
              text: html,
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );

    const document = await loadMediaWikiDocument(request, { fetchImpl });
    const blocks = extractArticleContextFromDocument(document).blocks;

    expect(blocks.map((block) => block.section.title)).toEqual(sectionTitles);
    expect(blocks.map((block) => block.title)).toEqual(
      sectionTitles.map((title) => `${title} data`),
    );
  });
});
