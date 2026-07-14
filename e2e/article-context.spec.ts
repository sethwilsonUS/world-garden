import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import type { ContextManifest } from "../lib/article-context-types";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const source = {
  label: "Wikipedia revision 123456789",
  url: "https://en.wikipedia.org/w/index.php?oldid=123456789",
  revisionId: "123456789",
  license: "CC BY-SA 4.0",
  accessedAt: "2026-07-13T00:00:00.000Z",
};

const provenance = {
  articleUrl: "https://en.wikipedia.org/wiki/Ada_Lovelace",
  articleRevisionUrl:
    "https://en.wikipedia.org/w/index.php?title=Ada_Lovelace&oldid=123456789",
  sourceHash: "0123456789abcdef0123456789abcdef",
  extractorVersion: "2.0.0",
  descriptionMethod: "ai-assisted" as const,
  model: "gpt-5.6-luna",
  promptVersion: "context-accessibility-v3",
};

const contextManifest = {
  schemaVersion: 2,
  wikiPageId: "974",
  title: "Ada Lovelace",
  revisionId: "123456789",
  language: "en",
  sourceHash: "manifest-source-hash",
  extractorVersion: "2.0.0",
  generatedAt: "2026-07-13T00:00:00.000Z",
  blocks: [
    {
      id: "map-journey",
      kind: "map",
      title: "Places in the correspondence",
      caption:
        "The correspondence connects London, England, with Turin, Italy.",
      longDescription:
        "The map begins in London and follows a southeast route to Turin. London is at latitude 51.5074 and longitude negative 0.1278. Turin is at latitude 45.0703 and longitude 7.6869.",
      section: { index: "__summary__", title: "Summary" },
      order: 1,
      sources: [source],
      provenance,
      map: {
        center: { latitude: 48.5, longitude: 3.75 },
        suggestedZoom: 4,
        places: [
          {
            id: "london",
            name: "London",
            latitude: 51.5074,
            longitude: -0.1278,
            description: "Lovelace's home city.",
          },
          {
            id: "turin",
            name: "Turin",
            latitude: 45.0703,
            longitude: 7.6869,
            description: "The location of Menabrea's lecture.",
          },
        ],
        routes: [
          {
            id: "letters-route",
            name: "Correspondence route",
            description: "A schematic connection between the two cities.",
            points: [
              { latitude: 51.5074, longitude: -0.1278, label: "London" },
              { latitude: 45.0703, longitude: 7.6869, label: "Turin" },
            ],
          },
        ],
        areas: [
          {
            id: "western-europe",
            name: "Western Europe study area",
            description: "The area surrounding the two mapped places.",
            rings: [
              [
                { latitude: 44, longitude: -2 },
                { latitude: 53, longitude: -2 },
                { latitude: 53, longitude: 9 },
                { latitude: 44, longitude: 9 },
                { latitude: 44, longitude: -2 },
              ],
            ],
          },
        ],
      },
    },
    {
      id: "timeline-engine",
      kind: "timeline",
      title: "Analytical Engine milestones",
      caption:
        "Babbage proposed the Analytical Engine in 1837, followed by Lovelace's published notes in 1843.",
      longDescription:
        "There are two milestones in chronological order. The Analytical Engine was proposed in 1837. Lovelace's notes were published in 1843.",
      section: { index: "1", title: "Early life", anchor: "Early_life" },
      order: 2,
      sources: [source],
      provenance,
      timeline: {
        chronological: true,
        events: [
          {
            id: "engine-proposed",
            label: "Analytical Engine proposed",
            start: {
              display: "1837",
              iso: "1837",
              sortKey: 1837,
              precision: "year",
            },
            description: "Babbage described a general-purpose mechanical computer.",
            category: "Invention",
          },
          {
            id: "notes-published",
            label: "Lovelace's notes published",
            start: {
              display: "1843",
              iso: "1843",
              sortKey: 1843,
              precision: "year",
            },
            description: "Her translation and extensive notes appeared in print.",
            category: "Publication",
          },
        ],
      },
    },
    {
      id: "chart-note-length",
      kind: "chart",
      title: "Notes compared with the source article",
      caption:
        "The source article has 8 thousand words, while Lovelace's notes have 20 thousand words.",
      longDescription:
        "The exact data table compares two documents. The source article has 8 thousand words and the notes have 20 thousand words.",
      section: { index: "1", title: "Early life", anchor: "Early_life" },
      order: 3,
      sources: [source],
      provenance,
      chart: {
        columns: [
          { key: "document", label: "Document", dataType: "string" },
          { key: "words", label: "Words", dataType: "number", unit: "thousands" },
        ],
        rows: [
          { document: "Source article", words: 8 },
          { document: "Lovelace's notes", words: 20 },
        ],
        series: [
          {
            id: "word-count",
            label: "Word count",
            type: "bar",
            xColumn: "document",
            yColumn: "words",
            unit: "thousands",
          },
        ],
        sourceChartType: "wikitable",
      },
    },
    {
      id: "diagram-engine",
      kind: "diagram",
      title: "Analytical Engine data flow",
      caption:
        "Punched cards provide input to the mill, and the mill sends results to the printer.",
      longDescription:
        "The diagram has three named parts arranged from input to output: punched cards, the mill, and the printer. Cards feed the mill, and the mill sends results to the printer.",
      section: { index: "1", title: "Early life", anchor: "Early_life" },
      order: 4,
      sources: [source],
      provenance,
      diagram: {
        image: {
          src: "https://upload.wikimedia.org/context/analytical-engine.png",
          alt: "Diagram showing punched cards feeding the mill, which sends results to a printer.",
          width: 800,
          height: 500,
        },
        parts: [
          { id: "cards", label: "Punched cards", description: "The instruction input." },
          { id: "mill", label: "Mill", description: "The calculating unit." },
          { id: "printer", label: "Printer", description: "The result output." },
        ],
        relationships: [
          { fromId: "cards", toId: "mill", label: "feed instructions into" },
          { fromId: "mill", toId: "printer", label: "sends results to" },
        ],
        walkthrough: [
          "Begin with the punched cards.",
          "Follow the instructions into the mill.",
          "Continue from the mill to the printer.",
        ],
        caption: "A simplified data-flow view of the Analytical Engine.",
      },
    },
  ],
} satisfies ContextManifest;

