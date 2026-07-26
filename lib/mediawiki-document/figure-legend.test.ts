import { describe, expect, it, vi } from "vitest";
import {
  loadMediaWikiDocument,
  type MediaWikiFigureBlock,
  type MediaWikiRevisionRequest,
} from "./index";

const request: MediaWikiRevisionRequest = {
  wikiPageId: "76850406",
  title: "2024 Summer Olympics medal table",
  revisionId: "1341989215",
  language: "en",
};

const loadFigure = async (caption: string): Promise<MediaWikiFigureBlock> => {
  const html = [
    '<section data-mw-section-id="0">',
    '<figure typeof="mw:File/Thumb">',
    '<img src="//upload.wikimedia.org/medal-map.svg" alt="Medal map" width="852" height="376">',
    `<figcaption>${caption}</figcaption>`,
    "</figure></section>",
  ].join("");
  const document = await loadMediaWikiDocument(request, {
    fetchImpl: vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            parse: {
              pageid: Number(request.wikiPageId),
              title: request.title,
              revid: Number(request.revisionId),
              tocdata: { sections: [] },
              text: html,
            },
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  });
  const figure = document.sections[0]?.blocks.find(
    (block): block is MediaWikiFigureBlock => block.kind === "figure",
  );
  if (!figure) throw new Error("Expected a figure block");
  return figure;
};

const olympicsCaption = [
  "World map showing the medal achievements of each country during the 2024 Summer Olympics.",
  "<br><b>Legend:</b><br>",
  '<style typeof="mw:Extension/templatestyles">.legend-color{display:inline-block}</style>',
  '<span class="legend nowrap"><span class="legend-color mw-no-invert" style="forced-color-adjust: none; background-color:#FFD700; color:black;"><span typeof="mw:Entity">&nbsp;</span></span><span typeof="mw:Entity">&nbsp;</span></span> represents countries that won at least one gold medal.<br>',
  '<span class="legend nowrap"><span class="legend-color mw-no-invert" style="forced-color-adjust: none; background-color:#C0C0C0; color:black;"><span typeof="mw:Entity">&nbsp;</span></span><span typeof="mw:Entity">&nbsp;</span></span> represents countries that won at least one silver medal but no gold medals.<br>',
  '<span class="legend nowrap"><span class="legend-color mw-no-invert" style="forced-color-adjust: none; background-color:#CC9966; color:black;"><span typeof="mw:Entity">&nbsp;</span></span><span typeof="mw:Entity">&nbsp;</span></span> represents countries that won at least one bronze medal but no gold or silver medals.<br>',
  '<span class="legend nowrap"><span class="legend-color mw-no-invert" style="forced-color-adjust: none; background-color:#99D9EA; color:black;"><span typeof="mw:Entity">&nbsp;</span></span><span typeof="mw:Entity">&nbsp;</span></span> represents countries that did not win any medals.<br>',
  '<span class="legend nowrap"><span class="legend-color mw-no-invert" style="forced-color-adjust: none; background-color:#ED1C24; color:black;"><span typeof="mw:Entity">&nbsp;</span></span><span typeof="mw:Entity">&nbsp;</span></span> represents countries that did not participate in the 2024 Summer Olympics.<br>',
  'Notes: the <a rel="mw:WikiLink" href="./Refugee_Olympic_Team">Refugee Olympic Team</a> (best medal bronze) and Individual Neutral Athletes (best medal gold) are not represented on the map.',
].join("\n");

