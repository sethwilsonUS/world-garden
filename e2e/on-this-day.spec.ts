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

const onThisDayResponse = (
  requestUrl: string,
  { degraded = false }: { degraded?: boolean } = {},
) => {
  const url = new URL(requestUrl);
  const calendarDay = url.searchParams.get("day") ?? "07-30";
  const category = url.searchParams.get("category") ?? "selected";
  const order = url.searchParams.get("order") ?? "newest";
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const effectiveCounts = degraded
    ? { selected: 3, events: 0, births: 0, deaths: 0, holidays: 0 }
    : counts;
  const total = effectiveCounts[category as keyof typeof effectiveCounts];
  const length = Math.min(25, Math.max(0, total - offset));
  const items = Array.from({ length }, (_, index) => {
    const sequence = offset + index;
    return {
      id: `${calendarDay}-${category}-${order}-${sequence}`,
      year: order === "oldest" ? 1900 + sequence : 2000 - sequence,
      text: `${calendarDay} ${category} historical entry ${sequence + 1}.`,
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
    calendarDay,
    checkedAt: Date.UTC(2026, 10, 20, 12, 0, 0),
    changedAt: Date.UTC(2026, 10, 19, 12, 0, 0),
    degraded,
    provider: degraded ? "featured-fallback" : "wikipedia-rest-v1",
    sourceUrl: "https://en.wikipedia.org/wiki/July_30",
    category,
    order,
    offset,
    limit: 25,
    total,
    nextOffset: offset + length < total ? offset + length : null,
    counts: effectiveCounts,
    availableCategories: degraded
      ? {
          selected: true,
          events: false,
          births: false,
          deaths: false,
          holidays: false,
        }
      : {
          selected: true,
          events: true,
          births: true,
          deaths: true,
          holidays: true,
        },
    items,
  };
};

const mockOnThisDay = async (
  page: Page,
  requests: string[],
  options: { degraded?: boolean } = {},
) => {
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
      body: JSON.stringify(onThisDayResponse(route.request().url(), options)),
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
  await expect(
    page.getByRole("heading", { level: 1, name: /^On This Day:/u }),
  ).toBeVisible();
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
  await expect(page.locator("#main-content")).toBeFocused();

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await skipLink.focus();
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
  await expect(
    page.locator(".on-this-day-event-image img").first(),
  ).toHaveAttribute(
    "alt",
    "A speaker addressing an audience at a historical commemoration.",
  );
  await expect(
    page.getByRole("link", { name: "Related article 1" }).first(),
  ).toBeVisible();
  const relatedItem = page.locator(".on-this-day-event-links > li").first();
  for (const marker of ["::before", "::after"]) {
    expect(
      await relatedItem.evaluate(
        (item, pseudo) => getComputedStyle(item, pseudo).content,
        marker,
      ),
    ).toBe("none");
  }
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
  await expect(page.locator("ol.timeline-list time").first()).toHaveText(
    "1900",
  );

  await page.getByRole("tab", { name: /Highlights/ }).click();
  await page.getByRole("tab", { name: /Events/ }).click();
  expect(requests).toHaveLength(4);

  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("walks the fixed 366-day ring via Previous/Next, keeps focus, announces changes, and preserves tab and sort", async ({
  page,
}) => {
  const requests: string[] = [];
  await mockOnThisDay(page, requests);

  // Dec 31 -> Next -> Jan 1
  await page.goto("/on-this-day/december-31");
  await expect(page).toHaveTitle("On This Day: December 31 — Curio Garden");
  await expect(
    page.getByRole("heading", { level: 1, name: "On This Day: December 31" }),
  ).toBeVisible();
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(3);

  const nextLink = page.getByRole("link", { name: /Next: January 1/u });
  await nextLink.focus();
  await nextLink.click();

  await expect(page).toHaveURL(/\/on-this-day\/january-1$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "On This Day: January 1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Next: January 2/u }),
  ).toBeFocused();
  await expect(page.locator("#on-this-day-live-status")).toHaveText(
    "Now showing January 1, Highlights, 3 items.",
  );

  // Mar 1 -> Previous -> Feb 29 (always reachable)
  await page.goto("/on-this-day/march-1");
  await expect(
    page.getByRole("heading", { level: 1, name: "On This Day: March 1" }),
  ).toBeVisible();

  const prevLink = page.getByRole("link", { name: /Previous: February 29/u });
  await prevLink.focus();
  await prevLink.click();

  await expect(page).toHaveURL(/\/on-this-day\/february-29$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "On This Day: February 29" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Previous: February 28/u }),
  ).toBeFocused();

  // Births + Oldest first -> Next preserves category & order in URL and state
  await page.goto("/on-this-day/march-5");
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(3);
  await page.getByRole("tab", { name: /Births/ }).click();
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(2);
  await page.getByRole("button", { name: "Oldest first" }).click();
  await expect(page).toHaveURL(
    /\/on-this-day\/march-5\?category=births&order=oldest$/u,
  );

  const marchNext = page.getByRole("link", { name: /Next: March 6/u });
  await marchNext.focus();
  await marchNext.click();

  await expect(page).toHaveURL(
    /\/on-this-day\/march-6\?category=births&order=oldest$/u,
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "On This Day: March 6" }),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /Births/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator("ol.timeline-list time").first()).toHaveText(
    "1900",
  );
  await expect(page.getByRole("link", { name: /Next: March 7/u })).toBeFocused();
  await expect(page.locator("#on-this-day-live-status")).toHaveText(
    "Now showing March 6, Births, 2 items.",
  );
});