const rankingManifest = {
  ...contextManifest,
  blocks: [
    {
      id: "ranking-one",
      kind: "chart",
      title: "Tournament ranking data",
      caption:
        "Points are listed for 13 ranked teams, led by Team 1 with 12 points.",
      longDescription:
        "The source ranking lists 13 teams in order. Team 1 is first with 12 points, followed by Team 2 with 11 points.",
      section: { index: "1", title: "Early life", anchor: "Early_life" },
      order: 1,
      sources: [source],
      provenance,
      chart: {
        columns: [
          { key: "position", label: "Position", dataType: "number" },
          { key: "group", label: "Group", dataType: "string" },
          { key: "team", label: "Team", dataType: "string" },
          { key: "played", label: "Played", dataType: "number" },
          { key: "won", label: "Won", dataType: "number" },
          { key: "drawn", label: "Drawn", dataType: "number" },
          { key: "lost", label: "Lost", dataType: "number" },
          { key: "goalsFor", label: "Goals for", dataType: "number" },
          { key: "goalsAgainst", label: "Goals against", dataType: "number" },
          { key: "goalDifference", label: "Goal difference", dataType: "number" },
          { key: "points", label: "Points", dataType: "number" },
          { key: "finalResult", label: "Final result", dataType: "string" },
        ],
        rows: Array.from({ length: 13 }, (_, index) => ({
          position: index + 1,
          group: String.fromCharCode(65 + (index % 12)),
          team: index === 7
            ? "A deliberately long national team name for reflow"
            : `Team ${index + 1}`,
          played: 4,
          won: Math.max(0, 4 - Math.floor(index / 4)),
          drawn: index % 2,
          lost: Math.floor(index / 5),
          goalsFor: Math.max(1, 12 - index),
          goalsAgainst: Math.floor(index / 2),
          goalDifference: 6 - index * 2,
          points: Math.max(0, 12 - index),
          finalResult: index < 4 ? "Semi-finals" : "Eliminated",
        })),
        series: [
          {
            id: "points",
            label: "Points",
            type: "bar",
            xColumn: "team",
            yColumn: "points",
          },
          {
            id: "goal-difference",
            label: "Goal difference",
            type: "bar",
            xColumn: "team",
            yColumn: "goalDifference",
          },
          {
            id: "won",
            label: "Won",
            type: "bar",
            xColumn: "team",
            yColumn: "won",
          },
          {
            id: "goals-for",
            label: "Goals for",
            type: "bar",
            xColumn: "team",
            yColumn: "goalsFor",
          },
        ],
        sourceChartType: "wikitable",
      },
    },
  ],
} satisfies ContextManifest;

const demographicChartManifest = {
  ...contextManifest,
  blocks: [
    {
      id: "demographic-chart",
      kind: "chart",
      title: "Population, share, and income by region",
      caption:
        "Population ranges from 100,000 to 1.5 million people across the listed regions.",
      longDescription:
        "The source table contains population counts, percentage shares, and median household income. Each measurement family is available on its own scale, and the exact table retains all source rows.",
      section: { index: "1", title: "Early life", anchor: "Early_life" },
      order: 1,
      sources: [source],
      provenance,
      chart: {
        columns: [
          { key: "region", label: "Region", dataType: "string" },
          { key: "population", label: "Population", dataType: "number", unit: "people" },
          { key: "workingAge", label: "Working-age population", dataType: "number", unit: "people" },
          { key: "share", label: "Share of world", dataType: "number", unit: "%" },
          { key: "income", label: "Median household income", dataType: "number", unit: "$" },
        ],
        rows: [
          { region: "World", population: 9_999_999, workingAge: 6_400_000, share: 100, income: 60_000 },
          ...Array.from({ length: 15 }, (_, index) => ({
            region: index === 14
              ? "A deliberately long regional name for narrow-screen reflow"
              : `Region ${index + 1}`,
            population: (index + 1) * 100_000,
            workingAge: (index + 1) * 64_000,
            share: Number(((index + 1) * 0.65).toFixed(2)),
            income: 42_000 + index * 1_500,
          })),
        ],
        series: [
          {
            id: "population",
            label: "Population",
            type: "bar",
            xColumn: "region",
            yColumn: "population",
            unit: "people",
          },
          {
            id: "share",
            label: "Share of world",
            type: "bar",
            xColumn: "region",
            yColumn: "share",
            unit: "%",
          },
          {
            id: "working-age",
            label: "Working-age population",
            type: "bar",
            xColumn: "region",
            yColumn: "workingAge",
            unit: "people",
          },
          {
            id: "income",
            label: "Median household income",
            type: "bar",
            xColumn: "region",
            yColumn: "income",
            unit: "$",
          },
        ],
        sourceChartType: "wikitable",
      },
    },
  ],
} satisfies ContextManifest;

const ordinalPositionManifest = {
  ...contextManifest,
  blocks: [
    {
      id: "song-chart-peaks",
      kind: "chart",
      title: 'Chart performance for "30 Days"',
      caption:
        "The song reached number 1 on Euro Digital Song Sales and number 13 in Ireland.",
      longDescription:
        "Four chart peaks are listed. Lower numbers indicate a higher chart position. The song reached number 1 on Euro Digital Song Sales, number 13 in Ireland, number 2 in Scotland, and number 7 in the United Kingdom.",
      section: { index: "1", title: "Early life", anchor: "Early_life" },
      order: 1,
      sources: [source],
      provenance,
      chart: {
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
      },
    },
  ],
} satisfies ContextManifest;

const expectNoSeriousAxeViolations = async (page: Page) => {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) =>
      violation.impact === "critical" || violation.impact === "serious",
  );
  expect(serious).toEqual([]);
};

const openDetailsWithKeyboard = async (page: Page, details: Locator) => {
  const summary = details.locator(":scope > summary");
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(details).toHaveJSProperty("open", true);
};

