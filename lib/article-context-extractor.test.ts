import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ArticleContextInputError,
  ArticleContextUpstreamError,
  extractArticleContextFromSource,
  fetchRevisionMatchedMediaWikiSource,
  normalizeArticleContextRequest,
  parseContextDateRange,
  sanitizeContextCaption,
  sanitizeContextText,
  validateContextManifest,
  type MediaWikiParsedSource,
} from "./article-context-extractor";
import {
  clearArticleContextMemoryCache,
  getEnhancedArticleContext,
} from "./article-context";
import {
  createArticleContextDownload,
  serializeArticleContextCsv,
} from "./article-context-download";

const request = {
  wikiPageId: "123",
  title: "Context Test",
  revisionId: "456",
  language: "en",
};

const escapeAttribute = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const chartPayload = escapeAttribute(
  JSON.stringify({
    version: 1,
    spec: {
      title: { text: "Population by year" },
      xAxis: { name: "Year", data: [2020, 2021, 2022] },
      yAxis: { name: "Population" },
      tooltip: { formatter: "<script>steal()</script>" },
      series: [
        {
          type: "line",
          name: "Residents",
          data: [100, 120, 115],
          label: { formatter: "{arbitrary|echarts option}" },
        },
      ],
    },
  }),
);

const richSource = (): MediaWikiParsedSource => ({
  pageId: "123",
  title: "Context Test",
  revisionId: "456",
  language: "en",
  sections: [
    { index: "1", line: "Data", anchor: "Data", level: "2" },
    { index: "2", line: "History", anchor: "History", level: "2" },
    { index: "3", line: "Process", anchor: "Process", level: "2" },
    { index: "4", line: "Storms", anchor: "Storms", level: "2" },
  ],
  html: `
    <a class="mw-kartographer-map" data-mw-kartographer="mapframe"
       data-zoom="7"><img alt="Map"></a>
    <span style="display:none"><span class="geo">44.6; -110.5</span></span>
    <h2 id="Data">Data</h2>
    <wiki-chart data-mw-chart="${chartPayload}"></wiki-chart>
    <table class="wikitable">
      <tr><th>Year</th><th>Backup value</th></tr>
      <tr><td>2020</td><td>1</td></tr>
      <tr><td>2021</td><td>2</td></tr>
      <tr><td>2022</td><td>3</td></tr>
    </table>
    <h2 id="History">History</h2>
    <table class="wikitable">
      <caption>Key events</caption>
      <tr><th>Date</th><th>Event</th><th>Place</th></tr>
      <tr><td>July 16, 1969</td><td>Mission launched</td><td>Florida</td></tr>
      <tr><td>July 20, 1969</td><td>Landing completed</td><td>Moon</td></tr>
      <tr><td>July 24, 1969</td><td>Crew returned</td><td>Pacific Ocean</td></tr>
    </table>
    <h2 id="Process">Process</h2>
    <figure typeof="mw:File/Thumb">
      <a href="/wiki/File:Example_cycle.png" class="mw-file-description">
        <img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example_cycle.png/640px-Example_cycle.png"
             width="640" height="480">
      </a>
      <figcaption>A process diagram showing “ material ” moving thru three reservoirs . Inputs enter the first reservoir, transfer to the second, and return through the final pathway . &larr;</figcaption>
    </figure>
    <h2 id="Storms">Storms</h2>
  `,
  wikitext: `
    Lead.
    == Data ==
    Chart.
    == History ==
    Table.
    == Process ==
    Figure.
    == Storms ==
    <timeline>
    DateFormat = dd/mm/yyyy
    BarData =
      barset:Hurricane
      bar:Month
    PlotData =
      barset:Hurricane
      from:01/06/2024 till:03/06/2024 color:TS text:"Alpha"
      from:05/06/2024 till:08/06/2024 color:C1 text:"[[Storm Beta|Beta]]"
      from:10/06/2024 till:12/06/2024 color:C2 text:"Gamma"
      from:14/06/2024 till:16/06/2024 color:C3 text:"Delta"
      from:18/06/2024 till:20/06/2024 color:C4 text:"Epsilon"
      from:22/06/2024 till:24/06/2024 color:C5 text:"Zeta"
    </timeline>
  `,
});

