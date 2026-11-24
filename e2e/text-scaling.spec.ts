import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
} from "../lib/article-context-types";
import { createTestSection } from "../lib/test-section-narration";
import { expectNoPageOverflow } from "./support/expect-no-page-overflow";

const EXPECTED_ROOT_SIZE = {
  chromium: 32,
  webkit: 53,
} as const;

const routeTemplates = [
  "/",
  "/about",
  "/feedback",
  "/search?q=A%20deliberately%20long%20accessible%20search%20query",
  "/library",
  "/dashboard",
  "/account",
  "/on-this-day",
  "/trending",
  "/did-you-know",
  "/podcast",
  "/podcasts",
  "/privacy",
  "/terms",
] as const;

const priorityViewports = [
  { label: "320 portrait", width: 320, height: 844 },
  { label: "390 portrait", width: 390, height: 844 },
  { label: "430 portrait", width: 430, height: 932 },
  { label: "844 landscape", width: 844, height: 390 },
] as const;

const onThisDayFixture = {
  calendarDay: "08-01",
  checkedAt: Date.UTC(2026, 7, 1, 12, 0, 0),
  changedAt: Date.UTC(2026, 7, 1, 12, 0, 0),
  degraded: false,
  provider: "wikipedia-rest-v1",
  sourceUrl: "https://en.wikipedia.org/wiki/August_1",
  category: "selected",
  order: "newest",
  offset: 0,
  limit: 25,
  total: 1,
  nextOffset: null,
  counts: { selected: 1, events: 1, births: 1, deaths: 1, holidays: 1 },
  availableCategories: {
    selected: true,
    events: true,
    births: true,
    deaths: true,
    holidays: true,
  },
  items: [
    {
      id: "large-text-history",
      year: 2026,
      text: "A deliberately long historical description demonstrates that dates, article links, controls, and source information can wrap without colliding with the timeline axis.",
      pages: [
        {
          title: "A related article with an intentionally expansive title",
          slug: "Accessible_typography",
        },
      ],
    },
  ],
};

const mockStableApis = async (page: Page) => {
  await page.route("**/api/featured", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        feedDate: "2026-08-01",
        tfa: null,
        didYouKnow: [],
        inTheNews: [],
        pictureOfDay: null,
        trending: [],
        onThisDay: [],
      }),
    }),
  );
  await page.route("**/api/trending/brief", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ brief: null }),
    }),
  );
  await page.route("**/api/on-this-day?**", (route) => {
    const url = new URL(route.request().url());
    const calendarDay = url.searchParams.get("day") ?? onThisDayFixture.calendarDay;
    const category = url.searchParams.get("category") ?? "selected";
    const order = url.searchParams.get("order") ?? "newest";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...onThisDayFixture,
        calendarDay,
        category,
        order,
      }),
    });
  });
  await page.route("**/api/local-wikipedia", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    }),
  );
};

const expectNoSeriousAxeFindings = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
};

const installScale = async (
  context: BrowserContext,
  page: Page,
  browserName: "chromium" | "firefox" | "webkit",
) => {
  if (browserName === "chromium") {
    const session = await context.newCDPSession(page);
    await session.send("Emulation.setEmulatedOSTextScale", { scale: 2 });
    return;
  }

  await page.addInitScript((fontSize) => {
    const nativeSetProperty = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (
      property: string,
      value: string | null,
      priority?: string,
    ) {
      return nativeSetProperty.call(
        this,
        property,
        property === "--os-text-base" ? `${fontSize}px` : value,
        priority,
      );
    };

    addEventListener("DOMContentLoaded", () => {
      nativeSetProperty.call(
        document.documentElement.style,
        "--os-text-base",
        `${fontSize}px`,
      );
    });
  }, EXPECTED_ROOT_SIZE.webkit);
};

test.beforeEach(async ({ context, page, browserName }) => {
  await installScale(context, page, browserName);
  await mockStableApis(page);
});

test("the platform root follows Android 200% or synthetic iOS AX5", async ({
  page,
  browserName,
}) => {
  await page.goto("/about");
  const rootSize = await page.evaluate(() =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
  );
  expect(rootSize).toBe(
    EXPECTED_ROOT_SIZE[browserName as "chromium" | "webkit"],
  );
});

test("Chromium exposes exact 100, 150, and 200 percent OS scale steps", async ({
  context,
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "Chromium CDP contract only.");
  const session = await context.newCDPSession(page);
  for (const scale of [1, 1.5, 2]) {
    await session.send("Emulation.setEmulatedOSTextScale", { scale });
    await page.goto("/about");
    await expect
      .poll(() =>
        page.evaluate(() =>
          Number.parseFloat(
            getComputedStyle(document.documentElement).fontSize,
          ),
        ),
      )
      .toBe(16 * scale);
  }
});

test("every route template reflows at the maximum target size", async ({
  page,
}) => {
  for (const route of routeTemplates) {
    await test.step(route, async () => {
      const response = await page.goto(route, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.ok(), `${route} should load successfully`).toBe(true);
      await expect(page.getByRole("main")).toBeVisible();
      await expectNoPageOverflow(page);
    });
  }
});