const mockArticleAndContext = async (
  page: Page,
  {
    mapStyleFailures = 0,
    mapStyleFailureDelayMs = 0,
    mapStyleSuccessDelayMs = 0,
    mapSourceFailures = 0,
    mapSourceFailureDelayMs = 0,
    mapSpriteFailure = false,
    manifest = contextManifest,
  }: {
    mapStyleFailures?: number;
    mapStyleFailureDelayMs?: number;
    mapStyleSuccessDelayMs?: number;
    mapSourceFailures?: number;
    mapSourceFailureDelayMs?: number;
    mapSpriteFailure?: boolean;
    manifest?: ContextManifest;
  } = {},
) => {
  let reportPayload: unknown = null;
  let mapStyleRequests = 0;
  let mapSourceRequests = 0;
  let mapTileRequests = 0;

  // Article audio may be warmed as the table of contents enters the viewport.
  // Keep that unrelated prefetch fully local to this context-focused spec.
  await page.route("**/api/tts", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "TTS is disabled in this browser fixture." }),
    }),
  );

  await page.route("https://map-tiles.test/context/*/tiles/**", (route) => {
    mapTileRequests += 1;
    return route.fulfill({
      contentType: "image/png",
      headers: { "access-control-allow-origin": "*" },
      body: tinyPng,
    });
  });

  await page.route("https://map-tiles.test/context/sprite**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({ error: "Map sprite unavailable in this fixture." }),
    }),
  );

  await page.route("https://map-tiles.test/context/*/source.json", async (route) => {
    mapSourceRequests += 1;
    if (mapSourceRequests <= mapSourceFailures) {
      if (mapSourceFailureDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, mapSourceFailureDelayMs));
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: "Map source metadata unavailable in this fixture." }),
      });
      return;
    }
    const styleName = new URL(route.request().url()).pathname.split("/").at(-2);
    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        tiles: [
          `https://map-tiles.test/context/${styleName}/tiles/{z}/{x}/{y}.png`,
        ],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 22,
      }),
    });
  });

  const handleMapStyle = async (route: Route) => {
    mapStyleRequests += 1;
    if (mapStyleRequests <= mapStyleFailures) {
      if (mapStyleFailureDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, mapStyleFailureDelayMs));
      }
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: "Map style unavailable in this fixture." }),
      });
      return;
    }
    if (mapStyleSuccessDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, mapStyleSuccessDelayMs));
    }
    const styleName = new URL(route.request().url()).pathname.split("/").at(-1);
    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        version: 8,
        sprite: mapSpriteFailure
          ? "https://map-tiles.test/context/sprite"
          : undefined,
        sources: {
          fixture: {
            type: "raster",
            url: `https://map-tiles.test/context/${styleName}/source.json`,
            tileSize: 256,
          },
        },
        layers: [
          {
            id: "fixture-background",
            type: "background",
            paint: { "background-color": "#45516e" },
          },
          { id: "fixture-tiles", type: "raster", source: "fixture" },
        ],
      }),
    });
  };
  await page.route("https://tiles.openfreemap.org/styles/liberty", handleMapStyle);
  await page.route("https://tiles.openfreemap.org/styles/fiord", handleMapStyle);

  await page.route("**/api/article-context/report", async (route) => {
    reportPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.route("**/api/article-context", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({
      wikiPageId: "974",
      title: "Ada Lovelace",
      revisionId: "123456789",
      language: "en",
    });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ context: manifest, cacheStatus: "miss" }),
    });
  });

  await page.route("https://upload.wikimedia.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: tinyPng }),
  );

  await page.route("https://commons.wikimedia.org/w/api.php**", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        query: {
          pages: {
            "1": {
              title: "File:Ada portrait.jpg",
              imageinfo: [
                {
                  descriptionurl:
                    "https://commons.wikimedia.org/wiki/File:Ada_portrait.jpg",
                  extmetadata: {
                    Artist: { value: "Alfred Edward Chalon" },
                    LicenseShortName: { value: "Public domain" },
                  },
                },
              ],
            },
          },
        },
      }),
    }),
  );

  await page.route("https://en.wikipedia.org/w/api.php**", async (route) => {
    const url = new URL(route.request().url());
    const prop = url.searchParams.get("prop") ?? "";

    if (prop.includes("imageinfo")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          query: {
            pages: {
              "1": {
                title: "File:Ada portrait.jpg",
                imageinfo: [
                  {
                    descriptionurl:
                      "https://commons.wikimedia.org/wiki/File:Ada_portrait.jpg",
                    extmetadata: {
                      Artist: { value: "Alfred Edward Chalon" },
                      LicenseShortName: { value: "Public domain" },
                    },
                  },
                ],
              },
            },
          },
        }),
      });
      return;
    }

    if (url.searchParams.get("action") === "parse") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          parse: {
            text: {
              "*": '<figure typeof="mw:File/Thumb"><a href="/wiki/File:Ada_portrait.jpg"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/330px-Ada_portrait.jpg" width="330" height="440" alt="Portrait of Ada Lovelace"></a><figcaption>Portrait of Ada Lovelace</figcaption></figure>',
            },
            sections: [],
          },
        }),
      });
      return;
    }

    if (url.searchParams.get("list") === "search") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ query: { search: [] } }),
      });
      return;
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        query: {
          pages: {
            "974": {
              pageid: 974,
              title: "Ada Lovelace",
              extract:
                "Ada Lovelace was an English mathematician and writer.\n\n== Early life ==\n\nShe developed an enduring interest in mathematics and machines.",
              revisions: [
                { revid: 123456789, timestamp: "2026-07-10T12:00:00Z" },
              ],
              thumbnail: {
                source:
                  "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/800px-Ada_portrait.jpg",
                width: 800,
                height: 1067,
              },
            },
          },
        },
      }),
    });
  });

  return {
    getReportPayload: () => reportPayload,
    getMapStyleRequests: () => mapStyleRequests,
    getMapTileRequests: () => mapTileRequests,
  };
};

