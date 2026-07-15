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
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
} from "./article-context-types";
import {
  fetchRevisionMatchedMediaWikiSource as fetchRevisionMatchedMediaWikiSourceFromFoundations,
  normalizeArticleContextRequest as normalizeArticleContextRequestFromFoundations,
  sanitizeContextCaption as sanitizeContextCaptionFromFoundations,
  sanitizeContextText as sanitizeContextTextFromFoundations,
} from "./article-context-foundations";
import {
  parseContextDateRange as parseContextDateRangeFromTimelines,
} from "./article-context-timelines";

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
  it("keeps the extractor facade wired to the extracted foundations", () => {
    expect(fetchRevisionMatchedMediaWikiSource).toBe(
      fetchRevisionMatchedMediaWikiSourceFromFoundations,
    );
    expect(normalizeArticleContextRequest).toBe(
      normalizeArticleContextRequestFromFoundations,
    );
    expect(sanitizeContextCaption).toBe(sanitizeContextCaptionFromFoundations);
    expect(sanitizeContextText).toBe(sanitizeContextTextFromFoundations);
    expect(parseContextDateRange).toBe(parseContextDateRangeFromTimelines);
    expect(ARTICLE_CONTEXT_EXTRACTOR_VERSION).toBe("2.0.7");
  });

  it("extracts complete semantic map, chart, timeline, diagram, and EasyTimeline blocks", () => {
    const manifest = extractArticleContextFromSource(richSource(), request, {
      now: () => new Date("2026-07-13T12:00:00.000Z"),
    });

    expect(validateContextManifest(manifest)).toEqual([]);
    expect(manifest).toMatchObject({
      schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
      extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
    });
    expect(JSON.stringify(manifest)).not.toContain('"takeaway"');
    expect(JSON.stringify(manifest)).not.toContain('"spokenSummary"');
    expect(manifest.blocks.map((block) => block.kind)).toEqual([
      "map",
      "chart",
      "timeline",
      "diagram",
      "timeline",
    ]);

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
    expect(chart?.caption).toBe(
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
    expect(diagram).not.toHaveProperty("takeaway");
    expect(diagram).not.toHaveProperty("spokenSummary");

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

  it("keeps distinct visual kinds from one section in source order", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      sections: [
        {
          index: "1",
          line: "System overview",
          anchor: "System_overview",
          level: "2",
        },
      ],
      html: `<h2 id="System_overview">System overview</h2>
        <figure typeof="mw:File/Thumb">
          <a href="/wiki/File:System_flow.png" class="mw-file-description">
            <img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/System_flow.png/640px-System_flow.png" width="640" height="480">
          </a>
          <figcaption>A process diagram showing source material entering the first stage, flowing through the transformation stage, and leaving through the final output.</figcaption>
        </figure>
        <wiki-chart data-mw-chart="${chartPayload}"></wiki-chart>`,
      wikitext: "",
    };

    const manifest = extractArticleContextFromSource(source, request);

    expect(validateContextManifest(manifest)).toEqual([]);
    expect(manifest.blocks.map((block) => block.kind)).toEqual([
      "diagram",
      "chart",
    ]);
    expect(manifest.blocks.map((block) => block.section.index)).toEqual([
      "1",
      "1",
    ]);
    expect(manifest.blocks.map((block) => block.order)).toEqual([0, 1]);
  });

  it("ignores heading-shaped text in comments and non-rendered HTML", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      sections: [
        {
          index: "1",
          line: "System overview",
          anchor: "System_overview",
          level: "2",
        },
      ],
      html: `<h2 id="System_overview">System overview</h2>
        <p>${"Rendered overview prose. ".repeat(120)}</p>
        <figure typeof="mw:File/Thumb">
          <a href="/wiki/File:System_flow.png" class="mw-file-description">
            <img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/System_flow.png/640px-System_flow.png" width="640" height="480">
          </a>
          <figcaption>A process diagram showing source material entering the first stage, flowing through the transformation stage, and leaving through the final output.</figcaption>
        </figure>
        <!-- <h3 id="Comment_example">Comment example</h3> -->
        <nowiki><h3 id="Nowiki_example">Nowiki example</h3></nowiki>
        <pre><h3 id="Pre_example">Pre example</h3></pre>
        <syntaxhighlight><h3 id="Code_example">Code example</h3></syntaxhighlight>
        <wiki-chart data-mw-chart="${chartPayload}"></wiki-chart>
        <p>${"More rendered overview prose. ".repeat(120)}</p>`,
      wikitext: "",
    };

    const manifest = extractArticleContextFromSource(source, request);

    expect(validateContextManifest(manifest)).toEqual([]);
    expect(manifest.blocks.map((block) => block.kind)).toEqual([
      "diagram",
      "chart",
    ]);
    expect(manifest.blocks.map((block) => block.section.index)).toEqual([
      "1",
      "1",
    ]);
  });

  it("normalizes wikitext and HTML positions without weakening section order", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      sections: [
        {
          index: "1",
          line: "System overview",
          anchor: "System_overview",
          level: "2",
        },
        { index: "2", line: "Later data", anchor: "Later_data", level: "2" },
      ],
      html: `<h2 id="System_overview">System overview</h2>
        <p>${"Rendered overview prose. ".repeat(200)}</p>
        <figure typeof="mw:File/Thumb">
          <a href="/wiki/File:System_flow.png" class="mw-file-description">
            <img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/System_flow.png/640px-System_flow.png" width="640" height="480">
          </a>
          <figcaption>A process diagram showing source material entering the first stage, flowing through the transformation stage, and leaving through the final output.</figcaption>
        </figure>
        <h2 id="Later_data">Later data</h2>
        <wiki-chart data-mw-chart="${chartPayload}"></wiki-chart>`,
      wikitext: `${"A much longer wikitext lead. ".repeat(800)}
        == System overview ==
        <timeline>
        DateFormat = yyyy
        BarData =
          barset:Milestones
        PlotData =
          barset:Milestones
          from:2001 till:2002 text:"Foundation"
          from:2003 till:2004 text:"Expansion"
          from:2005 till:2006 text:"Completion"
        </timeline>
        == Later data ==
        Chart.`,
    };

    const manifest = extractArticleContextFromSource(source, request);

    expect(validateContextManifest(manifest)).toEqual([]);
    expect(manifest.blocks.map((block) => block.kind)).toEqual([
      "timeline",
      "diagram",
      "chart",
    ]);
    expect(manifest.blocks.map((block) => block.section.index)).toEqual([
      "1",
      "1",
      "2",
    ]);
  });

  it("includes source-supplied diagram parts in the nonvisual description", () => {
    const source = richSource();
    source.html = source.html.replace(
      "<figcaption>",
      '<map><area alt="First reservoir" title="Input reservoir"></map><figcaption>',
    );

    const manifest = extractArticleContextFromSource(source, request);
    const diagram = manifest.blocks.find((block) => block.kind === "diagram");

    expect(diagram?.kind).toBe("diagram");
    expect(diagram?.kind === "diagram" && diagram.diagram.parts).toHaveLength(1);
    expect(diagram?.longDescription).toContain(
      "Named regions in the source image are First reservoir.",
    );
    expect(diagram).not.toHaveProperty("spokenSummary");
  });

  it("retains Commons attribution when the file-link class precedes href", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Process">Process</h2>
        <figure>
          <a class="image mw-file-description" href="/wiki/File:Ordered_attributes.png">
            <img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ordered_attributes.png/640px-Ordered_attributes.png" width="640" height="480">
          </a>
          <figcaption>A process diagram showing material entering a first stage, crossing a transformation stage, and leaving through the final output.</figcaption>
        </figure>`,
      wikitext: "",
      sections: [
        { index: "1", line: "Process", anchor: "Process", level: "2" },
      ],
    };

    const diagram = extractArticleContextFromSource(
      source,
      request,
    ).blocks.find((block) => block.kind === "diagram");
    expect(diagram?.sources).toContainEqual(
      expect.objectContaining({
        label: "Wikimedia Commons file: Ordered attributes.png",
        url: "https://commons.wikimedia.org/wiki/File:Ordered_attributes.png",
      }),
    );
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

  it("extracts all FIFA venues from an OSM Location map instead of treating its viewport center as a place", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Venues">Venues</h2>
        <a class="mw-kartographer-map" data-mw-kartographer="mapframe"
           data-zoom="3" data-lat="34" data-lon="-99.5"><img alt="Map"></a>`,
      sections: [
        { index: "9", line: "Venues", anchor: "Venues", level: "2" },
      ],
      wikitext: `==Venues==
        {{OSM Location map
        | coord              = {{coord|34|-99.5}}
        | zoom               = 3
        | caption            = Location map of the 2026 FIFA World Cup venues
        | label1             = '''[[Greater Los Angeles|Los Angeles]]'''
        | mark-coord1        = {{Coord|33.95340|-118.33902}}
        | mark-title1        = [[Greater Los Angeles|Los Angeles]]
        | mark-description1  = [[SoFi Stadium]]
        | label2             = '''[[San Francisco Bay Area|SF Bay Area]]'''
        | mark-coord2        = {{Coord|37.40317|-121.96979}}
        | mark-title2        = [[San Francisco Bay Area]]
        | mark-description2  = [[Levi's Stadium]]
        | label3             = '''[[Seattle]]'''
        | mark-coord3        = {{Coord|47.59515|-122.33163}}
        | mark-title3        = [[Seattle]]
        | mark-description3  = [[Lumen Field]]
        | label4             = '''[[Vancouver]]'''
        | mark-coord4        = {{Coord|49.27669|-123.11202}}
        | mark-title4        = [[Vancouver]]
        | mark-description4  = [[BC Place]]
        | label5             = '''[[Dallas–Fort Worth metroplex|Dallas]]'''
        | mark-coord5        = {{Coord|32.74785|-97.09283}}
        | mark-title5        = [[Dallas–Fort Worth metroplex|Dallas]]
        | mark-description5  = [[AT&T Stadium]]
        | label6             = '''[[Guadalajara metropolitan area|Guadalajara]]'''
        | mark-coord6        = {{Coord|20.68182|-103.46241}}
        | mark-title6        = [[Guadalajara metropolitan area|Guadalajara]]
        | mark-description6  = [[Estadio Akron]]
        | label7             = '''[[Houston]]'''
        | mark-coord7        = {{Coord|29.68486|-95.41080}}
        | mark-title7        = [[Houston]]
        | mark-description7  = [[NRG Stadium]]
        | label8             = '''[[Kansas City, Missouri|Kansas City]]'''
        | mark-coord8        = {{Coord|39.04893|-94.48401}}
        | mark-title8        = [[Kansas City, Missouri|Kansas City]]
        | mark-description8  = [[Arrowhead Stadium]]
        | label9             = '''[[Mexico City]]'''
        | mark-coord9        = {{Coord|19.30295|-99.15047}}
        | mark-title9        = [[Mexico City]]
        | mark-description9  = [[Estadio Azteca]]
        | label10            = '''[[Monterrey metropolitan area|Monterrey]]'''
        | mark-coord10       = {{Coord|25.66911|-100.24437}}
        | mark-title10       = [[Monterrey metropolitan area|Monterrey]]
        | mark-description10 = [[Estadio BBVA]]
        | label11            = '''[[Atlanta]]'''
        | mark-coord11       = {{Coord|33.4520|-84.24}}
        | mark-title11       = [[Atlanta]]
        | mark-description11 = [[Mercedes-Benz Stadium]]
        | label12            = '''[[Greater Boston|Boston]]'''
        | mark-coord12       = {{Coord|42.09093|-71.26436}}
        | mark-title12       = [[Greater Boston|Boston]]
        | mark-description12 = [[Gillette Stadium]]
        | label13            = '''[[Miami metropolitan area|Miami]]'''
        | mark-coord13       = {{Coord|25.95795|-80.23885}}
        | mark-title13       = [[Miami metropolitan area|Miami]]
        | mark-description13 = [[Hard Rock Stadium]]
        | label14            = '''[[New York metropolitan area|New York<br />New Jersey]]'''
        | mark-coord14       = {{Coord|40.81352|-74.07435}}
        | mark-title14       = [[New York metropolitan area|New York/New Jersey]]
        | mark-description14 = [[MetLife Stadium]]
        | label15            = '''[[Philadelphia]]'''
        | mark-coord15       = {{Coord|39.90081|-75.16747}}
        | mark-title15       = [[Philadelphia]]
        | mark-description15 = [[Lincoln Financial Field]]
        | label16            = '''[[Toronto]]'''
        | mark-coord16       = {{Coord|43.63322|-79.41858}}
        | mark-title16       = [[Toronto]]
        | mark-description16 = [[BMO Field]]
        }}`,
    };

    const manifest = extractArticleContextFromSource(source, request);
    const map = manifest.blocks.find((block) => block.kind === "map");

    expect(map?.kind).toBe("map");
    if (map?.kind !== "map") return;
    expect(map.map.places).toHaveLength(16);
    expect(map.map.places[0]).toMatchObject({
      name: "Los Angeles",
      latitude: 33.9534,
      longitude: -118.33902,
      description: "SoFi Stadium",
    });
    expect(map.map.places.at(-1)).toMatchObject({
      name: "Toronto",
      latitude: 43.63322,
      longitude: -79.41858,
      description: "BMO Field",
    });
    expect(map.map.places).not.toContainEqual(
      expect.objectContaining({ name: "Venues", latitude: 34, longitude: -99.5 }),
    );
    expect(map.caption).toBe(
      "The source map identifies 16 places associated with Venues.",
    );
    expect(map.longDescription).toContain("The source identifies 16 places.");

    const download = createArticleContextDownload(manifest, "json");
    const downloaded = JSON.parse(download.body) as typeof manifest;
    const downloadedMap = downloaded.blocks.find((block) => block.kind === "map");
    expect(downloadedMap?.kind === "map" && downloadedMap.map.places).toHaveLength(16);
    expect(
      downloadedMap?.kind === "map" && downloadedMap.map.places.at(-1),
    ).toMatchObject({ name: "Toronto", description: "BMO Field" });
  });

  it("parses compact OSM Location map parameters with non-contiguous marker indices", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Locations">Locations</h2>
        <a data-mw-kartographer="mapframe" data-zoom="6" data-lat="23" data-lon="112"><img alt="Map"></a>`,
      sections: [
        { index: "1", line: "Locations", anchor: "Locations", level: "2" },
      ],
      wikitext: `== Locations ==
        {{OSM Location map
        | coord = {{coord|23|112}}
        | mark-coord2 = {{coord|22.252|112.794}} | label2 = [[Taishan, Guangdong|Taishan]] | mark-description2 = Southern point
        | mark-coord9 = {{coord|23.477|111.279}} | mark-title9 = [[Wuzhou]] | mark-description9 = Northern point
        | zoom = 6
        }}`,
    };

    const map = extractArticleContextFromSource(source, request).blocks.find(
      (block) => block.kind === "map",
    );

    expect(map?.kind).toBe("map");
    expect(map?.kind === "map" && map.map.places).toMatchObject([
      {
        name: "Taishan",
        latitude: 22.252,
        longitude: 112.794,
        description: "Southern point",
      },
      {
        name: "Wuzhou",
        latitude: 23.477,
        longitude: 111.279,
        description: "Northern point",
      },
    ]);
  });

  it("suppresses a generic HTML viewport-center fallback for a malformed OSM Location map", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Venues">Venues</h2>
        <a data-mw-kartographer="mapframe" data-zoom="3" data-lat="34" data-lon="-99.5"><img alt="Map"></a>`,
      sections: [
        { index: "9", line: "Venues", anchor: "Venues", level: "2" },
      ],
      wikitext: `== Venues ==
        {{OSM Location map
        | coord = {{coord|34|-99.5}}
        | mark-coord1 = {{coord|not-a-latitude|-118.33902}}
        | mark-title1 = [[Greater Los Angeles|Los Angeles]]
        | zoom = 3
        }}`,
    };

    expect(extractArticleContextFromSource(source, request).blocks).toEqual([]);
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

  it("caps map features and rejects excessive or invalid coordinates", () => {
    const features = Array.from({ length: 201 }, (_, index) => ({
      type: "Feature",
      properties: { name: `Place ${index + 1}` },
      geometry: {
        type: "Point",
        coordinates: [-120 + (index % 100) / 100, 35 + (index % 50) / 100],
      },
    }));
    const cappedSource: MediaWikiParsedSource = {
      ...richSource(),
      html: '<h2 id="Locations">Locations</h2>',
      sections: [
        { index: "1", line: "Locations", anchor: "Locations", level: "2" },
      ],
      wikitext: `== Locations ==
        <mapframe>${JSON.stringify({ type: "FeatureCollection", features })}</mapframe>`,
    };

    const cappedMap = extractArticleContextFromSource(
      cappedSource,
      request,
    ).blocks.find((block) => block.kind === "map");
    expect(cappedMap?.kind === "map" && cappedMap.map.places).toHaveLength(200);

    const excessiveCoordinates = Array.from({ length: 2_001 }, (_, index) => [
      -120 + (index % 100) / 100,
      35 + (index % 50) / 100,
    ]);
    const excessiveSource: MediaWikiParsedSource = {
      ...cappedSource,
      wikitext: `== Locations ==
        <mapframe>${JSON.stringify({
          type: "LineString",
          coordinates: excessiveCoordinates,
        })}</mapframe>`,
    };
    expect(
      extractArticleContextFromSource(excessiveSource, request).blocks,
    ).toEqual([]);

    const invalidSource: MediaWikiParsedSource = {
      ...cappedSource,
      wikitext: `== Locations ==
        <mapframe>{"type":"Point","coordinates":[181,91]}</mapframe>`,
    };
    expect(extractArticleContextFromSource(invalidSource, request).blocks).toEqual(
      [],
    );
  });

  it("rejects a polygon when its exterior or any interior ring is invalid", () => {
    const validExterior = [
      [-88, 41],
      [-87, 41],
      [-87, 42],
      [-88, 42],
      [-88, 41],
    ];
    const validInterior = [
      [-87.8, 41.2],
      [-87.2, 41.2],
      [-87.2, 41.8],
      [-87.8, 41.8],
      [-87.8, 41.2],
    ];
    const invalidRing = [
      [-87.5, 41.5],
      [-87.4, 41.5],
      [-87.5, 41.5],
    ];
    const sourceForRings = (rings: number[][][]): MediaWikiParsedSource => ({
      ...richSource(),
      html: '<h2 id="Area">Area</h2>',
      sections: [{ index: "1", line: "Area", anchor: "Area", level: "2" }],
      wikitext: `== Area ==
        <mapframe>${JSON.stringify({ type: "Polygon", coordinates: rings })}</mapframe>`,
    });

    expect(
      extractArticleContextFromSource(
        sourceForRings([invalidRing, validInterior]),
        request,
      ).blocks,
    ).toEqual([]);
    expect(
      extractArticleContextFromSource(
        sourceForRings([validExterior, invalidRing]),
        request,
      ).blocks,
    ).toEqual([]);
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

  it("preserves every chart-extension series that fits and rejects an over-wide source", () => {
    const makePayload = (seriesCount: number) =>
      escapeAttribute(
        JSON.stringify({
          spec: {
            xAxis: { name: "Year", data: [2022, 2023, 2024] },
            yAxis: { name: "Value" },
            series: Array.from({ length: seriesCount }, (_, index) => ({
              type: "line",
              name: `Measure ${index + 1}`,
              data: [index + 1, index + 2, index + 3],
            })),
          },
        }),
      );
    const source = (seriesCount: number): MediaWikiParsedSource => ({
      ...richSource(),
      html: `<wiki-chart data-mw-chart="${makePayload(seriesCount)}"></wiki-chart>`,
      wikitext: "",
      sections: [],
    });

    const chart = extractArticleContextFromSource(source(11), request).blocks[0];
    expect(chart?.kind).toBe("chart");
    expect(chart?.kind === "chart" && chart.chart.series).toHaveLength(11);
    expect(
      chart?.kind === "chart" && chart.chart.series.map((series) => series.label),
    ).toEqual(Array.from({ length: 11 }, (_, index) => `Measure ${index + 1}`));
    expect(extractArticleContextFromSource(source(12), request).blocks).toEqual([]);
  });

  it("inherits an enclosing table caption unit and labels an unambiguous generic year axis", () => {
    const payload = escapeAttribute(
      JSON.stringify({
        spec: {
          xAxis: { data: [1800, 1900, 2000] },
          series: [
            { type: "line", name: "Population", data: [1, 2, 6] },
          ],
        },
      }),
    );
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <caption>World population (millions, historical estimates)</caption>
        <tr><td><wiki-chart data-mw-chart="${payload}"></wiki-chart></td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.columns[0]).toMatchObject({
      label: "Year",
      dataType: "number",
    });
    expect(chart.chart.series[0]).toMatchObject({
      label: "Population",
      unit: "millions",
    });
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

  it.each([
    "Location",
    "City",
    "State",
    "County",
    "Region",
    "Territory",
    "Borough",
    "Prefecture",
    "Language",
    "Species",
  ])("recognizes %s as a ranked entity label", (entityHeader) => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>Rank</th><th>${entityHeader}</th><th>Score</th></tr>
        <tr><td>1</td><td>Alpha</td><td>30</td></tr>
        <tr><td>2</td><td>Beta</td><td>20</td></tr>
        <tr><td>3</td><td>Gamma</td><td>10</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series[0]).toMatchObject({
      label: "Score",
      xColumn: entityHeader.toLocaleLowerCase().replace(/\s+/g, "-"),
      yColumn: "score",
    });
  });

  it.each([
    "Densest cities",
    "Cities by population density",
    "Most densely populated cities",
  ])(
    "uses %s wording to choose the primary ranking metric",
    (contextTitle) => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Densest_cities">${contextTitle}</h2>
        <table class="wikitable">
          <caption>${contextTitle}</caption>
          <tr><th>Rank</th><th>City</th><th>Population</th><th>Density (people/km²)</th></tr>
          <tr><td>1</td><td>Alpha</td><td>500000</td><td>18000</td></tr>
          <tr><td>2</td><td>Beta</td><td>900000</td><td>14000</td></tr>
          <tr><td>3</td><td>Gamma</td><td>700000</td><td>11000</td></tr>
          <tr><td>4</td><td>Delta</td><td>1200000</td><td>9000</td></tr>
        </table>`,
      wikitext: "",
      sections: [
        {
          index: "1",
          line: contextTitle,
          anchor: "Densest_cities",
          level: "2",
        },
      ],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series.map((series) => series.label)).toEqual([
      "Density (people/km²)",
      "Population",
    ]);
    expect(chart.chart.series[0].unit).toBe("people/km²");
    },
  );

  it("does not mistake source names or reference years for measurement units", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>Country</th><th>GDP (IMF)</th><th>Population (2026)</th><th>Area (km²)</th></tr>
        <tr><td>Alpha</td><td>100</td><td>10</td><td>4</td></tr>
        <tr><td>Beta</td><td>200</td><td>30</td><td>7</td></tr>
        <tr><td>Gamma</td><td>150</td><td>20</td><td>5</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(
      Object.fromEntries(
        chart.chart.series.map((series) => [series.label, series.unit]),
      ),
    ).toEqual({
      "GDP (IMF)": undefined,
      "Population (2026)": undefined,
      "Area (km²)": "km²",
    });
  });

  it("normalizes spaced area and density unit spellings", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>City</th><th>Land Area (mi 2 )</th><th>Density (/mi 2 )</th></tr>
        <tr><td>Alpha</td><td>100</td><td>50</td></tr>
        <tr><td>Beta</td><td>80</td><td>75</td></tr>
        <tr><td>Gamma</td><td>60</td><td>100</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series.map((series) => series.unit)).toEqual([
      "mi²",
      "per mi²",
    ]);
  });

  it.each([
    {
      sectionTitle: "Population in millions",
      metric: "Population",
      unit: "millions",
    },
    {
      sectionTitle: "Decadal growth rate",
      metric: "Growth",
      unit: "%",
    },
    {
      sectionTitle: "Life expectancy",
      metric: "Life expectancy",
      unit: "years",
    },
  ])(
    "infers $unit for $sectionTitle without manufacturing a source year unit",
    ({ sectionTitle, metric, unit }) => {
      const source: MediaWikiParsedSource = {
        ...richSource(),
        html: `<h2 id="Metric">${sectionTitle}</h2>
          <table class="wikitable">
            <tr><th>Region</th><th>${metric}</th></tr>
            <tr><td>Alpha</td><td>10</td></tr>
            <tr><td>Beta</td><td>20</td></tr>
            <tr><td>Gamma</td><td>15</td></tr>
          </table>`,
        wikitext: "",
        sections: [
          {
            index: "1",
            line: sectionTitle,
            anchor: "Metric",
            level: "2",
          },
        ],
      };

      const chart = extractArticleContextFromSource(source, request).blocks[0];
      expect(chart?.kind).toBe("chart");
      expect(chart?.kind === "chart" && chart.chart.series[0].unit).toBe(unit);
    },
  );

  it("applies a decadal growth percentage to each period series", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <caption>Decadal growth rate by state</caption>
        <tr><th>State</th><th>1991–01</th><th>2001–11</th></tr>
        <tr><td>Alpha</td><td>12.5</td><td>10.1</td></tr>
        <tr><td>Beta</td><td>8.2</td><td>7.4</td></tr>
        <tr><td>Gamma</td><td>15.0</td><td>13.3</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    expect(
      chart?.kind === "chart" &&
        chart.chart.series.map((series) => series.unit),
    ).toEqual(["%", "%"]);
  });

  it("uses only a nearby same-section paragraph as explicit table unit context", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Earlier">Earlier section</h2>
        <p>These unrelated measurements are expressed in billions.</p>
        <h2 id="Past_population">Past population</h2>
        <p>The following table gives historical estimates, in millions.</p>
        <table class="wikitable">
          <tr><th>Year</th><th>Population</th></tr>
          <tr><td>1800</td><td>1</td></tr>
          <tr><td>1900</td><td>2</td></tr>
          <tr><td>2000</td><td>6</td></tr>
          <tr><td>2020</td><td>8</td></tr>
        </table>`,
      wikitext: "",
      sections: [
        {
          index: "1",
          line: "Earlier section",
          anchor: "Earlier",
          level: "2",
        },
        {
          index: "2",
          line: "Past population",
          anchor: "Past_population",
          level: "2",
        },
      ],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    expect(chart?.kind === "chart" && chart.chart.series[0].unit).toBe(
      "millions",
    );
  });

  it("uses article table context to choose a non-ranking default metric", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Population_by_region">Population by region</h2>
        <table class="wikitable">
          <tr><th>Region</th><th>Land area</th><th>Population</th></tr>
          <tr><td>Alpha</td><td>100</td><td>500</td></tr>
          <tr><td>Beta</td><td>200</td><td>900</td></tr>
          <tr><td>Gamma</td><td>150</td><td>700</td></tr>
        </table>`,
      wikitext: "",
      sections: [
        {
          index: "1",
          line: "Population by region",
          anchor: "Population_by_region",
          level: "2",
        },
      ],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series.map((series) => series.label)).toEqual([
      "Population",
      "Land area",
    ]);
  });

  it("chooses a later chronological column over a non-chronological first column", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>Source</th><th>Year</th><th>Population</th></tr>
        <tr><td>Official census</td><td>2000</td><td>100</td></tr>
        <tr><td>Official census</td><td>2010</td><td>120</td></tr>
        <tr><td>Official census</td><td>2020</td><td>150</td></tr>
        <tr><td>Official census</td><td>2025</td><td>160</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series).toEqual([
      expect.objectContaining({
        label: "Population",
        type: "line",
        xColumn: "year",
        yColumn: "population",
      }),
    ]);
  });

  it("accepts comma-formatted BCE years as a chronological table axis", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>Year</th><th>Estimated population</th></tr>
        <tr><td>10,000 BC</td><td>4</td></tr>
        <tr><td>8,000 BC</td><td>5</td></tr>
        <tr><td>6,000 BC</td><td>7</td></tr>
        <tr><td>4,000 BC</td><td>10</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series[0]).toMatchObject({
      type: "line",
      xColumn: "year",
      yColumn: "estimated-population",
    });
  });

  it("does not mistake a duration metric for a chronological x column", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>Country</th><th>Years of schooling</th><th>Population</th></tr>
        <tr><td>Alpha</td><td>11</td><td>100</td></tr>
        <tr><td>Beta</td><td>12</td><td>200</td></tr>
        <tr><td>Gamma</td><td>13</td><td>150</td></tr>
        <tr><td>Delta</td><td>14</td><td>250</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series).toEqual([
      expect.objectContaining({
        label: "Years of schooling",
        type: "bar",
        xColumn: "country",
      }),
      expect.objectContaining({
        label: "Population",
        type: "bar",
        xColumn: "country",
      }),
    ]);
  });

  it("does not interpret month-and-day schedule labels as ancient month-and-year dates", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>Matchday</th><th>Pairings</th><th>Groups</th><th>Date</th></tr>
        <tr><td>1</td><td>1 v 2</td><td>A</td><td>June 11</td></tr>
        <tr><td>1</td><td>3 v 4</td><td>B</td><td>June 12</td></tr>
        <tr><td>2</td><td>1 v 3</td><td>A</td><td>June 13</td></tr>
        <tr><td>2</td><td>2 v 4</td><td>B</td><td>June 14</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    expect(extractArticleContextFromSource(source, request).blocks).toEqual([]);
  });

  it.each(["Area", "Area/colony", "Area/Province", "Groups"])(
    "does not connect changing %s categories into one chronological line",
    (categoryHeader) => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>Year</th><th>${categoryHeader}</th><th>Population</th></tr>
        <tr><td>1800</td><td>Upper Canada</td><td>100</td></tr>
        <tr><td>1810</td><td>Lower Canada</td><td>150</td></tr>
        <tr><td>1820</td><td>New Brunswick</td><td>125</td></tr>
        <tr><td>1830</td><td>Nova Scotia</td><td>175</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    expect(extractArticleContextFromSource(source, request).blocks).toEqual([]);
    },
  );

  it("prefers the latest dated series when a wide table exceeds the series cap", () => {
    const years = Array.from({ length: 11 }, (_, index) => 2010 + index);
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>State</th>${years.map((year) => `<th>${year}</th>`).join("")}</tr>
        ${["Alpha", "Beta", "Gamma"]
          .map(
            (state, stateIndex) =>
              `<tr><td>${state}</td>${years
                .map((year) => `<td>${year - 1900 + stateIndex * 10}</td>`)
                .join("")}</tr>`,
          )
          .join("")}
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series.map((series) => series.label)).toEqual([
      "2020",
      "2019",
      "2018",
      "2017",
      "2016",
      "2015",
      "2014",
      "2013",
    ]);
  });

  it("keeps source order within series that share the same reference year", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>Group</th><th>Pop 2010</th><th>% 2010</th><th>Pop 2020</th><th>% 2020</th></tr>
        <tr><td>Alpha</td><td>100</td><td>10%</td><td>120</td><td>12%</td></tr>
        <tr><td>Beta</td><td>200</td><td>20%</td><td>230</td><td>23%</td></tr>
        <tr><td>Gamma</td><td>300</td><td>30%</td><td>350</td><td>35%</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series.map((series) => series.label)).toEqual([
      "Pop 2020",
      "% 2020",
      "Pop 2010",
      "% 2010",
    ]);
  });

  it("uses bars for an underpowered three-date comparison", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>Year</th><th>Population</th><th>Households</th><th>Median age</th></tr>
        <tr><td>2000</td><td>100</td><td>40</td><td>30</td></tr>
        <tr><td>2010</td><td>120</td><td>50</td><td>32</td></tr>
        <tr><td>2020</td><td>150</td><td>65</td><td>35</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series.map((series) => series.type)).toEqual([
      "bar",
      "bar",
      "bar",
    ]);
  });

  it("rejects numeric table metrics without a source-supplied label", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>City</th><th></th></tr>
        <tr><td>Alpha</td><td>100</td></tr>
        <tr><td>Beta</td><td>120</td></tr>
        <tr><td>Gamma</td><td>150</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };

    expect(extractArticleContextFromSource(source, request).blocks).toEqual([]);
  });

  it("normalizes grouped standings into one comprehensible ranked series", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Tournament_ranking">Tournament ranking</h2>
        <table class="wikitable">
          <tr>
            <th><abbr title="Position">Pos</abbr></th>
            <th>Team</th>
            <th><abbr title="Played">Pld</abbr></th>
            <th><abbr title="Won">W</abbr></th>
            <th><abbr title="Points">Pts</abbr></th>
            <th>Final result</th>
          </tr>
          <tr><td>1</td><th scope="row">&nbsp;</th><td>0</td><td>0</td><td>0</td><td rowspan="1">Champion</td></tr>
          <tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>
          <tr><td>2</td><th scope="row">Alpha</th><td>4</td><td>3</td><td>9</td><td rowspan="2">Qualified</td></tr>
          <tr><td>3</td><th scope="row">Beta</th><td>4</td><td>2</td><td>6</td></tr>
          <tr><td>4</td><th scope="row">Gamma</th><td>4</td><td>1</td><td>3</td><td rowspan="2">Eliminated</td></tr>
          <tr><td>5</td><th scope="row">Delta</th><td>4</td><td>0</td><td>1</td></tr>
        </table>`,
      wikitext: "",
      sections: [
        {
          index: "1",
          line: "Tournament ranking",
          anchor: "Tournament_ranking",
          level: "2",
        },
      ],
    };

    const manifest = extractArticleContextFromSource(source, request);
    const chart = manifest.blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;

    expect(chart.chart.columns.map((column) => column.label)).toEqual([
      "Position",
      "Team",
      "Played",
      "Won",
      "Points",
      "Final result",
    ]);
    expect(chart.chart.rows).toHaveLength(4);
    expect(chart.chart.rows.map((row) => row.team)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
      "Delta",
    ]);
    expect(chart.chart.rows[1]["final-result"]).toBe("Qualified");
    expect(chart.chart.rows[3]["final-result"]).toBe("Eliminated");
    expect(chart.chart.series).toEqual([
      expect.objectContaining({
        label: "Points",
        type: "bar",
        xColumn: "team",
        yColumn: "points",
      }),
      expect.objectContaining({
        label: "Won",
        type: "bar",
        xColumn: "team",
        yColumn: "won",
      }),
    ]);
    expect(chart.caption).toBe(
      "Points is listed for 4 ranked entries; the lowest is 1 for Delta, and the highest is 9 for Alpha.",
    );
  });

  it("rejects unnamed or malformed standings rather than charting a surviving fragment", () => {
    const placeholderSource: MediaWikiParsedSource = {
      ...richSource(),
      html: `<table class="wikitable">
        <tr><th>Position</th><th>Team</th><th>Points</th></tr>
        <tr><td>1</td><td>&nbsp;</td><td>0</td></tr>
        <tr><td>2</td><td>TBD</td><td>0</td></tr>
        <tr><td>3</td><td>—</td><td>0</td></tr>
      </table>`,
      wikitext: "",
      sections: [],
    };
    expect(extractArticleContextFromSource(placeholderSource, request).blocks).toEqual([]);

    const malformedSource: MediaWikiParsedSource = {
      ...placeholderSource,
      html: `<table class="wikitable">
        <tr><th>Position</th><th>Team</th><th>Points</th><th>Result</th></tr>
        <tr><td>1</td><td>Alpha</td><td>9</td><td rowspan="3">Qualified</td></tr>
        <tr><td>2</td><td>Beta</td><td>6</td></tr>
      </table>`,
    };
    expect(extractArticleContextFromSource(malformedSource, request).blocks).toEqual([]);
  });

  it("does not let an individual scoring table suppress team group standings", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Group_A">Group A</h2>
        <table class="wikitable">
          <tr><th>Position</th><th>Team</th><th>Points</th></tr>
          <tr><td>1</td><td>Alpha</td><td>9</td></tr>
          <tr><td>2</td><td>Beta</td><td>6</td></tr>
          <tr><td>3</td><td>Gamma</td><td>3</td></tr>
          <tr><td>4</td><td>Delta</td><td>0</td></tr>
        </table>
        <h2 id="Golden_Boot">Golden Boot</h2>
        <table class="wikitable">
          <tr><th>Rank</th><th>Player</th><th>Goals</th><th>Assists</th><th>Minutes played</th></tr>
          ${Array.from(
            { length: 10 },
            (_, index) =>
              `<tr><td>${index + 1}</td><td>Player ${index + 1}</td><td>${10 - index}</td><td>${Math.max(0, 5 - Math.floor(index / 2))}</td><td>${300 + index * 37}</td></tr>`,
          ).join("")}
        </table>`,
      wikitext: "",
      sections: [
        { index: "1", line: "Group A", anchor: "Group_A", level: "2" },
        {
          index: "2",
          line: "Golden Boot",
          anchor: "Golden_Boot",
          level: "2",
        },
      ],
    };

    const charts = extractArticleContextFromSource(source, request).blocks.filter(
      (block) => block.kind === "chart",
    );
    expect(charts.map((block) => block.section.title)).toEqual([
      "Group A",
      "Golden Boot",
    ]);
    const goldenBoot = charts.find((block) => block.section.title === "Golden Boot");
    expect(
      goldenBoot?.kind === "chart"
        ? goldenBoot.chart.series.map((series) => series.label)
        : [],
    ).toEqual(["Goals", "Assists"]);
  });

  it("prioritizes four useful league metrics for optional ranking comparisons", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Standings">Standings</h2>
        <table class="wikitable">
          <tr><th>Position</th><th>Team</th><th>Played</th><th>Won</th><th>Drawn</th><th>Lost</th><th>Goals for</th><th>Goals against</th><th>Goal difference</th><th>Points</th></tr>
          <tr><td>1</td><td>Alpha</td><td>6</td><td>5</td><td>1</td><td>0</td><td>15</td><td>3</td><td>12</td><td>16</td></tr>
          <tr><td>2</td><td>Beta</td><td>6</td><td>4</td><td>1</td><td>1</td><td>12</td><td>5</td><td>7</td><td>13</td></tr>
          <tr><td>3</td><td>Gamma</td><td>6</td><td>3</td><td>1</td><td>2</td><td>9</td><td>7</td><td>2</td><td>10</td></tr>
          <tr><td>4</td><td>Delta</td><td>6</td><td>2</td><td>1</td><td>3</td><td>7</td><td>10</td><td>-3</td><td>7</td></tr>
          <tr><td>5</td><td>Epsilon</td><td>6</td><td>1</td><td>1</td><td>4</td><td>5</td><td>12</td><td>-7</td><td>4</td></tr>
        </table>`,
      wikitext: "",
      sections: [
        { index: "1", line: "Standings", anchor: "Standings", level: "2" },
      ],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series.map((series) => series.label)).toEqual([
      "Points",
      "Goal difference",
      "Won",
      "Goals for",
    ]);
  });

  it("treats serial numbers as identifiers instead of ranking semantics", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Cities">Cities</h2>
        <table class="wikitable">
          <tr><th>No.</th><th>Name</th><th>Population</th></tr>
          <tr><td>1</td><td>Alpha</td><td>100</td></tr>
          <tr><td>2</td><td>Beta</td><td>250</td></tr>
          <tr><td>3</td><td>Gamma</td><td>175</td></tr>
        </table>`,
      wikitext: "",
      sections: [{ index: "1", line: "Cities", anchor: "Cities", level: "2" }],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series).toEqual([
      expect.objectContaining({
        label: "Population",
        xColumn: "name",
        yColumn: "population",
      }),
    ]);
    expect(chart.caption).toContain("at Beta");
    expect(chart.caption).not.toContain("ranked entries");
  });

  it("keeps a constant benchmark beside a changing comparison series", () => {
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: `<h2 id="Performance">Performance</h2>
        <table class="wikitable">
          <tr><th>Year</th><th>Actual</th><th>Target</th></tr>
          <tr><td>2023</td><td>80</td><td>100</td></tr>
          <tr><td>2024</td><td>95</td><td>100</td></tr>
          <tr><td>2025</td><td>110</td><td>100</td></tr>
        </table>`,
      wikitext: "",
      sections: [
        {
          index: "1",
          line: "Performance",
          anchor: "Performance",
          level: "2",
        },
      ],
    };

    const chart = extractArticleContextFromSource(source, request).blocks[0];
    expect(chart?.kind).toBe("chart");
    if (chart?.kind !== "chart") return;
    expect(chart.chart.series.map((series) => series.label)).toEqual([
      "Actual",
      "Target",
    ]);
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
    expect(timeline?.caption).toContain("through December 31, 2022");
    expect(timeline?.longDescription).toContain(
      "through December 31, 2022",
    );
  });
  it("skips malformed EasyTimeline entries and bounds the accessible summary", () => {
    const validEntries = Array.from({ length: 14 }, (_, index) => {
      const day = String(index + 1).padStart(2, "0");
      const nextDay = String(index + 2).padStart(2, "0");
      return `from:${day}/06/2024 till:${nextDay}/06/2024 color:TS text:"Event ${index + 1}"`;
    }).join("\n");
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: '<h2 id="Chronology">Chronology</h2>',
      wikitext: `== Chronology ==
        <timeline>
        DateFormat = dd/mm/yyyy
        barset:Events
        ${validEntries}
        from:31/02/2024 till:01/03/2024 color:TS text:"Impossible date"
        from:20/06/2024 till:21/06/2024 color:TS
        from:not-a-date till:22/06/2024 color:TS text:"Broken start"
        </timeline>`,
      sections: [
        {
          index: "1",
          line: "Chronology",
          anchor: "Chronology",
          level: "2",
        },
      ],
    };

    const timeline = extractArticleContextFromSource(
      source,
      request,
    ).blocks.find((block) => block.kind === "timeline");
    expect(timeline?.kind).toBe("timeline");
    if (timeline?.kind !== "timeline") return;
    expect(timeline.timeline.events).toHaveLength(14);
    expect(timeline.timeline.events.map((event) => event.label)).not.toContain(
      "Impossible date",
    );
    expect(timeline.longDescription).toContain(
      "The remaining 2 events are available in the ordered event list.",
    );
    expect(timeline.longDescription).not.toContain("Event 13");
  });

  it("rejects EasyTimeline candidates that exceed the event cap", () => {
    const entries = Array.from({ length: 251 }, (_, index) => {
      const year = 1000 + index;
      return `from:${year} till:${year + 1} text:"Event ${index + 1}"`;
    }).join("\n");
    const source: MediaWikiParsedSource = {
      ...richSource(),
      html: '<h2 id="Chronology">Chronology</h2>',
      wikitext: `== Chronology ==
        <timeline>
        DateFormat = yyyy
        barset:Events
        ${entries}
        </timeline>`,
      sections: [
        {
          index: "1",
          line: "Chronology",
          anchor: "Chronology",
          level: "2",
        },
      ],
    };

    expect(extractArticleContextFromSource(source, request).blocks).toEqual([]);
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

  it("caps selected visual blocks at six per article", () => {
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
    expect(parseContextDateRange("10,000 BC")).toMatchObject({
      start: { display: "10,000 BC", sortKey: -100000000 },
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

  it("validates identifiers and limits extraction to English Wikipedia", () => {
    expect(() =>
      normalizeArticleContextRequest({ ...request, wikiPageId: "1 OR 1=1" }),
    ).toThrow(ArticleContextInputError);
    expect(() =>
      normalizeArticleContextRequest({ ...request, language: "fr" }),
    ).toThrow("English Wikipedia only");
  });
});

describe("revision-matched MediaWiki fetching", () => {
  it("rejects oversized responses from headers before reading the body", async () => {
    const requestState: { signal?: AbortSignal | null } = {};
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestState.signal = init?.signal ?? null;
      return new Response("{}", {
        status: 200,
        headers: { "content-length": String(15 * 1024 * 1024 + 1) },
      });
    });

    await expect(
      fetchRevisionMatchedMediaWikiSource(request, { fetchImpl }),
    ).rejects.toThrow("Wikipedia context response exceeded the safe size limit");
    expect(requestState.signal?.aborted).toBe(true);
  });

  it("cancels an oversized streaming response as soon as the byte limit is crossed", async () => {
    let cancelled = false;
    let emittedChunks = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        emittedChunks += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
        if (emittedChunks >= 20) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));

    await expect(
      fetchRevisionMatchedMediaWikiSource(request, { fetchImpl }),
    ).rejects.toThrow("Wikipedia context response exceeded the safe size limit");
    expect(cancelled).toBe(true);
    expect(emittedChunks).toBeLessThan(20);
  });

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