test("navigates days via the year-less calendar picker using keyboard only and passes axe", async ({
  page,
}) => {
  const requests: string[] = [];
  await mockOnThisDay(page, requests);
  await page.goto("/on-this-day/march-5");
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(3);

  const pickerTrigger = page.getByRole("button", {
    name: "Choose a day, currently March 5",
  });
  await pickerTrigger.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Choose a day" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "March 5" }),
  ).toBeFocused();

  const dialogAxe = await new AxeBuilder({ page }).analyze();
  expect(dialogAxe.violations).toEqual([]);

  // ArrowRight -> March 6, PageDown -> April 6, Enter -> navigates and restores focus
  await page.keyboard.press("ArrowRight");
  await expect(
    dialog.getByRole("button", { name: "March 6" }),
  ).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect(
    dialog.getByRole("button", { name: "April 6" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/on-this-day\/april-6$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "On This Day: April 6" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Choose a day, currently April 6" }),
  ).toBeFocused();
});

test("opens bare /on-this-day on Reader's Today even when UTC is already tomorrow", async ({
  browser,
}) => {
  const context = await browser.newContext({
    timezoneId: "America/Chicago",
  });
  const page = await context.newPage();
  const requests: string[] = [];
  // 2026-11-24 01:00 UTC is 2026-11-23 19:00 CST in America/Chicago.
  await page.clock.setFixedTime(new Date("2026-11-24T01:00:00Z"));
  await mockOnThisDay(page, requests);

  try {
    await page.goto("/on-this-day");
    await expect(
      page.getByRole("heading", { level: 1, name: "On This Day: November 23" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/on-this-day$/u);
    expect(requests.some((url) => url.includes("day=11-23"))).toBe(true);
  } finally {
    await context.close();
  }
});

test("shows a degraded status notice and disables unavailable categories", async ({
  page,
}) => {
  const requests: string[] = [];
  await mockOnThisDay(page, requests, { degraded: true });
  await page.goto("/on-this-day/march-5");

  await expect(
    page.getByText("Only highlights are available for this day right now."),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: /Events/ })).toBeDisabled();
  await expect(page.getByRole("tab", { name: /Highlights/ })).toBeEnabled();
});

test("reflows with text spacing, forced colors, and open calendar dialog at 320px", async ({
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
      await page
        .locator(selector)
        .first()
        .evaluate((element) =>
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
        return (
          style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0
        );
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

  // Open the calendar dialog at 320px + 200% font size + WCAG text spacing and confirm zero overflow.
  await page.getByRole("button", { name: /Choose a day/u }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a day" });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth + 1,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("tabpanel")).toBeVisible();
});

test("has no automated accessibility violations in dark mode (page and calendar dialog)", async ({
  page,
}) => {
  const requests: string[] = [];
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await mockOnThisDay(page, requests);
  await page.goto("/on-this-day");
  await expect(page.locator("html")).toHaveClass(/dark/u);
  await expect(page.locator("ol.timeline-list > li")).toHaveCount(3);

  const pageResults = await new AxeBuilder({ page }).analyze();
  expect(pageResults.violations).toEqual([]);

  await page.getByRole("button", { name: /Choose a day/u }).click();
  await expect(
    page.getByRole("dialog", { name: "Choose a day" }),
  ).toBeVisible();
  const dialogResults = await new AxeBuilder({ page }).analyze();
  expect(dialogResults.violations).toEqual([]);
});

test("publishes all 366 On This Day calendar URLs in sitemap.xml", async ({
  request,
}) => {
  const response = await request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  const xml = await response.text();
  const matches = xml.match(
    /<loc>[^<]*\/on-this-day\/[a-z]+-\d{1,2}<\/loc>/gu,
  );
  expect(matches).toHaveLength(366);
  expect(xml).toContain("/on-this-day/february-29</loc>");
  expect(xml).toContain("/on-this-day/march-5</loc>");
});