test("article context exposes equivalent semantics, provenance, and reporting", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  const reports = await mockArticleAndContext(page, {
    mapStyleSuccessDelayMs: 500,
  });
  const darkStyleRequest = page.waitForRequest(
    "https://tiles.openfreemap.org/styles/fiord",
  );
  await page.goto("/article/Ada_Lovelace");

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Context that rewards a closer look",
    }),
  ).toBeVisible();
  await expect(page.locator("article.context-card")).toHaveCount(4);
  await expect(page.locator("#article-context-index")).toHaveCount(0);
  await expect(page.locator("details.context-explorer")).toHaveCount(0);

  const sectionLinks = page.locator("a.context-section-link");
  await expect(sectionLinks).toHaveCount(2);
  await expect(sectionLinks.nth(0)).toHaveAttribute(
    "href",
    "#article-context-map-journey",
  );
  await expect(sectionLinks.nth(0)).toHaveAccessibleName(
    "1 visual: jump to map: Places in the correspondence",
  );
  await expect(sectionLinks.nth(1)).toHaveAttribute(
    "href",
    "#article-context-timeline-engine",
  );
  await expect(sectionLinks.nth(1)).toHaveAccessibleName(
    "3 visuals: jump to timeline: Analytical Engine milestones, plus 2 more",
  );
  const mapCard = page.locator("#article-context-map-journey");
  await sectionLinks.nth(0).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#article-context-map-journey$/);
  await expect(mapCard).toBeFocused();

  await expect(mapCard).toHaveAttribute(
    "aria-describedby",
    "article-context-map-journey-caption article-context-map-journey-description",
  );
  await expect(
    mapCard.getByText(
      "The correspondence connects London, England, with Turin, Italy.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(mapCard.locator("#article-context-map-journey-description")).toHaveClass(
    /sr-only/,
  );
  await expect(mapCard.locator("#article-context-map-journey-description")).toContainText(
    "The map begins in London and follows a southeast route to Turin.",
  );
  expect(
    await mapCard.evaluate((card) => {
      const visual = card.querySelector("#map-journey-map-view");
      const caption = card.querySelector("#article-context-map-journey-caption");
      const places = card.querySelector("#map-journey-places-heading");
      return Boolean(
        visual &&
          caption &&
          places &&
          (visual.compareDocumentPosition(caption) &
            Node.DOCUMENT_POSITION_FOLLOWING) &&
          (caption.compareDocumentPosition(places) &
            Node.DOCUMENT_POSITION_FOLLOWING),
      );
    }),
  ).toBe(true);
  await expect(mapCard.getByRole("button", { name: /listen/i })).toHaveCount(0);
  await expect(mapCard.locator("audio")).toHaveCount(0);
  const mapDataDisclosure = mapCard.locator("details.context-data-disclosure");
  const mapDataSummary = mapDataDisclosure.locator(":scope > summary");
  await expect(mapDataDisclosure).toHaveJSProperty("open", false);
  await expect(mapDataSummary).toContainText("Exact map data");
  await expect(mapDataSummary).toContainText("2 places, 1 route, 1 area");
  await expect(mapCard.getByText("Latitude 51.5074, longitude -0.1278")).toBeHidden();
  await openDetailsWithKeyboard(page, mapDataDisclosure);
  await expect(mapDataSummary).toBeFocused();
  await expect(mapCard.getByRole("list").first()).toContainText("London");
  await expect(mapCard.getByText("Latitude 51.5074, longitude -0.1278")).toBeVisible();
  await expect(mapCard.getByRole("heading", { name: "Routes" })).toBeVisible();
  await expect(mapCard.getByText("Correspondence route")).toBeVisible();
  await expect(mapCard.getByRole("heading", { name: "Areas" })).toBeVisible();
  const showSchematicButton = mapCard.getByRole("button", {
    name: "Show coordinate overview",
  });
  const schematic = mapCard.locator(".context-map-schematic");
  await expect(schematic).toHaveCount(0);
  await expect(mapCard.locator(".context-interactive-map")).toBeVisible();
  await darkStyleRequest;
  await expect.poll(reports.getMapStyleRequests).toBeGreaterThan(0);
  const interactiveStatus = mapCard
    .locator(".context-interactive-map")
    .locator(".context-status");
  await expect(interactiveStatus).toHaveText("Loading interactive map");
  await expect(mapCard.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  await expect(interactiveStatus).toHaveText("Interactive map ready");
  await expect.poll(reports.getMapTileRequests).toBeGreaterThan(0);
  await expect(
    mapCard.locator(".context-map-surface"),
  ).toBeVisible();
  await expect(mapCard.locator(".context-map-surface")).toHaveAttribute(
    "aria-label",
    "Interactive street map for Places in the correspondence",
  );
  await expect(
    mapCard.locator('canvas[aria-label="Interactive street map for Places in the correspondence"]'),
  ).toHaveAttribute(
    "aria-describedby",
    "article-context-map-journey-caption article-context-map-journey-description",
  );
  await expect(mapCard.getByRole("button", { name: "Zoom in" })).toBeEnabled();

  const londonButton = mapCard.getByRole("button", { name: "London" });
  await londonButton.focus();
  await page.keyboard.press("Enter");
  await expect(interactiveStatus).toHaveText("Centered map on London");

  const resetMapButton = mapCard.getByRole("button", { name: "Reset map" });
  await resetMapButton.focus();
  await page.keyboard.press("Enter");
  await expect(resetMapButton).toBeFocused();
  await expect(interactiveStatus).toHaveText(
    "Map view reset to show all mapped features",
  );

  await showSchematicButton.focus();
  await page.keyboard.press("Enter");
  const showMapButton = mapCard.getByRole("button", {
    name: "Show interactive street map",
  });
  await expect(showMapButton).toBeFocused();
  await expect(mapCard.locator(".context-interactive-map")).toHaveCount(0);
  await expect(schematic).toBeVisible();
  await expect(mapCard.getByText(/This coordinate overview is not a street map/)).toBeVisible();
  await expect(schematic.locator(".context-map-marker")).toHaveCount(2);

  await showMapButton.focus();
  await page.keyboard.press("Enter");
  await expect(showSchematicButton).toBeFocused();
  await expect(schematic).toHaveCount(0);
  await expect(interactiveStatus).toHaveText("Interactive map ready");
  const mapCanvas = mapCard.locator(
    'canvas[aria-label="Interactive street map for Places in the correspondence"]',
  );
  await mapCanvas.evaluate((canvas) => canvas.setAttribute("data-map-attempt", "dark"));
  const darkTileCount = reports.getMapTileRequests();

  const lightStyleRequest = page.waitForRequest(
    "https://tiles.openfreemap.org/styles/liberty",
  );
  const switchToLightTheme = page.locator(
    'button[aria-label="Switch to light theme"]:visible',
  );
  await switchToLightTheme.focus();
  await page.keyboard.press("Enter");
  await lightStyleRequest;
  await expect(interactiveStatus).toHaveText("Loading interactive map");
  await expect(mapCard.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  await expect(mapCard.locator('canvas[data-map-attempt="dark"]')).toHaveCount(0);
  await expect.poll(reports.getMapTileRequests).toBeGreaterThan(darkTileCount);
  await expect(
    page.locator('button[aria-label="Switch to dark theme"]:visible'),
  ).toBeVisible();
  await expect(interactiveStatus).toHaveText("Interactive map ready");
  await expect(mapCard.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  await expect(schematic).toHaveCount(0);

  const timelineCard = page.locator("#article-context-timeline-engine");
  await timelineCard.scrollIntoViewIfNeeded();
  await expect(
    timelineCard.getByText(
      "Babbage proposed the Analytical Engine in 1837, followed by Lovelace's published notes in 1843.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(timelineCard.locator('time[datetime="1837"]')).toHaveText("1837");
  await expect(timelineCard.locator('time[datetime="1843"]')).toHaveText("1843");
  await expect(timelineCard.getByRole("listitem")).toHaveCount(2);
  await timelineCard.getByRole("button", { name: "Newest first" }).focus();
  await page.keyboard.press("Enter");
  await expect(timelineCard.getByRole("status")).toHaveText(
    "2 events, newest first",
  );
  await expect(timelineCard.locator("ol.context-timeline-list > li").first()).toContainText(
    "1843",
  );

  const chartCard = page.locator("#article-context-chart-note-length");
  await chartCard.scrollIntoViewIfNeeded();
  await expect(chartCard.locator(".context-echarts")).toBeVisible();
  await expect(chartCard.locator(".context-echarts svg")).toBeVisible();
  const dataTable = chartCard.getByRole("table", {
    name: "Exact data for Notes compared with the source article",
  });
  const chartDataDisclosure = chartCard.locator("details.context-data-disclosure");
  const chartDataSummary = chartDataDisclosure.locator(":scope > summary");
  await expect(chartDataDisclosure).toHaveJSProperty("open", false);
  await expect(chartDataSummary).toContainText("Exact chart data");
  await expect(chartDataSummary).toContainText("2 rows, 2 columns");
  await expect(dataTable).toBeHidden();
  await chartDataSummary.focus();
  await page.keyboard.press("Space");
  await expect(chartDataDisclosure).toHaveJSProperty("open", true);
  await expect(chartDataSummary).toBeFocused();
  await expect(dataTable.getByRole("columnheader")).toHaveCount(2);
  await expect(dataTable.getByRole("rowheader", { name: "Source article" })).toBeVisible();
  await expect(dataTable.getByRole("cell", { name: "20" })).toBeVisible();

  const diagramCard = page.locator("#article-context-diagram-engine");
  await diagramCard.scrollIntoViewIfNeeded();
  await expect(diagramCard).toHaveAttribute(
    "aria-describedby",
    "article-context-diagram-engine-caption article-context-diagram-engine-description",
  );
  await expect(
    diagramCard.getByRole("img", {
      name: "Diagram showing punched cards feeding the mill, which sends results to a printer.",
    }),
  ).toBeVisible();
  await expect(diagramCard.getByRole("heading", { name: "Named parts" })).toBeVisible();
  await expect(
    diagramCard.locator("dl.context-parts-list dt", { hasText: "Punched cards" }),
  ).toBeVisible();
  await expect(diagramCard.getByText(/Punched cards feed instructions into Mill/)).toBeVisible();
  await expect(diagramCard.getByRole("heading", { name: "Walkthrough" })).toBeVisible();

  const contextLane = page.locator("section.context-lane");
  await expect(contextLane.getByRole("button", { name: /listen/i })).toHaveCount(0);
  const gallery = page.getByRole("heading", { name: "Gallery" }).locator("..");
  await expect(gallery).toBeVisible();
  const [contextBox, galleryBox] = await Promise.all([
    contextLane.boundingBox(),
    gallery.boundingBox(),
  ]);
  expect(contextBox).not.toBeNull();
  expect(galleryBox).not.toBeNull();
  expect(Math.abs((contextBox?.x ?? 0) - (galleryBox?.x ?? 0))).toBeLessThanOrEqual(1);
  expect(Math.abs((contextBox?.width ?? 0) - (galleryBox?.width ?? 0))).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => {
      const lane = document.querySelector("section.context-lane");
      const galleryHeading = document.querySelector("#gallery-heading");
      return Boolean(
        lane &&
          galleryHeading &&
          lane.nextElementSibling?.contains(galleryHeading),
      );
    }),
  ).toBe(true);

  const provenanceDetails = mapCard.locator("details.context-sources");
  await openDetailsWithKeyboard(page, provenanceDetails);
  await expect(provenanceDetails).toContainText(
    "AI-assisted from cited source material",
  );
  await expect(provenanceDetails).toContainText("Model: gpt-5.6-luna");
  await expect(
    provenanceDetails.getByRole("link", { name: /Open the exact article revision/ }),
  ).toHaveAttribute("href", provenance.articleRevisionUrl);

  const reportDetails = mapCard.locator("details.context-report");
  await openDetailsWithKeyboard(page, reportDetails);
  await reportDetails.getByLabel("What went wrong?").selectOption("inaccessible");
  await reportDetails
    .getByLabel("Details (optional)")
    .fill("The place sequence is difficult to follow with keyboard navigation.");
  await reportDetails.getByRole("button", { name: "Send report" }).click();
  await expect(reportDetails.getByRole("status")).toHaveText(
    "Thank you. The context note was reported.",
  );
  expect(reports.getReportPayload()).toMatchObject({
    wikiPageId: "974",
    revisionId: "123456789",
    blockId: "map-journey",
    reason: "inaccessible",
    details: "The place sequence is difficult to follow with keyboard navigation.",
  });

  await expectNoSeriousAxeViolations(page);
});

test("article map falls back accessibly and can retry after a style failure", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockArticleAndContext(page, {
    mapStyleFailures: 1,
    mapStyleFailureDelayMs: 1_000,
  });
  await page.goto("/article/Ada_Lovelace");

  const mapCard = page.locator("#article-context-map-journey");
  const failureStatus = mapCard.locator(".context-map-failure-status");
  await expect(failureStatus).toHaveText("");
  await mapCard.scrollIntoViewIfNeeded();
  const mapCanvas = mapCard.locator(
    'canvas[aria-label="Interactive street map for Places in the correspondence"]',
  );
  await expect(mapCanvas).toBeVisible();
  await mapCanvas.focus();
  await expect(mapCanvas).toBeFocused();

  await expect(mapCard.getByText("Street map unavailable", { exact: true })).toBeVisible();
  await expect(failureStatus).toHaveText(
    "Street map unavailable. The coordinate overview is shown instead. Exact place, route, and area information is available in the expandable map data below.",
  );
  await expect(mapCard.locator(".context-map-schematic")).toBeVisible();
  const retryButton = mapCard.getByRole("button", {
    name: "Retry interactive street map",
  });
  await expect(retryButton).toBeFocused();
  await page.keyboard.press("Enter");

  const showSchematicButton = mapCard.getByRole("button", {
    name: "Show coordinate overview",
  });
  await expect(showSchematicButton).toBeFocused();
  await expect(mapCard.locator(".context-map-schematic")).toHaveCount(0);
  await expect(
    mapCard.locator(".context-interactive-map .context-status"),
  ).toHaveText("Interactive map ready");
  await expect(failureStatus).toHaveText("");
  await expect(
    mapCard.locator(".context-map-surface"),
  ).toBeVisible();
});

test("article map falls back when its source metadata cannot load", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockArticleAndContext(page, { mapSourceFailures: 1 });
  await page.goto("/article/Ada_Lovelace");

  const mapCard = page.locator("#article-context-map-journey");
  await mapCard.scrollIntoViewIfNeeded();

  await expect(mapCard.getByText("Street map unavailable", { exact: true })).toBeVisible();
  await expect(mapCard.locator(".context-map-failure-status")).toContainText(
    "Street map unavailable",
  );
  await expect(mapCard.locator(".context-map-schematic")).toBeVisible();
  await mapCard
    .getByRole("button", { name: "Retry interactive street map" })
    .click();

  await expect(
    mapCard.locator(".context-interactive-map .context-status"),
  ).toHaveText("Interactive map ready");
  await expect(mapCard.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  await expect(mapCard.locator(".context-map-schematic")).toHaveCount(0);
});

test("article map remains usable when decorative sprite resources fail", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockArticleAndContext(page, { mapSpriteFailure: true });
  await page.goto("/article/Ada_Lovelace");

  const mapCard = page.locator("#article-context-map-journey");
  await mapCard.scrollIntoViewIfNeeded();

  await expect(
    mapCard.locator(".context-interactive-map .context-status"),
  ).toHaveText(
    "Some map details could not load. Exact place, route, and area information is available in the expandable map data below.",
  );
  await expect(mapCard.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  await expect(mapCard.locator(".context-interactive-map")).toBeVisible();
  await expect(mapCard.locator(".context-map-schematic")).toHaveCount(0);
  await expect(mapCard.locator(".context-map-failure-status")).toHaveText("");
});

test("rich visuals initialize without IntersectionObserver or a disclosure click", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "IntersectionObserver", {
      configurable: true,
      value: undefined,
    });
  });
  await mockArticleAndContext(page);
  const mapStyleRequest = page.waitForRequest(
    "https://tiles.openfreemap.org/styles/liberty",
  );

  await page.goto("/article/Ada_Lovelace");
  await mapStyleRequest;

  await expect(
    page.locator(
      "#article-context-map-journey .context-interactive-map .context-status",
    ),
  ).toHaveText("Interactive map ready");
  await expect(
    page.locator("#article-context-chart-note-length .context-echarts svg"),
  ).toBeAttached();
  await expect(
    page.locator("details.context-data-disclosure"),
  ).toHaveCount(2);
  expect(
    await page
      .locator("details.context-data-disclosure")
      .evaluateAll((details) =>
        details.every((detail) => !(detail as HTMLDetailsElement).open),
      ),
  ).toBe(true);
  await expect(page.locator("details.context-explorer")).toHaveCount(0);
});