describe("semantic figure legends", () => {
  it("preserves the pinned Olympics caption and exposes its swatches as a typed legend", async () => {
    const figure = await loadFigure(olympicsCaption);

    expect(figure.caption).toBe(
      "World map showing the medal achievements of each country during the 2024 Summer Olympics. Legend: represents countries that won at least one gold medal. represents countries that won at least one silver medal but no gold medals. represents countries that won at least one bronze medal but no gold or silver medals. represents countries that did not win any medals. represents countries that did not participate in the 2024 Summer Olympics. Notes: the Refugee Olympic Team (best medal bronze) and Individual Neutral Athletes (best medal gold) are not represented on the map.",
    );
    expect(figure.legend).toEqual({
      description:
        "World map showing the medal achievements of each country during the 2024 Summer Olympics.",
      entries: [
        {
          color: "#FFD700",
          text: "represents countries that won at least one gold medal.",
        },
        {
          color: "#C0C0C0",
          text: "represents countries that won at least one silver medal but no gold medals.",
        },
        {
          color: "#CC9966",
          text: "represents countries that won at least one bronze medal but no gold or silver medals.",
        },
        {
          color: "#99D9EA",
          text: "represents countries that did not win any medals.",
        },
        {
          color: "#ED1C24",
          text: "represents countries that did not participate in the 2024 Summer Olympics.",
        },
      ],
      notes: [
        "the Refugee Olympic Team (best medal bronze) and Individual Neutral Athletes (best medal gold) are not represented on the map.",
      ],
    });
  });

  it("accepts a safe background shorthand and associates text only within its break boundary", async () => {
    const figure = await loadFigure(
      [
        "A diagram.<br>Legend:<br>",
        '<span class="legend-color" style="background: rgb(12 34 56 / 75%)">&nbsp;</span>',
        " First meaning.<br>",
        '<div><span class="legend-color" style="background-color:hsl(120deg 50% 40%)">&nbsp;</span> Second meaning.</div>',
        "Notes: Source note.",
      ].join(""),
    );

    expect(figure.legend).toEqual({
      description: "A diagram.",
      entries: [
        { color: "rgb(12 34 56 / 75%)", text: "First meaning." },
        { color: "hsl(120deg 50% 40%)", text: "Second meaning." },
      ],
      notes: ["Source note."],
    });
  });

  it("preserves every pre-legend sentence and line as its description", async () => {
    const figure = await loadFigure(
      [
        "First sentence. Second sentence.<br>",
        "A separate preamble line.<br>",
        "Legend:<br>",
        '<span class="legend-color" style="background:#123456">&nbsp;</span> Meaning.',
      ].join(""),
    );

    expect(figure.legend?.description).toBe(
      "First sentence. Second sentence. A separate preamble line.",
    );
  });

  it("uses the last effective inline background declaration", async () => {
    const figure = await loadFigure(
      'Legend:<br><span class="legend-color" style="background-color:#fff;background:#000">&nbsp;</span> Effective black.',
    );

    expect(figure.legend?.entries).toEqual([
      { color: "#000", text: "Effective black." },
    ]);
    expect(figure.legend?.description).toBe("");
  });

  it.each([
    [
      "a missing background color",
      '<span class="legend-color" style="color:black">&nbsp;</span> Missing color.',
    ],
    [
      "an unsafe background value",
      '<span class="legend-color" style="background:url(https://example.test/pixel)">&nbsp;</span> Unsafe color.',
    ],
    [
      "a malformed functional color",
      '<span class="legend-color" style="background:rgb(1)">&nbsp;</span> Malformed color.',
    ],
    [
      "mixed legacy RGB channel units",
      '<span class="legend-color" style="background:rgb(0%, 128, 100%)">&nbsp;</span> Mixed units.',
    ],
    [
      "a malformed decimal CSS number",
      '<span class="legend-color" style="background:rgb(1.e2 2 3)">&nbsp;</span> Malformed number.',
    ],
    [
      "an unrepresentable final background shorthand",
      '<span class="legend-color" style="background-color:#fff;background:url(https://example.test/pixel)">&nbsp;</span> Hidden by image.',
    ],
    [
      "an earlier background image retained by a later color",
      '<span class="legend-color" style="background:url(https://example.test/pixel);background-color:#fff">&nbsp;</span> Image remains.',
    ],
    [
      "an explicit background image retained with a color",
      '<span class="legend-color" style="background-image:url(https://example.test/pixel);background-color:#fff">&nbsp;</span> Image remains.',
    ],
    [
      "an oversized color token",
      `<span class="legend-color" style="background:rgb(${"1".repeat(129)} 2 3)">&nbsp;</span> Oversized color.`,
    ],
    [
      "two swatches sharing one text boundary",
      '<span class="legend-color" style="background:#111">&nbsp;</span><span class="legend-color" style="background:#222">&nbsp;</span> Ambiguous colors.',
    ],
    [
      "a nested second swatch",
      '<span class="legend-color" style="background:#111"><span class="legend-color" style="background:#222">&nbsp;</span></span> Nested colors.',
    ],
    [
      "unrelated leading text sharing a swatch boundary",
      'Unrelated caption text <span class="legend-color" style="background:#222">&nbsp;</span> Ambiguous meaning.',
    ],
  ])(
    "declines the complete legend when it contains %s",
    async (_name, malformed) => {
      const figure = await loadFigure(
        [
          'Legend:<br><span class="legend-color" style="background:#abcdef">&nbsp;</span> Valid entry.<br>',
          malformed,
        ].join(""),
      );

      expect(figure.legend).toBeUndefined();
    },
  );

  it("declines oversized legends rather than exposing a partial set", async () => {
    const entries = Array.from(
      { length: 33 },
      (_, index) =>
        `<span class="legend-color" style="background:#123456">&nbsp;</span> Entry ${index + 1}.<br>`,
    ).join("");
    const figure = await loadFigure(`Legend:<br>${entries}`);

    expect(figure.legend).toBeUndefined();
  });

  it("declines an oversized legend description instead of truncating source prose", async () => {
    const figure = await loadFigure(
      `${"Description ".repeat(81)}<br>Legend:<br><span class="legend-color" style="background:#123456">&nbsp;</span> Entry.`,
    );

    expect(figure.legend).toBeUndefined();
  });

  it("declines a legend when another swatch follows its notes", async () => {
    const figure = await loadFigure(
      [
        'Legend:<br><span class="legend-color" style="background:#111">&nbsp;</span> First.<br>',
        "Notes: This must be trailing.<br>",
        '<span class="legend-color" style="background:#222">&nbsp;</span> Second.',
      ].join(""),
    );

    expect(figure.legend).toBeUndefined();
  });

  it("declines an unclassified caveat after the legend entries", async () => {
    const figure = await loadFigure(
      [
        'Legend:<br><span class="legend-color" style="background:#111">&nbsp;</span> Meaning.<br>',
        "This trailing caveat is not labeled as a note.",
      ].join(""),
    );

    expect(figure.legend).toBeUndefined();
  });

  it("includes source swatch colors in the figure content hash", async () => {
    const caption = (color: string) =>
      `Legend:<br><span class="legend-color" style="background-color:${color}">&nbsp;</span> Same meaning.`;
    const [gold, silver] = await Promise.all([
      loadFigure(caption("#FFD700")),
      loadFigure(caption("#C0C0C0")),
    ]);

    expect(gold.caption).toBe(silver.caption);
    expect(gold.contentHash).not.toBe(silver.contentHash);
  });
});
