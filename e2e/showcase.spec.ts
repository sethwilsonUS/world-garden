import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const expectNoSeriousAxeViolations = async (page: Page) => {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
  expect(serious).toEqual([]);
};

const todayFixture = {
  feedDate: "2026-07-10",
  // Wikimedia's featured feed uses this legacy date-only shape. Keep the
  // fixture exact so the browser test exercises our normalization path.
  trendingDate: "2026-07-12Z",
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

const analyticalThumbnailUrl =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Analytical_Engine.jpg/330px-Analytical_Engine.jpg";
const analyticalLightboxUrl =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/c/cf/Analytical_Engine.jpg/1600px-Analytical_Engine.jpg";

const mockArticleData = async (
  page: Page,
  options: { failAnalyticalLightbox?: boolean } = {},
) => {
  const lightboxRequests: string[] = [];

  await page.route("https://upload.wikimedia.org/**", (route) => {
    const requestUrl = route.request().url();
    if (requestUrl.includes("/1600px-")) lightboxRequests.push(requestUrl);
    if (
      options.failAnalyticalLightbox &&
      requestUrl === analyticalLightboxUrl
    ) {
      return route.fulfill({
        status: 404,
        contentType: "text/plain",
        body: "Missing test rendition",
      });
    }
    return route.fulfill({ contentType: "image/png", body: tinyPng });
  });

  await page.route("https://commons.wikimedia.org/w/api.php**", (route) => {
    const url = new URL(route.request().url());
    const titles = (url.searchParams.get("titles") ?? "File:Ada portrait.jpg")
      .split("|")
      .filter(Boolean);
    const pages = Object.fromEntries(
      titles.map((title, index) => {
        const analytical = title.includes("Analytical Engine");
        const filename = analytical ? "Analytical_Engine.jpg" : "Ada_portrait.jpg";
        const directory = analytical ? "c/cf" : "a/ab";
        const creator = analytical ? "Science Museum" : "Alfred Edward Chalon";
        const originalWidth = 2400;
        const originalHeight = analytical ? 1600 : 3200;
        const thumbHeight = analytical ? 1067 : 2133;

        return [
          String(index + 1),
          {
            title,
            imagerepository: "shared",
            imageinfo: [
              {
                descriptionurl: `https://commons.wikimedia.org/wiki/File:${filename}`,
                url: `https://upload.wikimedia.org/wikipedia/commons/${directory}/${filename}`,
                width: originalWidth,
                height: originalHeight,
                thumburl: `https://upload.wikimedia.org/wikipedia/commons/thumb/${directory}/${filename}/1600px-${filename}`,
                thumbwidth: 1600,
                thumbheight: thumbHeight,
                mime: "image/jpeg",
                extmetadata: {
                  Artist: { value: creator },
                  LicenseShortName: { value: "Public domain" },
                },
              },
            ],
          },
        ];
      }),
    );

    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ query: { pages } }),
    });
  });

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
              "*": [
                '<figure typeof="mw:File/Thumb"><a href="/wiki/File:Ada_portrait.jpg"><img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada_portrait.jpg/330px-Ada_portrait.jpg" width="330" height="440" alt="Portrait of Ada Lovelace"></a><figcaption>Portrait of Ada Lovelace</figcaption></figure>',
                `<figure typeof="mw:File/Thumb"><a href="/wiki/File:Analytical_Engine.jpg"><img src="${analyticalThumbnailUrl}" width="330" height="220" alt="Analytical Engine mechanisms"></a><figcaption>Analytical Engine at the Science Museum</figcaption></figure>`,
              ].join(""),
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

  return { lightboxRequests };
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

test.describe("date-only labels stay on the Wikimedia calendar date", () => {
  test.describe("west of UTC", () => {
    test.use({ timezoneId: "America/Chicago" });

    test("the Trending page does not roll a UTC-midnight date backward", async ({
      page,
    }) => {
      await mockHomeData(page);
      await page.goto("/trending");

      await expect(
        page.getByText("Most-read data from: Jul 12, 2026", { exact: true }),
      ).toBeVisible();
    });
  });

  test.describe("east of UTC", () => {
    test.use({ timezoneId: "Pacific/Kiritimati" });

    test("the home page does not roll a noon-UTC date forward", async ({
      page,
    }) => {
      await mockHomeData(page);
      await page.goto("/");

      await expect(
        page.getByText("Last updated: Jul 12, 2026", { exact: true }),
      ).toBeVisible();
    });
  });
});