describe("article context deterministic extraction", () => {
  it("extracts complete semantic map, chart, timeline, diagram, and EasyTimeline blocks", () => {
    const manifest = extractArticleContextFromSource(richSource(), request, {
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });

    expect(validateContextManifest(manifest)).toEqual([]);
    expect(manifest.blocks.map((block) => block.kind)).toEqual([
      "map",
      "chart",
      "timeline",
      "diagram",
      "timeline",
    ]);
    expect(new Set(manifest.blocks.map((block) => block.section.index)).size).toBe(
      manifest.blocks.length,
    );

    const map = manifest.blocks.find((block) => block.kind === "map");
    expect(map?.kind === "map" && map.map.places[0]).toMatchObject({
      name: "Context Test",
      latitude: 44.6,
      longitude: -110.5,
    });

    const chart = manifest.blocks.find((block) => block.kind === "chart");
    expect(chart?.kind === "chart" && chart.chart.rows).toEqual([
      { year: 2020, residents: 100 },
      { year: 2021, residents: 120 },
      { year: 2022, residents: 115 },
    ]);
    expect(JSON.stringify(chart)).not.toContain("formatter");
    expect(JSON.stringify(chart)).not.toContain("<script");
    expect(JSON.stringify(chart)).not.toContain("steal()");
    expect(chart?.takeaway).toBe(
      "Residents has 3 values; the lowest is 100 at 2020, and the highest is 120 at 2021.",
    );
    expect(chart?.longDescription).not.toContain("ranging from");

    const history = manifest.blocks.find(
      (block) => block.kind === "timeline" && block.section.index === "2",
    );
    expect(history?.kind === "timeline" && history.timeline.events[0]).toMatchObject({
      label: "Mission launched",
      start: { iso: "1969-07-16", precision: "day" },
      description: "Place: Florida",
    });

    const diagram = manifest.blocks.find((block) => block.kind === "diagram");
    expect(diagram?.kind === "diagram" && diagram.diagram.image.src).toMatch(
      /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//,
    );
    expect(diagram?.longDescription).toContain("three reservoirs");
    expect(diagram?.kind === "diagram" && diagram.diagram.caption).toContain(
      "“material” moving through three reservoirs.",
    );
    expect(diagram?.kind === "diagram" && diagram.diagram.caption).not.toMatch(
      /[←→]|\s[.,]/,
    );
    expect(diagram?.spokenSummary).toContain(
      "The static source image and its caption are available alongside this description.",
    );
    expect(diagram?.spokenSummary).not.toContain("walkthrough");
    expect(diagram?.spokenSummary).not.toContain("named parts");

    const storms = manifest.blocks.find(
      (block) => block.kind === "timeline" && block.section.index === "4",
    );
    expect(storms?.kind === "timeline" && storms.timeline.events).toHaveLength(6);
    expect(
      storms?.kind === "timeline" && storms.timeline.events[1].label,
    ).toBe("Beta");
    expect(
      storms?.kind === "timeline" &&
        storms.timeline.events.map((event) => event.category),
    ).toEqual([
      "Tropical storm",
      "Category 1 hurricane",
      "Category 2 hurricane",
      "Category 3 hurricane",
      "Category 4 hurricane",
      "Category 5 hurricane",
    ]);
    expect(
      storms?.kind === "timeline" && storms.timeline.events[0].start.display,
    ).toBe("1 June 2024");
  });

  it("promises diagram structure only when the source image supplies named parts", () => {
    const source = richSource();
    source.html = source.html.replace(
      "<figcaption>",
      '<map><area alt="First reservoir" title="Input reservoir"></map><figcaption>',
    );

    const manifest = extractArticleContextFromSource(source, request);
    const diagram = manifest.blocks.find((block) => block.kind === "diagram");

    expect(diagram?.kind).toBe("diagram");
    expect(diagram?.kind === "diagram" && diagram.diagram.parts).toHaveLength(1);
    expect(diagram?.spokenSummary).toContain(
      "A source-caption walkthrough and 1 named part are available alongside the image.",
    );
    expect(diagram?.spokenSummary).not.toContain("static source image");
  });

  it("normalizes source GeoJSON into safe places and routes without exposing properties", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: '<h2 id="Route">Route</h2>',
      sections: [{ index: "1", line: "Route", anchor: "Route", level: "2" }],
      wikitext: `== Route ==
        <mapframe zoom="9">{
          "type":"FeatureCollection",
          "features":[
            {"type":"Feature","properties":{"title":"Start <script>bad()</script>","icon":"arbitrary"},"geometry":{"type":"Point","coordinates":[-87.6,41.8]}},
            {"type":"Feature","properties":{"name":"River route","stroke":"javascript:bad"},"geometry":{"type":"LineString","coordinates":[[-87.6,41.8],[-87.7,41.9],[-87.8,42.0]]}}
          ]
        }</mapframe>`,
    };

    const manifest = extractArticleContextFromSource(source, request);
    expect(manifest.blocks).toHaveLength(1);
    const block = manifest.blocks[0];
    expect(block.kind).toBe("map");
    if (block.kind !== "map") return;
    expect(block.map.places[0].name).toBe("Start");
    expect(block.map.routes[0]).toMatchObject({ name: "River route" });
    expect(block.map.routes[0].points).toHaveLength(3);
    expect(JSON.stringify(block)).not.toContain("stroke");
    expect(JSON.stringify(block)).not.toContain("javascript:");
  });

  it("uses a circular longitude mean for features spanning the dateline", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: '<h2 id="Dateline">Dateline</h2>',
      sections: [
        { index: "1", line: "Dateline", anchor: "Dateline", level: "2" },
      ],
      wikitext: `== Dateline ==
        <mapframe>{
          "type":"FeatureCollection",
          "features":[
            {"type":"Feature","properties":{"name":"West"},"geometry":{"type":"Point","coordinates":[179,10]}},
            {"type":"Feature","properties":{"name":"East"},"geometry":{"type":"Point","coordinates":[-179,10]}}
          ]
        }</mapframe>`,
    };

    const manifest = extractArticleContextFromSource(source, request);
    const map = manifest.blocks.find((block) => block.kind === "map");
    expect(map?.kind).toBe("map");
    expect(
      map?.kind === "map" ? Math.abs(map.map.center.longitude) : 0,
    ).toBeCloseTo(180, 5);
  });

  it("does not guess which same-section coordinate belongs to a map", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Locations">Locations</h2>
        <a class="mw-kartographer-map" data-mw-kartographer="mapframe"><img alt="Map"></a>
        <span class="geo">10; 20</span>
        <span class="geo">30; 40</span>`,
      sections: [
        { index: "1", line: "Locations", anchor: "Locations", level: "2" },
      ],
      wikitext: "",
    };

    expect(extractArticleContextFromSource(source, request).blocks).toEqual([]);
  });

  it("rejects oversized charts rather than truncating their semantic table", () => {
    const tooMany = Array.from({ length: 251 }, (_, index) => [index, index * 2]);
    const payload = escapeAttribute(
      JSON.stringify({
        spec: {
          xAxis: { name: "Index" },
          yAxis: { name: "Value" },
          series: [{ type: "line", name: "Values", data: tooMany }],
        },
      }),
    );
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<wiki-chart data-mw-chart="${payload}"></wiki-chart>`,
      wikitext: "",
      sections: [],
    };

    expect(extractArticleContextFromSource(source, request).blocks).toEqual([]);
  });

  it("keeps year-and-value tables quantitative instead of misclassifying them as timelines", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Population">Population</h2>
        <table class="wikitable">
          <tr><th>Year</th><th>Residents</th></tr>
          <tr><td>2020</td><td>100</td></tr>
          <tr><td>2021</td><td>120</td></tr>
          <tr><td>2022</td><td>115</td></tr>
        </table>`,
      wikitext: "",
      sections: [
        { index: "1", line: "Population", anchor: "Population", level: "2" },
      ],
    };
    const manifest = extractArticleContextFromSource(source, request);
    expect(manifest.blocks).toHaveLength(1);
    expect(manifest.blocks[0].kind).toBe("chart");
  });

  it("uses the latest event end when a timeline range outlasts later starts", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Overlapping">Overlapping</h2>
        <table class="wikitable">
          <tr><th>Date</th><th>Event</th></tr>
          <tr><td>January 1, 2020 to December 31, 2022</td><td>Long project</td></tr>
          <tr><td>June 1, 2021</td><td>Interim review</td></tr>
          <tr><td>July 1, 2021</td><td>Follow-up review</td></tr>
        </table>`,
      wikitext: "",
      sections: [
        {
          index: "1",
          line: "Overlapping",
          anchor: "Overlapping",
          level: "2",
        },
      ],
    };

    const manifest = extractArticleContextFromSource(source, request);
    const timeline = manifest.blocks.find((block) => block.kind === "timeline");
    expect(timeline?.takeaway).toContain("through December 31, 2022");
    expect(timeline?.longDescription).toContain(
      "through December 31, 2022",
    );
  });

  it("retains consistent leading currency symbols as chart units", () => {
    const extensionPayload = escapeAttribute(
      JSON.stringify({
        spec: {
          xAxis: { name: "Year", data: [2022, 2023, 2024] },
          yAxis: { name: "Value" },
          series: [
            { type: "bar", name: "€ Revenue", data: [10, 12, 15] },
          ],
        },
      }),
    );
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Dollar_table">Dollar table</h2>
        <table class="wikitable">
          <tr><th>Item</th><th>Revenue</th></tr>
          <tr><td>A</td><td>$1,000</td></tr>
          <tr><td>B</td><td>$1,500</td></tr>
          <tr><td>C</td><td>$900</td></tr>
          <tr><td>D</td><td>$1,200</td></tr>
          <tr><td>Not reported</td><td>N/A</td></tr>
        </table>
        <h2 id="Euro_chart">Euro chart</h2>
        <wiki-chart data-mw-chart="${extensionPayload}"></wiki-chart>
        <h2 id="Mixed_table">Mixed table</h2>
        <table class="wikitable">
          <tr><th>Item</th><th>Revenue</th></tr>
          <tr><td>A</td><td>$1</td></tr>
          <tr><td>B</td><td>€2</td></tr>
          <tr><td>C</td><td>$3</td></tr>
        </table>`,
      wikitext: "",
      sections: [
        {
          index: "1",
          line: "Dollar table",
          anchor: "Dollar_table",
          level: "2",
        },
        {
          index: "2",
          line: "Euro chart",
          anchor: "Euro_chart",
          level: "2",
        },
        {
          index: "3",
          line: "Mixed table",
          anchor: "Mixed_table",
          level: "2",
        },
      ],
    };

    const charts = extractArticleContextFromSource(source, request).blocks.filter(
      (block) => block.kind === "chart",
    );
    const dollar = charts.find((block) => block.section.index === "1");
    const euro = charts.find((block) => block.section.index === "2");
    const mixed = charts.find((block) => block.section.index === "3");
    expect(dollar?.kind === "chart" && dollar.chart.series[0].unit).toBe("$");
    expect(euro?.kind === "chart" && euro.chart.series[0].unit).toBe("€");
    expect(mixed?.kind === "chart" && mixed.chart.series[0].unit).toBeUndefined();
  });

  it("allows at most one promoted block per section and six per article", () => {
    const sections = Array.from({ length: 8 }, (_, index) => ({
      index: String(index + 1),
      line: `Process ${index + 1}`,
      anchor: `Process_${index + 1}`,
      level: "2",
    }));
    const html = sections
      .map(
        (section, index) => `<h2 id="${section.anchor}">${section.line}</h2>
          <figure><a href="/wiki/File:Diagram_${index}.png" class="mw-file-description"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Diagram_${index}.png/640px-Diagram_${index}.png" width="640" height="480"></a><figcaption>A process diagram with a complete source caption describing stage ${index + 1}, its input, its transformation, and its output for readers.</figcaption></figure>`,
      )
      .join("\n");
    const manifest = extractArticleContextFromSource(
      { ...richSource(), html, wikitext: "", sections },
      request,
    );
    expect(manifest.blocks).toHaveLength(6);
    expect(new Set(manifest.blocks.map((block) => block.section.index)).size).toBe(6);
  });

  it("does not promote incomplete, non-Commons, or uncaptioned figures", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `
        <figure><img src="https://upload.wikimedia.org/wikipedia/en/a/a1/Nonfree.png"><figcaption>A process diagram with enough words to otherwise appear eligible for contextual media.</figcaption></figure>
        <figure><img src="https://upload.wikimedia.org/wikipedia/commons/a/a1/Free.png"><figcaption>Diagram.</figcaption></figure>`,
      wikitext: "",
      sections: [],
    };
    expect(extractArticleContextFromSource(source, request).blocks).toEqual([]);
  });

  it("promotes diagram notation without treating topical photo captions as diagrams", () => {
    const figures = [
      {
        index: "1",
        anchor: "Taipei_transport",
        file: "Platform_screen_doors_in_Taipei_Nangang_Exhib_Center_Station.JPG",
        caption:
          "Underground platforms of Nangang Exhibition Center Station on the Taipei Metro system.",
      },
      {
        index: "2",
        anchor: "Apollo_orbit",
        file: "AS11-44-6642.png",
        caption: "Columbia in lunar orbit, photographed from Eagle.",
      },
      {
        index: "3",
        anchor: "Apollo_bootprint",
        file: "Aldrin_Apollo_11_original.jpg",
        caption:
          "Aldrin's bootprint, part of an experiment to test the properties of the lunar regolith.",
      },
      {
        index: "4",
        anchor: "Guitar_body",
        file: "Guitarist_girl.jpg",
        caption:
          "In the guitar, the sound box is the hollowed wooden structure that constitutes the body of the instrument.",
      },
      {
        index: "5",
        anchor: "Circle_of_fifths",
        file: "Pythagorean_tuning_geometric.svg",
        caption:
          'A sequence of twelve just fifths on a chromatic circle fail to close, resulting in a "broken" circle of fifths.',
      },
      {
        index: "6",
        anchor: "Carbon_cycle",
        file: "Carbon_cycle.jpg",
        caption:
          "Carbon cycle schematic showing the movement of carbon between land, atmosphere, and oceans in billions of tons per year.",
      },
      {
        index: "7",
        anchor: "Viral_carbon_cycle",
        file: "Viral_impacts_on_ecosystem_carbon_cycles.jpg",
        caption:
          "Arrows show the roles viruses play in the traditional food web, the microbial loop, and the carbon cycle.",
      },
    ];
    const sections = figures.map(({ index, anchor }) => ({
      index,
      line: anchor.replace(/_/g, " "),
      anchor,
      level: "2",
    }));
    const html = figures
      .map(
        ({ anchor, file, caption }) => `<h2 id="${anchor}">${anchor}</h2>
          <figure class="mw-default-size mw-halign-right" typeof="mw:File/Thumb">
            <a href="/wiki/File:${file}" class="mw-file-description">
              <img class="mw-file-element" src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${file}/640px-${file}.png" width="640" height="480">
            </a>
            <figcaption>${caption}</figcaption>
          </figure>`,
      )
      .join("\n");

    const manifest = extractArticleContextFromSource(
      { ...richSource(), html, wikitext: "", sections },
      request,
    );

    expect(
      manifest.blocks.map((block) => [block.kind, block.section.index]),
    ).toEqual([
      ["diagram", "5"],
      ["diagram", "6"],
      ["diagram", "7"],
    ]);
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("Metro system");
    expect(serialized).not.toContain("lunar orbit");
    expect(serialized).not.toContain("bootprint");
    expect(serialized).not.toContain("hollowed wooden structure");
  });
});