test("ranked chart data renders as a compact, keyboard-accessible bar overview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await mockArticleAndContext(page, { manifest: rankingManifest });
  await page.goto("/article/Ada_Lovelace");

  const card = page.locator("#article-context-ranking-one");
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole("heading", { name: "Tournament ranking data" })).toBeVisible();
  const rankingList = card.getByRole("list", {
    name: "Points for the first 8 published entries in Tournament ranking data",
  });
  await expect(rankingList.locator(":scope > li")).toHaveCount(8);
  const visibleTeamNames = rankingList.locator(".context-ranking-entry strong");
  await expect(visibleTeamNames.first()).toContainText("Team 1");
  await expect(visibleTeamNames.last()).toContainText(
    "A deliberately long national team name for reflow",
  );
  await expect(visibleTeamNames).toHaveCount(8);
  const firstRankingItem = rankingList.locator(":scope > li").first();
  const firstRankingSnapshot = await firstRankingItem.ariaSnapshot();
  expect(firstRankingSnapshot).toContain("Position: 1");
  expect(firstRankingSnapshot).toContain("Team: Team 1");
  expect(firstRankingSnapshot).toContain("Final result: Semi-finals");
  expect(firstRankingSnapshot).toContain("Points:");
  expect(firstRankingSnapshot).toContain('strong: "12"');
  await expect(rankingList.locator(".context-ranked-bar-track")).toHaveCount(8);
  await expect(rankingList.locator(".context-ranked-bar-track").first()).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  await expect(
    card.getByText(
      "The overview pictures the first 8 of 13 published entries in source ranking order. Expand Exact chart data for all 13.",
      { exact: true },
    ),
  ).toBeVisible();
  const metricControls = card.getByRole("group", {
    name: "Metrics shown in the ranking overview",
  });
  await expect(metricControls.getByRole("checkbox")).toHaveCount(4);
  const pointsCheckbox = metricControls.getByRole("checkbox", { name: "Points" });
  const goalDifferenceCheckbox = metricControls.getByRole("checkbox", {
    name: "Goal difference",
  });
  await expect(pointsCheckbox).toBeChecked();
  await expect(pointsCheckbox).toBeDisabled();
  await expect(goalDifferenceCheckbox).not.toBeChecked();
  await goalDifferenceCheckbox.focus();
  await page.keyboard.press("Space");
  await expect(goalDifferenceCheckbox).toBeChecked();
  await expect(pointsCheckbox).toBeEnabled();
  await expect(card.getByRole("status")).toHaveText(
    "Points and Goal difference shown. Each metric uses its own scale with a visible zero baseline.",
  );
  const goalDifferenceList = card.getByRole("list", {
    name: "Goal difference for the first 8 published entries in Tournament ranking data",
  });
  await expect(goalDifferenceList.locator(":scope > li")).toHaveCount(8);
  expect(await goalDifferenceList.locator(".context-ranked-bar-fill-negative").count()).toBeGreaterThan(0);
  await pointsCheckbox.focus();
  await page.keyboard.press("Space");
  await expect(pointsCheckbox).not.toBeChecked();
  await expect(goalDifferenceCheckbox).toBeDisabled();
  await expect(card.getByRole("status")).toHaveText(
    "Goal difference shown. Each metric uses its own scale with a visible zero baseline.",
  );
  await expect(rankingList).toHaveCount(0);
  await expect(card.locator(".context-echarts")).toHaveCount(0);

  const exactData = card.locator("details.context-data-disclosure");
  await expect(exactData).toHaveJSProperty("open", false);
  const exactDataSummary = exactData.locator(":scope > summary");
  await exactDataSummary.focus();
  await expect(exactDataSummary).toBeFocused();
  await page.keyboard.press("Space");
  await expect(exactData).toHaveJSProperty("open", true);
  await expect(exactDataSummary).toBeFocused();

  const table = card.getByRole("table", {
    name: "Exact data for Tournament ranking data",
  });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveCount(12);
  await expect(table.getByRole("rowheader")).toHaveCount(13);
  await expect(table.getByRole("rowheader").first()).toHaveText("Team 1");
  await expect(table.locator("tbody tr").first().locator("td").first()).toHaveText("1");

  const tableScroller = card.locator(".context-table-wrap");
  expect(
    await tableScroller.evaluate(
      (tableScroller) => tableScroller.scrollWidth > tableScroller.clientWidth,
    ),
  ).toBe(true);
  await tableScroller.focus();
  await expect(tableScroller).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => tableScroller.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await expectNoSeriousAxeViolations(page);
});