test("article section titles and Listen targets reflow at maximum text size", async ({
  page,
}) => {
  const section = createTestSection({
    title: "Notes on the Analytical Engine",
    level: 4,
    content: "Lovelace described how the engine could process symbols.",
  });
  await page.route("**/api/local-wikipedia", (route) => {
    const { operation } = route.request().postDataJSON();
    if (operation === "article") {
      return route.fulfill({
        json: {
          data: {
            wikiPageId: "974",
            revisionId: "123456789",
            title: "Ada Lovelace",
            language: "en",
            narrationVersion: 2,
            summary: "Ada Lovelace was a mathematician.",
            sections: [section],
          },
        },
      });
    }
    if (operation === "metadata") {
      return route.fulfill({
        json: { data: { linkCounts: [], sectionCitations: [], images: [] } },
      });
    }
    return route.fallback();
  });
  await page.route("**/api/article-context", (route) =>
    route.fulfill({
      json: {
        cacheStatus: "hit",
        context: {
          ...route.request().postDataJSON(),
          schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
          extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
          generatedAt: "2026-08-01T00:00:00Z",
          sourceHash: "section-reflow",
          blocks: [],
        },
      },
    }),
  );
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/article/Ada_Lovelace");
  const sections = page.getByRole("navigation", { name: "Article sections" });
  const title = sections.getByText(section.title, { exact: true });
  const listen = sections.getByRole("button", {
    name: `Listen to ${section.title}`,
  });
  await expect(listen).toBeVisible();
  await expectNoPageOverflow(page);
  const titleBox = await title.boundingBox();
  const listenBox = await listen.boundingBox();
  if (!titleBox || !listenBox)
    throw new Error("Section title or Listen target missing");
  expect(listenBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  expect(listenBox.width).toBeGreaterThanOrEqual(44);
  expect(listenBox.height).toBeGreaterThanOrEqual(44);

  await page.route("**/api/tts", (route) =>
    route.fulfill({
      contentType: "audio/mpeg",
      path: "public/audio/curio-garden-listening-sample-edge-v1.mp3",
    }),
  );
  await page.getByRole("button", { name: /^Play all/ }).click();
  const skip = page.getByRole("button", { name: "Skip section", exact: true });
  await expect(skip.getByText("Skip section", { exact: true })).toBeVisible();
  await expectNoPageOverflow(page);

  await page.getByRole("button", { name: "Open menu" }).click();
  const theme = page.getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: /Switch to (light|dark) theme/ });
  const originalAction = await theme.innerText();
  // The expanded player overlaps this part of the menu at maximum text size.
  await theme.click();
  await expect(theme).not.toHaveAccessibleName(originalAction);
});

test("shell, menu, and listening controls remain reachable", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Loading today's Wikipedia feed" }),
  ).toHaveCount(0, { timeout: 15_000 });
  const menuButton = page.getByRole("button", { name: "Open menu" });
  await expect(menuButton).toBeVisible();

  const menuButtonBox = await menuButton.boundingBox();
  expect(menuButtonBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(menuButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  await menuButton.click();
  const mobileMenu = page.getByRole("navigation", { name: "Mobile navigation" });
  await expect(mobileMenu).toBeVisible();
  const menuTheme = mobileMenu.getByRole("button", { name: /switch to (light|dark) theme/i });
  const originalAction = await menuTheme.innerText();
  await menuTheme.press("Enter");
  await expect(menuTheme).not.toHaveAccessibleName(originalAction);
  await expect(menuTheme).toBeFocused();
  await page.getByRole("button", { name: "Close menu" }).click();
  const themeButton = page.getByRole("contentinfo").getByRole("button", {
    name: /switch to (light|dark) theme/i,
  });
  await themeButton.focus();
  await page.keyboard.press("Enter");
  await expect(themeButton).toHaveAccessibleName(originalAction);
  await expect(themeButton).toBeFocused();
  const themeButtonBox = await themeButton.boundingBox();
  expect(themeButtonBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  expect(themeButtonBox?.height ?? 0).toBeGreaterThanOrEqual(44);

  const player = page.getByRole("group", {
    name: "Audio player for Curio Garden listening sample",
  });
  await expect(player).toBeVisible();
  for (const control of [
    player.getByRole("button", { name: "Skip back 10 seconds" }),
    player.getByRole("button", { name: /^Play:/ }),
    player.getByRole("button", { name: "Skip forward 10 seconds" }),
    player.getByRole("button", { name: "Slower" }),
    player.getByRole("button", { name: "Faster" }),
  ]) {
    const box = await control.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expectNoPageOverflow(page);
});

test("sticky header measurements keep deep-link targets visible", async ({
  page,
}) => {
  await page.goto("/privacy#privacy-third-parties");
  const target = page.getByRole("heading", { name: "Third-party services" });
  await expect(target).toBeVisible();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const header = document.querySelector<HTMLElement>("header.navbar");
        const published = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--site-header-height",
          ),
        );
        return header
          ? Math.abs(
              published - Math.ceil(header.getBoundingClientRect().height),
            )
          : Number.POSITIVE_INFINITY;
      }),
    )
    .toBeLessThanOrEqual(1);

  const geometry = await target.evaluate((heading) => {
    const header = document.querySelector<HTMLElement>("header.navbar");
    return {
      headerBottom: header?.getBoundingClientRect().bottom ?? 0,
      targetTop: heading.getBoundingClientRect().top,
    };
  });
  expect(geometry.targetTop).toBeGreaterThanOrEqual(geometry.headerBottom - 1);
});