test("article exposes revision and media provenance in an accessible lightbox", async ({ page }) => {
  const { lightboxRequests } = await mockArticleData(page);
  await page.goto("/article/Ada_Lovelace");

  await expect(page.getByRole("heading", { level: 1, name: "Ada Lovelace" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Revision 123456789/ }).first()).toBeVisible();
  await expect(page.getByText("Image by Alfred Edward Chalon", { exact: false }).first()).toBeVisible();

  const heroLightboxButton = page.getByRole("button", {
    name: "View full image for Ada Lovelace",
  });
  await heroLightboxButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Image gallery" })).toBeVisible();
  await expect(page.getByText("Creator: Alfred Edward Chalon")).toBeVisible();
  await page.getByRole("button", { name: "Close lightbox" }).click();
  await expect(heroLightboxButton).toBeFocused();

  const additionalPhotoButton = page.getByRole("button", {
    name: "Open image 2 of 2: Analytical Engine at the Science Museum",
  });
  await expect(additionalPhotoButton).toBeVisible();
  await expect(additionalPhotoButton).toHaveAttribute("aria-haspopup", "dialog");
  expect(lightboxRequests).not.toContain(analyticalLightboxUrl);

  await additionalPhotoButton.focus();
  await expect
    .poll(() =>
      additionalPhotoButton.evaluate(
        (element) => getComputedStyle(element).boxShadow,
      ),
    )
    .not.toBe("none");
  await page.keyboard.press("Enter");
  const galleryDialog = page.getByRole("dialog", { name: "Image gallery" });
  await expect(galleryDialog).toBeVisible();
  await expect(
    galleryDialog.getByRole("button", { name: "Close lightbox" }),
  ).toBeFocused();
  await expect.poll(() => lightboxRequests).toContain(analyticalLightboxUrl);

  const stage = galleryDialog.locator("[data-lightbox-media-stage]");
  const stageBox = await stage.boundingBox();
  expect(stageBox?.width).toBeGreaterThan(330);
  expect(stageBox?.height).toBeGreaterThan(240);
  const displayedImage = galleryDialog.getByRole("img", {
    name: "Analytical Engine mechanisms",
  });
  const displayedImageBox = await displayedImage.boundingBox();
  expect(displayedImageBox?.width).toBeGreaterThan(330);

  const previousButton = galleryDialog.getByRole("button", {
    name: "Previous image",
  });
  const nextButton = galleryDialog.getByRole("button", {
    name: "Next image",
  });
  await previousButton.click();
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Portrait of Ada Lovelace, image 1 of 2",
  );
  await nextButton.click();
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Analytical Engine at the Science Museum, image 2 of 2",
  );

  await stage.evaluate((element) => {
    const touchStart = new Event("touchstart", { bubbles: true });
    Object.defineProperty(touchStart, "touches", {
      value: [{ clientX: 600, clientY: 300 }],
    });
    element.dispatchEvent(touchStart);

    const touchEnd = new Event("touchend", { bubbles: true });
    Object.defineProperty(touchEnd, "changedTouches", {
      value: [{ clientX: 450, clientY: 305 }],
    });
    element.dispatchEvent(touchEnd);
  });
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Portrait of Ada Lovelace, image 1 of 2",
  );

  await page.keyboard.press("ArrowRight");
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Analytical Engine at the Science Museum, image 2 of 2",
  );
  await page.keyboard.press("ArrowLeft");
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Portrait of Ada Lovelace, image 1 of 2",
  );
  await page.keyboard.press("ArrowRight");
  await expect(galleryDialog.getByRole("status")).toContainText(
    "Analytical Engine at the Science Museum, image 2 of 2",
  );
  await expectNoSeriousAxeViolations(page);

  await page.keyboard.press("Escape");
  await expect(galleryDialog).toBeHidden();
  await expect(additionalPhotoButton).toBeFocused();
  await expectNoSeriousAxeViolations(page);
});

test("gallery lightbox reflows narrowly, at zoom-equivalent dimensions, and falls back", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const { lightboxRequests } = await mockArticleData(page, {
    failAnalyticalLightbox: true,
  });
  await page.goto("/article/Ada_Lovelace");

  const opener = page.getByRole("button", {
    name: "Open image 2 of 2: Analytical Engine at the Science Museum",
  });
  await expect(opener).toBeVisible();
  expect(lightboxRequests).not.toContain(analyticalLightboxUrl);
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "Image gallery" });
  await expect(dialog).toBeVisible();
  await expect.poll(() => lightboxRequests).toContain(analyticalLightboxUrl);
  await expect(
    dialog.getByText(
      "The larger image was unavailable, so the gallery thumbnail is shown.",
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("img", { name: "Analytical Engine mechanisms" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  await expectNoSeriousAxeViolations(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();

  // A 1280×720 viewport at 200% browser zoom has roughly this CSS viewport.
  await page.setViewportSize({ width: 640, height: 360 });
  const requestCount = lightboxRequests.length;
  await opener.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close lightbox" }),
  ).toBeFocused();
  await expect.poll(() => lightboxRequests.length).toBeGreaterThan(requestCount);
  const details = dialog.getByLabel("Image details");
  await expect(details).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Previous image" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Next image" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(details).toBeFocused();
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(640);
  await expectNoSeriousAxeViolations(page);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
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