test("mixed-unit demographic charts use separate scales and a bounded overview", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await mockArticleAndContext(page, { manifest: demographicChartManifest });
  await page.goto("/article/Ada_Lovelace");

  const card = page.locator("#article-context-demographic-chart");
  await card.scrollIntoViewIfNeeded();
  const controls = card.getByRole("group", {
    name: "Series shown in the visual overview",
  });
  await expect(controls.getByRole("checkbox")).toHaveCount(4);
  const population = controls.getByRole("checkbox", {
    name: "Population (people)",
    exact: true,
  });
  const workingAge = controls.getByRole("checkbox", {
    name: "Working-age population (people)",
    exact: true,
  });
  const share = controls.getByRole("checkbox", {
    name: "Share of world (%)",
    exact: true,
  });
  await expect(population).toBeChecked();
  await expect(population).toBeEnabled();
  await expect(workingAge).toBeChecked();
  await expect(workingAge).toBeEnabled();
  await expect(share).not.toBeChecked();
  await expect(card.locator(".context-standard-chart-panel")).toHaveCount(1);
  await expect(card.getByRole("heading", { name: "Counts (people)" })).toBeVisible();
  const mobileBars = card.locator(".context-mobile-category-bars").first();
  await mobileBars.scrollIntoViewIfNeeded();
  await expect(mobileBars).toBeVisible();
  await expect(card.locator(".context-echarts").first()).toBeHidden();
  await expect(mobileBars.getByRole("listitem")).toHaveCount(12);
  const firstCategory = mobileBars.getByRole("listitem").first();
  await expect(firstCategory).toContainText(
    "A deliberately long regional name for narrow-screen reflow",
  );
  await expect(firstCategory).toContainText("Population1,500,000 people");
  await expect(firstCategory).toContainText(
    "Working-age population960,000 people",
  );
  await expect(mobileBars.locator(".context-mobile-bar-track")).toHaveCount(24);
  expect(
    (await mobileBars.locator(".context-mobile-bar-track").first().boundingBox())?.width ?? 0,
  ).toBeGreaterThan(240);
  await expect(
    card.getByText(
      "Showing the top 12 of 15 categories by Population; 3 more remain in Exact chart data. 1 aggregate row kept in Exact chart data.",
      { exact: true },
    ),
  ).toBeVisible();

  await share.focus();
  await page.keyboard.press("Space");
  await expect(share).toBeChecked();
  await expect(population).toBeEnabled();
  await expect(card.locator(".context-standard-chart-panel")).toHaveCount(2);
  await expect(card.getByRole("heading", { name: "Percent (%)" })).toBeVisible();
  await expect(card.locator(".context-mobile-category-bars")).toHaveCount(2);
  await expect(card.getByRole("status")).toHaveText(
    "Population, Working-age population, and Share of world shown across 2 separate scales.",
  );

  await workingAge.focus();
  await page.keyboard.press("Space");
  await expect(workingAge).not.toBeChecked();
  await population.focus();
  await page.keyboard.press("Space");
  await expect(population).not.toBeChecked();
  await expect(share).toBeDisabled();
  await expect(card.locator(".context-standard-chart-panel")).toHaveCount(1);
  await expect(card.getByRole("heading", { name: "Counts (people)" })).toHaveCount(0);
  await expect(card.locator(".context-mobile-category-bars")).toHaveCount(1);
  await expect(card.getByRole("status")).toHaveText(
    "Share of world shown on one compatible scale.",
  );
  await expect(
    card.getByText(
      "Showing the top 12 of 15 categories by Share of world; 3 more remain in Exact chart data. 1 aggregate row kept in Exact chart data.",
      { exact: true },
    ),
  ).toBeVisible();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

  await page.setViewportSize({ width: 900, height: 760 });
  await expect(card.locator(".context-mobile-category-bars")).toBeHidden();
  const desktopChart = card.locator(".context-echarts").first();
  await expect(desktopChart.locator("svg")).toBeVisible();
  const desktopSurface = card.locator(".context-echarts-surface").first();
  await expect(desktopSurface).toHaveAttribute("aria-busy", "false");
  await desktopSurface.evaluate((surface) => {
    const testWindow = window as typeof window & {
      __contextChartBusyObserver?: MutationObserver;
      __contextChartBusyStates?: string[];
    };
    testWindow.__contextChartBusyStates = [];
    testWindow.__contextChartBusyObserver = new MutationObserver(() => {
      testWindow.__contextChartBusyStates?.push(
        surface.getAttribute("aria-busy") ?? "missing",
      );
    });
    testWindow.__contextChartBusyObserver.observe(surface, {
      attributeFilter: ["aria-busy"],
    });
  });
  expect(
    await desktopChart.locator("svg").evaluate((svg) =>
      Array.from(svg.querySelectorAll("path, rect")).every(
        (mark) => getComputedStyle(mark).cursor !== "pointer",
      ),
    ),
  ).toBe(true);

  await page.setViewportSize({ width: 320, height: 760 });
  await expect(card.locator(".context-mobile-category-bars")).toBeVisible();

  await page.setViewportSize({ width: 900, height: 760 });
  await expect(desktopChart.locator("svg")).toBeVisible();
  await expect(desktopSurface).toHaveAttribute("aria-busy", "false");
  expect(
    await page.evaluate(() => {
      const testWindow = window as typeof window & {
        __contextChartBusyStates?: string[];
      };
      return testWindow.__contextChartBusyStates;
    }),
  ).toEqual(["true", "false"]);

  await page.setViewportSize({ width: 320, height: 760 });
  await expect(card.locator(".context-mobile-category-bars")).toBeVisible();

  const exactData = card.locator("details.context-data-disclosure");
  await expect(exactData).toHaveJSProperty("open", false);
  const exactDataSummary = exactData.locator(":scope > summary");
  await exactDataSummary.focus();
  await page.keyboard.press("Enter");
  await expect(exactData).toHaveJSProperty("open", true);
  const table = card.getByRole("table", {
    name: "Exact data for Population, share, and income by region",
  });
  await expect(table.getByRole("rowheader")).toHaveCount(16);
  await expect(table.getByRole("rowheader", { name: "World" })).toBeVisible();
  await expect(table.getByRole("columnheader")).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await expectNoSeriousAxeViolations(page);
});