describe("article context dates and sanitization", () => {
  it("handles exact, approximate, range, and BCE dates without Date parsing", () => {
    expect(parseContextDateRange("July 20, 1969")).toMatchObject({
      start: { iso: "1969-07-20", sortKey: 19690720, precision: "day" },
    });
    expect(parseContextDateRange("circa 1450")).toMatchObject({
      start: { iso: "1450", precision: "circa" },
    });
    expect(parseContextDateRange("218 to 201 BC")).toMatchObject({
      start: { sortKey: -2180000 },
      end: { sortKey: -2010000 },
    });
    expect(
      parseContextDateRange("05/06/2024", { numericFormat: "dmy" }),
    ).toMatchObject({
      start: { display: "5 June 2024", iso: "2024-06-05" },
    });
  });

  it("rejects impossible calendar dates and honors leap years in every day format", () => {
    expect(
      parseContextDateRange("29/02/2024", { numericFormat: "dmy" }),
    ).not.toBeNull();
    expect(
      parseContextDateRange("29/02/2023", { numericFormat: "dmy" }),
    ).toBeNull();
    expect(
      parseContextDateRange("31/04/2024", { numericFormat: "dmy" }),
    ).toBeNull();

    expect(parseContextDateRange("2024-02-29")).not.toBeNull();
    expect(parseContextDateRange("2023-02-29")).toBeNull();
    expect(parseContextDateRange("2024-04-31")).toBeNull();

    expect(parseContextDateRange("February 29, 2024")).not.toBeNull();
    expect(parseContextDateRange("February 29, 2023")).toBeNull();
    expect(parseContextDateRange("31 April 2024")).toBeNull();
  });

  it("cleans caption-only speech artifacts without changing general labels", () => {
    expect(
      sanitizeContextCaption(
        '&rarr; “ quoted words ” , moving thru stage A &rarr; stage B . &larr;',
      ),
    ).toBe("“quoted words”, moving through stage A to stage B.");
    expect(sanitizeContextText("Drive-Thru Records")).toBe(
      "Drive-Thru Records",
    );
    expect(sanitizeContextCaption("Drive-Thru Records discography")).toBe(
      "Drive-Thru Records discography",
    );
  });

  it("removes executable markup and control characters from source text", () => {
    expect(
      sanitizeContextText(
        '<script>alert(1)</script><b>Useful</b> &amp; clear\u0000 text',
      ),
    ).toBe("Useful & clear text");
  });

  it("validates identifiers and locks v1 to English Wikipedia", () => {
    expect(() =>
      normalizeArticleContextRequest({ ...request, wikiPageId: "1 OR 1=1" }),
    ).toThrow(ArticleContextInputError);
    expect(() =>
      normalizeArticleContextRequest({ ...request, language: "fr" }),
    ).toThrow("English Wikipedia only");
  });
});

