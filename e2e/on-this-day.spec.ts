import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const counts = {
  selected: 3,
  events: 30,
  births: 2,
  deaths: 2,
  holidays: 2,
};

const onThisDayResponse = (requestUrl: string) => {
  const url = new URL(requestUrl);
  const category = url.searchParams.get("category") ?? "selected";
  const order = url.searchParams.get("order") ?? "newest";
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const total = counts[category as keyof typeof counts];
  const length = Math.min(25, total - offset);
  const items = Array.from({ length }, (_, index) => {
    const sequence = offset + index;
    return {
      id: `${category}-${order}-${sequence}`,
      year: order === "oldest" ? 1900 + sequence : 2000 - sequence,
      text: `${category} historical entry ${sequence + 1}.`,
      pages: [
        {
          title: `Related article ${sequence + 1}`,
          slug: `Related_article_${sequence + 1}`,
        },
      ],
      ...(sequence === 0
        ? {
            image: {
              source: "https://upload.wikimedia.org/on-this-day.jpg",
              width: 640,
              height: 480,
              articleTitle: "Related article 1",
              altText:
                "A speaker addressing an audience at a historical commemoration.",
              attribution: {
                creator: "Example photographer",
                licenseName: "CC BY-SA 4.0",
                sourceTitle: "File:On this day.jpg",
                sourceUrl:
                  "https://commons.wikimedia.org/wiki/File:On_this_day.jpg",
              },
            },
          }
        : {}),
    };
  });

  return {
    requestedDate: "2026-07-30",
    snapshotDate: "2026-07-30",
    snapshotIsStale: false,
    provider: "wikifeeds-v1",
    sourceUrl: "https://en.wikipedia.org/wiki/July_30",
    category,
    order,
    offset,
    limit: 25,
    total,
    nextOffset: offset + length < total ? offset + length : null,
    counts,
    availableCategories: {
      selected: true,
      events: true,
      births: true,
      deaths: true,
      holidays: true,
    },
    items,
  };
};

const mockOnThisDay = async (page: Page, requests: string[]) => {
  await page.route("**/api/on-this-day?**", async (route) => {
    requests.push(route.request().url());
    const url = new URL(route.request().url());
    if (
      url.searchParams.get("category") === "events" &&
      url.searchParams.get("offset") === "0"
    ) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(onThisDayResponse(route.request().url())),
    });
  });
  await page.route("https://upload.wikimedia.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: tinyPng }),
  );
};

test("shows exactly three homepage highlights with the full-edition link", async ({
  page,
}) => {
  await page.route("**/api/featured", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        feedDate: "2026-07-30",
        tfa: null,
        didYouKnow: [],
        inTheNews: [],
        pictureOfDay: null,
        trending: [],
        onThisDay: Array.from({ length: 4 }, (_, index) => ({
          year: 2000 - index,
          text: `Homepage historical highlight ${index + 1}.`,
          pages: [],
        })),
      }),
    }),
  );
  await page.route("**/api/trending/brief", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ brief: null }),
    }),
  );

  await page.goto("/");

  const card = page
    .getByRole("heading", { level: 3, name: "On This Day" })
    .locator("..");
  await expect(card.locator("ol > li")).toHaveCount(3);
  await expect(
    card.getByRole("link", { name: "Explore all 4 highlights" }),
  ).toHaveAttribute("href", "/on-this-day");
});

test("explores, caches, sorts, and progressively reveals On This Day", async ({
  page,
}) => {
  const requests: string[] = [];
  await mockOnThisDay(page, requests);
  await page.goto("/on-this-day");

  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page).toHaveTitle(/On This Day — Curio Garden/u);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "On This Day" })).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Explore the day in history",
    }),
  ).toBeAttached();
  const localNotice = page.getByRole("button", {
    name: "Dismiss local mode notice",
  });
  await page.keyboard.press("Tab");
  await expect(localNotice).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(localNotice).toBeHidden();
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(5);
  await expect(page.getByRole("tab", { name: /Highlights/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(3);
  await expect(page.locator(".on-this-day-event-image img").first()).toHaveAttribute(
    "alt",
    "A speaker addressing an audience at a historical commemoration.",
  );
  await expect(page.getByRole("link", { name: "Related article 1" }).first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: /File:On this day.jpg/ }).first(),
  ).toBeVisible();

  const highlightsTab = page.getByRole("tab", { name: /Highlights/ });
  const eventsTab = page.getByRole("tab", { name: /Events/ });
  await highlightsTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(eventsTab).toBeFocused();
  await expect(eventsTab).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Enter");
  await expect(eventsTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#on-this-day-live-status")).toHaveText(
    "Loading events…",
  );
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(25);
  await expect(page.locator("#on-this-day-live-status")).toHaveText(
    "Showing 25 of 30 events, newest first.",
  );

  const showMore = page.locator(".on-this-day-show-more");
  await expect(showMore).toHaveText(/Show 5 more events/);
  await showMore.focus();
  await showMore.click();
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(30);
  await expect(showMore).toBeFocused();
  await expect(showMore).toHaveText(/All 30 events shown/);

  const sort = page.locator(".context-timeline-controls button");
  await expect(sort).toHaveText("Oldest first");
  await sort.focus();
  await sort.click();
  await expect(sort).toBeFocused();
  await expect(page.locator("ol.timeline-list time").first()).toHaveText("1900");

  await page.getByRole("tab", { name: /Highlights/ }).click();
  await page.getByRole("tab", { name: /Events/ }).click();
  expect(requests).toHaveLength(4);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("reflows with text spacing and preserves forced-color focus", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await mockOnThisDay(page, requests);
  await page.goto("/on-this-day");
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(3);
  for (const selector of [
    ".on-this-day-event-text",
    ".on-this-day-event-links a",
    ".context-timeline-date",
    ".on-this-day-event-image > p",
    ".on-this-day-source-note",
  ]) {
    expect(
      await page.locator(selector).first().evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      ),
    ).toBeGreaterThanOrEqual(14);
  }
  expect(
    await page
      .locator(".on-this-day-event-text")
      .first()
      .evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      ),
  ).toBeGreaterThanOrEqual(16);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await page.addStyleTag({
    content: `
      p, li { line-height: 1.5 !important; }
      * { letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
      p { margin-bottom: 2em !important; }
    `,
  });

  const attributionLayout = await page
    .locator(".on-this-day-event-image > p")
    .first()
    .evaluate((attribution) => {
      const sourceLink = attribution.querySelector("a");
      if (!sourceLink) return { containsSourceLink: false };
      const containerBox = attribution.getBoundingClientRect();
      const linkBox = sourceLink.getBoundingClientRect();
      return {
        containsSourceLink: linkBox.bottom <= containerBox.bottom + 1,
        display: getComputedStyle(attribution).display,
        overflow: getComputedStyle(attribution).overflow,
      };
    });
  expect(attributionLayout).toMatchObject({
    containsSourceLink: true,
    display: "block",
    overflow: "visible",
  });

  const highlightsTab = page.getByRole("tab", { name: /Highlights/ });
  await highlightsTab.focus();
  await expect
    .poll(() =>
      highlightsTab.evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      }),
    )
    .toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await expect(page.getByRole("tabpanel")).toBeVisible();
});

test("has no automated accessibility violations in dark mode", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await mockOnThisDay(page, requests);
  await page.goto("/on-this-day");
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(3);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