test("ordinal chart peaks use exact positions rather than proportional bars", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await mockArticleAndContext(page, { manifest: ordinalPositionManifest });
  await page.goto("/article/Ada_Lovelace");

  const card = page.locator("#article-context-song-chart-peaks");
  await card.scrollIntoViewIfNeeded();
  await expect(
    card.getByText(
      "Lower numbers indicate a higher position; No. 1 is the highest.",
      { exact: true },
    ),
  ).toBeVisible();
  const results = card.locator("dl.context-ordinal-position-list");
  await expect(results.locator(":scope > div")).toHaveCount(4);
  await expect(results.locator("dt").first()).toHaveText(
    "Euro Digital Song Sales (Billboard)",
  );
  await expect(results.locator("dd").first()).toContainText("No. 1");
  await expect(results.locator("dd").nth(1)).toContainText("No. 13");
  await expect(results.locator("dd").nth(2)).toContainText("No. 2");
  await expect(results.locator("dd").nth(3)).toContainText("No. 7");
  await expect(card.locator(".context-echarts")).toHaveCount(0);
  await expect(card.locator(".context-mobile-bar-track")).toHaveCount(0);

  const exactData = card.locator("details.context-data-disclosure");
  const exactDataSummary = exactData.locator(":scope > summary");
  await expect(exactData).toHaveJSProperty("open", false);
  await exactDataSummary.focus();
  await page.keyboard.press("Enter");
  await expect(exactData).toHaveJSProperty("open", true);
  const table = card.getByRole("table", {
    name: 'Exact data for Chart performance for "30 Days"',
  });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row", {
    name: "Euro Digital Song Sales (Billboard) 1",
  })).toBeVisible();
  await expect(table.getByRole("row", { name: "Ireland (IRMA) 13" })).toBeVisible();
  await expect(table.getByRole("row", {
    name: "Scotland Singles (Official Charts) 2",
  })).toBeVisible();
  await expect(table.getByRole("row", {
    name: "UK Singles (Official Charts) 7",
  })).toBeVisible();

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);

  const mobileCards = await results.locator(":scope > div").evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect()),
  );
  expect(new Set(mobileCards.map((rect) => Math.round(rect.left))).size).toBe(1);
  await expectNoSeriousAxeViolations(page);

  await page.setViewportSize({ width: 900, height: 760 });
  const desktopCards = await results.locator(":scope > div").evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect()),
  );
  expect(new Set(desktopCards.map((rect) => Math.round(rect.left))).size).toBe(2);
  await expectNoSeriousAxeViolations(page);
});