describe("revision-matched MediaWiki fetching", () => {
  it("pins oldid and rejects a mismatched revision", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("oldid=456");
      return new Response(
        JSON.stringify({
          parse: {
            pageid: 123,
            revid: 999,
            title: "Context Test",
            text: "",
            wikitext: "",
            sections: [],
          },
        }),
        { status: 200 },
      );
    });
    await expect(
      fetchRevisionMatchedMediaWikiSource(request, { fetchImpl }),
    ).rejects.toMatchObject({
      constructor: ArticleContextUpstreamError,
      statusCode: 409,
    });
  });

  it("returns a verified revision source without retaining API wrapper fields", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          batchcomplete: true,
          parse: {
            pageid: 123,
            revid: 456,
            title: "Context Test",
            text: "<p>Article</p>",
            wikitext: "Article",
            sections: [{ index: "1", line: "History", anchor: "History" }],
          },
        }),
        { status: 200 },
      ),
    );
    await expect(
      fetchRevisionMatchedMediaWikiSource(request, { fetchImpl }),
    ).resolves.toMatchObject({
      pageId: "123",
      revisionId: "456",
      html: "<p>Article</p>",
      sections: [{ index: "1", line: "History" }],
    });
  });
});

describe("article context cache and downloads", () => {
  beforeEach(() => {
    clearArticleContextMemoryCache();
  });

  it("deduplicates concurrent extraction and AI enhancement by source/model", async () => {
    const source = richSource();
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          parse: {
            pageid: Number(source.pageId),
            revid: Number(source.revisionId),
            title: source.title,
            text: source.html,
            wikitext: source.wikitext,
            sections: source.sections,
          },
        }),
        { status: 200 },
      ),
    );
    const enhance = vi.fn(async (manifest) => manifest);

    const [first, second] = await Promise.all([
      getEnhancedArticleContext(request, { fetchImpl, enhance }),
      getEnhancedArticleContext(request, { fetchImpl, enhance }),
    ]);
    const third = await getEnhancedArticleContext(request, { fetchImpl, enhance });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(enhance).toHaveBeenCalledTimes(1);
    expect(first.cacheStatus).toBe("miss");
    expect(second.context.sourceHash).toBe(first.context.sourceHash);
    expect(third.cacheStatus).toBe("hit");
  });

  it("exports provenance-preserving JSON and RFC 4180 CSV", () => {
    const manifest = extractArticleContextFromSource(richSource(), request);
    const csv = serializeArticleContextCsv(manifest);
    expect(csv).toContain("block_id,kind,section_index");
    expect(csv).toContain("Mission launched");
    expect(csv).toContain(manifest.revisionId);
    expect(csv).toContain("https://en.wikipedia.org/w/index.php?oldid=456");

    const download = createArticleContextDownload(manifest, "json");
    expect(download.contentType).toBe("application/json; charset=utf-8");
    expect(download.fileName).toBe("context-test-context.json");
    expect(JSON.parse(download.body)).toMatchObject({
      sourceHash: manifest.sourceHash,
      blocks: expect.any(Array),
    });
  });
});
