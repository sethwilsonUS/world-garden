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
  extractorVersion: "1.0.0",
  descriptionMethod: "ai-assisted" as const,
  model: "gpt-5.6-luna",
  promptVersion: "article-context-v1",
};

const contextManifest = {
  schemaVersion: 1,
  wikiPageId: "974",
  title: "Ada Lovelace",
  revisionId: "123456789",
  language: "en",
  sourceHash: "manifest-source-hash",
  extractorVersion: "1.0.0",
  generatedAt: "2026-07-13T00:00:00.000Z",
  blocks: [
    {
      id: "map-journey",
      kind: "map",
      title: "Places in the correspondence",
      takeaway: "The two places show the physical distance crossed by the correspondence.",
      spokenSummary:
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
      takeaway: "The sequence connects Babbage's proposal with Lovelace's published notes.",
      spokenSummary:
        "Charles Babbage proposed the Analytical Engine in 1837, and Ada Lovelace published her notes in 1843.",
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
      takeaway: "The notes are longer than the article they accompany.",
      spokenSummary:
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
      takeaway: "Input cards feed instructions into the mill before results are printed.",
      spokenSummary:
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
  }: {
    mapStyleFailures?: number;
    mapStyleFailureDelayMs?: number;
    mapStyleSuccessDelayMs?: number;
    mapSourceFailures?: number;
    mapSourceFailureDelayMs?: number;
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
      body: JSON.stringify({ context: contextManifest, cacheStatus: "miss" }),
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
  await page.goto("/article/Ada_Lovelace");

  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Context that rewards a closer look",
    }),
  ).toBeVisible();
  await expect(page.locator("article.context-card")).toHaveCount(4);

  const contextIndex = page.locator("#article-context-index");
  await openDetailsWithKeyboard(page, contextIndex);
  const contextNav = page.getByRole("navigation", {
    name: "Context notes in this article",
  });
  await expect(contextNav.getByRole("listitem")).toHaveCount(4);
  const mapIndexLink = contextNav.getByRole("link", {
    name: /Places in the correspondence/,
  });
  await mapIndexLink.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#article-context-map-journey$/);

  const sectionLinks = page.locator("a.context-section-link");
  await expect(sectionLinks).toHaveCount(2);
  await expect(sectionLinks.nth(0)).toHaveAttribute(
    "href",
    "#article-context-map-journey",
  );
  await expect(sectionLinks.nth(1)).toHaveAttribute(
    "href",
    "#article-context-timeline-engine",
  );

  const mapCard = page.locator("#article-context-map-journey");
  const darkStyleRequest = page.waitForRequest(
    "https://tiles.openfreemap.org/styles/fiord",
  );
  await openDetailsWithKeyboard(page, mapCard.locator("details.context-explorer"));
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
  const interactiveStatus = mapCard
    .locator(".context-interactive-map")
    .getByRole("status");
  await expect(interactiveStatus).toHaveText("Loading interactive map");
  await expect(mapCard.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  await expect(interactiveStatus).toHaveText("Interactive map ready");
  await expect.poll(reports.getMapTileRequests).toBeGreaterThan(0);
  await expect(
    mapCard.getByRole("region", {
      name: "Interactive street map for Places in the correspondence",
    }),
  ).toBeVisible();
  await expect(
    mapCard.locator('canvas[aria-label="Interactive street map for Places in the correspondence"]'),
  ).toBeVisible();
  await expect(mapCard.getByRole("button", { name: "Zoom in" })).toBeEnabled();

  await showSchematicButton.focus();
  await page.keyboard.press("Enter");
  const showMapButton = mapCard.getByRole("button", {
    name: "Show interactive street map",
  });
  await expect(showMapButton).toBeFocused();
  await expect(mapCard.locator(".context-interactive-map")).toHaveCount(0);
  await expect(schematic).toBeVisible();
  await expect(mapCard.getByText("Coordinate overview — not a street map")).toBeVisible();
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
  await openDetailsWithKeyboard(
    page,
    timelineCard.locator("details.context-explorer"),
  );
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
  await openDetailsWithKeyboard(page, chartCard.locator("details.context-explorer"));
  const dataTable = chartCard.getByRole("table", {
    name: "Exact data for Notes compared with the source article",
  });
  await expect(dataTable.getByRole("columnheader")).toHaveCount(2);
  await expect(dataTable.getByRole("rowheader", { name: "Source article" })).toBeVisible();
  await expect(dataTable.getByRole("cell", { name: "20" })).toBeVisible();

  const diagramCard = page.locator("#article-context-diagram-engine");
  await openDetailsWithKeyboard(
    page,
    diagramCard.locator("details.context-explorer"),
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
  await openDetailsWithKeyboard(page, mapCard.locator("details.context-explorer"));
  const mapCanvas = mapCard.locator(
    'canvas[aria-label="Interactive street map for Places in the correspondence"]',
  );
  await expect(mapCanvas).toBeVisible();
  await mapCanvas.focus();
  await expect(mapCanvas).toBeFocused();

  await expect(mapCard.getByText("Street map unavailable", { exact: true })).toBeVisible();
  await expect(failureStatus).toHaveText(
    "Street map unavailable. The coordinate overview is shown instead. Exact place, route, and area information remains available below.",
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
    mapCard.locator(".context-interactive-map").getByRole("status"),
  ).toHaveText("Interactive map ready");
  await expect(failureStatus).toHaveText("");
  await expect(
    mapCard.getByRole("region", {
      name: "Interactive street map for Places in the correspondence",
    }),
  ).toBeVisible();
});

test("article map falls back when its source metadata cannot load", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await mockArticleAndContext(page, { mapSourceFailures: 1 });
  await page.goto("/article/Ada_Lovelace");

  const mapCard = page.locator("#article-context-map-journey");
  await openDetailsWithKeyboard(page, mapCard.locator("details.context-explorer"));

  await expect(mapCard.getByText("Street map unavailable", { exact: true })).toBeVisible();
  await expect(mapCard.locator(".context-map-failure-status")).toContainText(
    "Street map unavailable",
  );
  await expect(mapCard.locator(".context-map-schematic")).toBeVisible();
  await mapCard
    .getByRole("button", { name: "Retry interactive street map" })
    .click();

  await expect(
    mapCard.locator(".context-interactive-map").getByRole("status"),
  ).toHaveText("Interactive map ready");
  await expect(mapCard.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  await expect(mapCard.locator(".context-map-schematic")).toHaveCount(0);
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
  await openDetailsWithKeyboard(
    page,
    diagramCard.locator("details.context-explorer"),
  );
  const zoomIn = diagramCard.getByRole("button", { name: "Zoom in" });
  await zoomIn.focus();
  await page.keyboard.press("Enter");
  await expect(diagramCard.getByText("125 percent")).toBeVisible();

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBe(320);
  await expectNoSeriousAxeViolations(page);
});