test("an article with no visual context leaves no empty lane or spacer", async ({
  page,
}) => {
  const emptyManifest: ContextManifest = {
    ...contextManifest,
    blocks: [],
  };
  await mockArticleAndContext(page, { manifest: emptyManifest });
  const contextResponse = page.waitForResponse("**/api/article-context");

  await page.goto("/article/Ada_Lovelace");
  await contextResponse;
  await expect(page.getByRole("heading", { name: "Gallery" })).toBeVisible();

  await expect(page.locator("section.context-lane")).toHaveCount(0);
  await expect(page.locator("a.context-section-link")).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const tableOfContentsShell =
        document.querySelector(".toc-section")?.parentElement;
      const galleryHeading = document.querySelector("#gallery-heading");
      return Boolean(
        tableOfContentsShell &&
          galleryHeading &&
          tableOfContentsShell.nextElementSibling?.contains(galleryHeading),
      );
    }),
  ).toBe(true);
});

test("a hero and Gallery image do not receive a third Context diagram copy", async ({
  page,
}) => {
  const sourceDiagram = contextManifest.blocks.find(
    (block) => block.kind === "diagram",
  );
  expect(sourceDiagram?.kind).toBe("diagram");
  if (!sourceDiagram || sourceDiagram.kind !== "diagram") return;

  const duplicateManifest: ContextManifest = {
    ...contextManifest,
    blocks: [
      {
        ...sourceDiagram,
        diagram: {
          ...sourceDiagram.diagram,
          image: {
            ...sourceDiagram.diagram.image,
            src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/500px-Ada_portrait.jpg",
            width: 500,
            height: 667,
          },
        },
      },
    ],
  };
  await mockArticleAndContext(page, { manifest: duplicateManifest });
  const contextResponse = page.waitForResponse("**/api/article-context");

  await page.goto("/article/Ada_Lovelace");
  await contextResponse;

  await expect(
    page.getByRole("button", { name: "View full image for Ada Lovelace" }),
  ).toBeVisible();
  const gallery = page.getByRole("heading", { name: "Gallery" }).locator("..");
  await expect(gallery).toBeVisible();
  await expect(
    gallery.getByRole("button", { name: /Open image 1 of 1: Portrait of Ada Lovelace/ }),
  ).toBeVisible();
  await expect(page.locator("#article-context-diagram-engine")).toHaveCount(0);
  await expect(page.locator("section.context-lane")).toHaveCount(0);
  await expect(page.locator("a.context-section-link")).toHaveCount(0);
});

test("visual context remains usable at 200 percent zoom with forced colors", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await page.emulateMedia({ forcedColors: "active" });
  await mockArticleAndContext(page);
  await page.goto("/article/Ada_Lovelace");
  await page.evaluate(() => {
    document.documentElement.style.setProperty("zoom", "2");
  });

  const mapCard = page.locator("#article-context-map-journey");
  await mapCard.scrollIntoViewIfNeeded();
  await expect(
    mapCard.getByText(
      "The correspondence connects London, England, with Turin, Italy.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(mapCard.getByRole("button", { name: "Show coordinate overview" })).toBeVisible();
  await openDetailsWithKeyboard(
    page,
    mapCard.locator("details.context-data-disclosure"),
  );
  await expect(mapCard.getByText("Latitude 51.5074, longitude -0.1278")).toBeVisible();

  const chartCard = page.locator("#article-context-chart-note-length");
  await chartCard.scrollIntoViewIfNeeded();
  await openDetailsWithKeyboard(
    page,
    chartCard.locator("details.context-data-disclosure"),
  );
  await expect(
    chartCard.getByRole("table", {
      name: "Exact data for Notes compared with the source article",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("article context reflows at a narrow viewport and honors reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockArticleAndContext(page);
  await page.goto("/article/Ada_Lovelace");

  await expect(page.locator("article.context-card")).toHaveCount(4);
  const tocRows = page.locator(".toc-row");
  expect(await tocRows.count()).toBeGreaterThan(0);
  const tocRowLayoutViolations = await tocRows.evaluateAll(
    (rows) =>
      rows.flatMap((row, index) => {
        const copy = row.children.item(0);
        const action = row.children.item(1);
        if (!(copy instanceof HTMLElement) || !(action instanceof HTMLElement)) {
          return [];
        }
        const copyRect = copy.getBoundingClientRect();
        const actionRect = action.getBoundingClientRect();
        return copyRect.bottom <= actionRect.top + 0.5
          ? []
          : [{
              index,
              copyBottom: copyRect.bottom,
              actionTop: actionRect.top,
              text: row.textContent?.replace(/\s+/g, " ").trim(),
            }];
      }),
  );
  expect(tocRowLayoutViolations).toEqual([]);
  const diagramCard = page.locator("#article-context-diagram-engine");
  await diagramCard.scrollIntoViewIfNeeded();
  const zoomIn = diagramCard.getByRole("button", { name: "Zoom in" });
  await zoomIn.focus();
  await page.keyboard.press("Enter");
  await expect(diagramCard.getByText("125 percent")).toBeVisible();

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBe(320);
  await expectNoSeriousAxeViolations(page);
});
