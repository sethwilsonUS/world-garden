import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const expectNoSeriousAxeViolations = async (page: Page) => {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(serious).toEqual([]);
};

const todayFixture = {
  feedDate: "2026-07-10",
  tfa: {
    title: "Ada Lovelace",
    extract: "Ada Lovelace wrote about Charles Babbage's Analytical Engine.",
    thumbnail: {
      source: "https://upload.wikimedia.org/ada.jpg",
      width: 640,
      height: 480,
      attribution: {
        creator: "Alfred Edward Chalon",
        licenseName: "Public domain",
        sourceTitle: "File:Ada Lovelace portrait.jpg",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Ada_Lovelace_portrait.jpg",
      },
    },
  },
  didYouKnow: Array.from({ length: 4 }, (_, index) => ({
    text: `... that accessible fact ${index + 1} invites another question?`,
    links: [],
    segments: [
      { type: "text", text: `... that accessible fact ${index + 1} invites another question?` },
    ],
  })),
  inTheNews: Array.from({ length: 3 }, (_, index) => ({
    story: `News story ${index + 1}`,
    links: [],
  })),
  onThisDay: [
    { year: 1969, text: "A notable event happened.", pages: [] },
  ],
  trending: Array.from({ length: 5 }, (_, index) => ({
    title: `Trending topic ${index + 1}`,
    extract: "A concise explanation of the topic.",
    views: 1000 - index,
  })),
};

const mockHomeData = async (page: Page) => {
  await page.route("**/api/featured", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(todayFixture) }),
  );
  await page.route("**/api/trending/brief", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ brief: null }) }),
  );
  await page.route("https://upload.wikimedia.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: tinyPng }),
  );
};

const mockArticleData = async (page: Page) => {
  await page.route("https://upload.wikimedia.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: tinyPng }),
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
                    descriptionurl: "https://commons.wikimedia.org/wiki/File:Ada_portrait.jpg",
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
              revisions: [{ revid: 123456789, timestamp: "2026-07-10T12:00:00Z" }],
              thumbnail: {
                source: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/800px-Ada_portrait.jpg",
                width: 800,
                height: 1067,
              },
            },
          },
        },
      }),
    });
  });
};

test("home presents the product and expands the curated daily preview", async ({ page }) => {
  await mockHomeData(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Curio Garden" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search topic" })).toBeVisible();
  await expect(page.getByText("Choose a section")).toBeVisible();
  await expect(page.getByText("accessible fact 4", { exact: false })).toBeHidden();

  await page.getByRole("button", { name: "Show all 4 facts" }).click();
  await expect(page.getByText("accessible fact 4", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show fewer facts" })).toBeFocused();
  await expectNoSeriousAxeViolations(page);
});

test("article exposes revision and media provenance in an accessible lightbox", async ({ page }) => {
  await mockArticleData(page);
  await page.goto("/article/Ada_Lovelace");

  await expect(page.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Revision 123456789/ }).first()).toBeVisible();
  await expect(page.getByText("Image by Alfred Edward Chalon", { exact: false }).first()).toBeVisible();

  await page.getByRole("button", { name: "View full image for Ada Lovelace" }).click();
  await expect(page.getByRole("dialog", { name: "Image gallery" })).toBeVisible();
  await expect(page.getByText("Creator: Alfred Edward Chalon")).toBeVisible();
  await page.getByRole("button", { name: "Close lightbox" }).click();
  await expect(page.getByRole("button", { name: "View full image for Ada Lovelace" })).toBeFocused();
  await expectNoSeriousAxeViolations(page);
});

test("mobile navigation, theme, reflow, and project story remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/about");

  await expect(page.getByRole("heading", { level: 1, name: "Free knowledge, made listenable." })).toBeVisible();
  await expect(page.getByText("Seth Wilson")).toBeVisible();
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();

  const themeButton = page.getByRole("button", { name: /Switch to .* theme/ }).first();
  await themeButton.click();
  await expect(page.locator("html")).toHaveClass(/light|dark/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expectNoSeriousAxeViolations(page);
});