test("priority shell, playback, and timeline surfaces reflow across mobile orientations", async ({
  page,
}) => {
  for (const viewport of priorityViewports) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await expect(
        page.getByRole("region", { name: "Loading today's Wikipedia feed" }),
      ).toHaveCount(0, { timeout: 15_000 });
      await expect(
        page.getByRole("group", {
          name: "Audio player for Curio Garden listening sample",
        }),
      ).toBeVisible();
      await expectNoPageOverflow(page);

      await page.goto("/on-this-day");
      await expect(page.locator("ol.timeline-list > li")).toHaveCount(1, {
        timeout: 15_000,
      });
      await expectNoPageOverflow(page);
    });
  }
});

test("On This Day survives WCAG text spacing without clipping", async ({
  page,
}) => {
  await page.goto("/on-this-day");
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(1, {
    timeout: 15_000,
  });
  await page.addStyleTag({
    content: `
      p, li, a, button, label, input, select, textarea, h1, h2, h3, h4 {
        line-height: 1.5 !important;
        letter-spacing: 0.12em !important;
        word-spacing: 0.16em !important;
      }
      p { margin-block-end: 2em !important; }
    `,
  });
  await expect(page.locator("#on-this-day-live-status")).toContainText(
    "1 highlight",
  );
  await expectNoPageOverflow(page);
});

test("dark theme keeps priority mobile surfaces usable at maximum text size", async ({
  page,
  browserName,
}) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));

  const expectDarkTheme = async () => {
    await expect
      .poll(() =>
        page.evaluate(() => ({
          colorScheme: getComputedStyle(document.documentElement).colorScheme,
          dark: document.documentElement.classList.contains("dark"),
          light: document.documentElement.classList.contains("light"),
          rootSize: Number.parseFloat(
            getComputedStyle(document.documentElement).fontSize,
          ),
          storedTheme: localStorage.getItem("theme"),
        })),
      )
      .toEqual({
        colorScheme: "dark",
        dark: true,
        light: false,
        rootSize: EXPECTED_ROOT_SIZE[browserName as "chromium" | "webkit"],
        storedTheme: "dark",
      });
  };

  await page.goto("/");
  await expect(
    page.getByRole("region", { name: "Loading today's Wikipedia feed" }),
  ).toHaveCount(0, { timeout: 15_000 });
  await expectDarkTheme();

  const localNotice = page
    .getByRole("status")
    .filter({ hasText: "Local mode" });
  const dismissNotice = page.getByRole("button", {
    name: "Dismiss local mode notice",
  });
  await expect(localNotice).toBeVisible();
  await expect(dismissNotice).toBeVisible();
  const [noticeBox, dismissBox, headerBox] = await Promise.all([
    localNotice.boundingBox(),
    dismissNotice.boundingBox(),
    page.getByRole("banner").boundingBox(),
  ]);
  if (!noticeBox || !dismissBox || !headerBox) {
    throw new Error(
      "Dark home notice, dismiss action, and header must have layout boxes.",
    );
  }
  expect(dismissBox.y + dismissBox.height).toBeLessThanOrEqual(
    noticeBox.y + noticeBox.height + 1,
  );
  expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(headerBox.y + 1);

  const player = page.getByRole("group", {
    name: "Audio player for Curio Garden listening sample",
  });
  await expect(player).toBeVisible();
  await expect(player.getByRole("button", { name: /^Play:/ })).toBeVisible();

  const menuButton = page.getByRole("button", { name: "Open menu" });
  await menuButton.click();
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await expectNoPageOverflow(page);
  await page.getByRole("button", { name: "Close menu" }).click();
  await expectNoSeriousAxeFindings(page);

  await page.goto("/on-this-day");
  await expectDarkTheme();
  await expect(
    page.getByRole("heading", { name: "On This Day" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tablist", { name: "On This Day categories" }),
  ).toBeVisible();
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(
    page.getByText("A deliberately long historical description", {
      exact: false,
    }),
  ).toBeVisible();
  await expectNoPageOverflow(page);
  await expectNoSeriousAxeFindings(page);
});

test("representative maximum-text page has no serious axe findings", async ({
  page,
}) => {
  await page.goto("/about");
  await expectNoSeriousAxeFindings(page);
});
