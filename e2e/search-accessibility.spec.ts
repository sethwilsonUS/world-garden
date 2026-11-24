import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";

type SearchFixture = {
  wikiPageId: string;
  title: string;
  description: string;
  url: string;
};

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

const searchResult = (
  wikiPageId: string,
  title: string,
  description = `${title} description`,
): SearchFixture => ({
  wikiPageId,
  title,
  description,
  url: `https://en.wikipedia.org/wiki/${title.replaceAll(" ", "_")}`,
});

const fulfillSearch = async (route: Route, results: SearchFixture[]) => {
  await route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ data: results }),
  });
};

test("async search results announce once and preserve deliberate focus", async ({
  page,
}) => {
  let releaseSearch!: () => void;
  const searchCanFinish = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });

  await page.route("**/api/local-wikipedia", async (route) => {
    const request = route.request().postDataJSON() as {
      operation?: string;
    };
    if (request.operation !== "search") {
      await route.abort();
      return;
    }
    await searchCanFinish;
    await fulfillSearch(route, [
      searchResult("1", "Moria"),
      searchResult("2", "Mines of Moria"),
    ]);
  });

  await page.goto("/search?q=Moria");

  const status = page.locator(
    'p[role="status"][aria-live="polite"][aria-atomic="true"]',
  );
  await expect(status).toHaveCount(1);
  await expect(status).toHaveText("Searching Wikipedia for Moria.");

  const refineSearch = page.getByRole("combobox", {
    name: "Search topic",
  });
  await refineSearch.focus();
  await expect(refineSearch).toBeFocused();
  await expectNoSeriousAxeViolations(page);

  releaseSearch();

  const firstResult = page.locator("ol a").first();
  await expect(firstResult).toBeVisible();
  await expect(status).toHaveText("2 search results found for Moria.");
  await expect(refineSearch).toBeFocused();
  await expect(status).toHaveCount(1);

  await firstResult.focus();
  await expect(firstResult).toBeFocused();
  const searchUrl = page.url();
  for (const key of ["1", "Control+2", "ArrowDown", "Home", "End"]) {
    await page.keyboard.press(key);
    await expect(page).toHaveURL(searchUrl);
    await expect(firstResult).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(page.locator("ol a").nth(1)).toBeFocused();

  await expectNoSeriousAxeViolations(page);
});

test("blank, empty, and failed searches expose one clear announcement path", async ({
  page,
}) => {
  await page.goto("/search");

  const blankSearch = page.getByRole("combobox", { name: "Search topic" });
  await expect(blankSearch).toBeVisible();
  await expect(blankSearch).not.toBeFocused();
  await expect(page.getByText("Plant a seed")).toBeVisible();
  await expect(
    page.locator('p[role="status"][aria-live="polite"][aria-atomic="true"]'),
  ).toHaveCount(0);
  await expectNoSeriousAxeViolations(page);

  await page.route("**/api/local-wikipedia", async (route) => {
    const request = route.request().postDataJSON() as {
      term?: string;
    };
    if (request.term === "Entwives") {
      await fulfillSearch(route, []);
      return;
    }
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "The garden gate is stuck." }),
    });
  });

  await page.goto("/search?q=Entwives");
  await expect(page.getByText("No seeds found")).toBeVisible();
  const searchStatus = page.locator(
    'p[role="status"][aria-live="polite"][aria-atomic="true"]',
  );
  await expect(searchStatus).toHaveCount(1);
  await expect(searchStatus).toHaveText(
    "No search results found for Entwives.",
  );

  await page.goto("/search?q=Silmarils");
  const alert = page.locator('.alert-banner[role="alert"]');
  await expect(alert).toContainText("Search failed");
  await expect(alert).toContainText("The garden gate is stuck.");
  await expect(searchStatus).toHaveCount(1);
  await expect(searchStatus).toBeEmpty();
  await expectNoSeriousAxeViolations(page);
});

test("long search terms and results reflow at 200% and 400% equivalents", async ({
  page,
}) => {
  const longQuery = "LongSearchTerm".repeat(18);
  const longTitle = "UnbrokenAccessibleResultTitle".repeat(8);
  const longDescription = "UnbrokenAccessibleDescription".repeat(12);

  await page.route("**/api/local-wikipedia", (route) =>
    fulfillSearch(route, [
      searchResult("long-result", longTitle, longDescription),
    ]),
  );

  for (const viewport of [
    { width: 640, height: 720 },
    { width: 320, height: 720 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/search?q=${encodeURIComponent(longQuery)}`);
    await expect(page.locator("ol a").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      longQuery,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth + 1,
        ),
      )
      .toBe(true);
  }

  await expectNoSeriousAxeViolations(page);
});

test("search controls and result actions wrap at enlarged system text sizes", async ({
  page,
}) => {
  const longQuery = "LongSearchTerm".repeat(18);
  await page.route("**/api/local-wikipedia", (route) =>
    fulfillSearch(route, [
      searchResult(
        "large-text-result",
        "A deliberately long result title for a narrow large-text layout",
        "A deliberately long description that must share the card with its action without forcing the whole page sideways.",
      ),
    ]),
  );
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/search?q=${encodeURIComponent(longQuery)}`);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });

  const searchForm = page.getByRole("search", {
    name: "Search Wikipedia articles",
  });
  const submit = searchForm.getByRole("button", { name: "Search" });
  await expect(submit).toHaveCSS("white-space", "normal");
  const submitBox = await submit.boundingBox();
  expect(submitBox).not.toBeNull();
  expect(submitBox!.height).toBeGreaterThanOrEqual(44);

  expect(
    await searchForm.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);
});

test("typeahead combobox supports keyboard navigation, decorative thumbnails, and 200% zoom reflow", async ({
  page,
}) => {
  const thumbUrl = "https://thumb.wikimedia.org/thumb/ada.svg";
  await page.route(thumbUrl, (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60"><rect width="60" height="60" fill="#036b4a"/></svg>',
    }),
  );

  await page.route("**/api/local-wikipedia", async (route) => {
    const request = route.request().postDataJSON() as {
      operation?: string;
      term?: string;
    };
    if (request.operation === "suggest") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              wikiPageId: "974",
              key: "Ada_Lovelace",
              title: "Ada Lovelace",
              description: "English mathematician and writer (1815–1852)",
              thumbnail: { source: thumbUrl, width: 60, height: 60 },
            },
            {
              wikiPageId: "1271",
              key: "Analytical_engine",
              title: "Analytical engine",
              description: "Proposed mechanical general-purpose computer",
            },
          ],
        }),
      });
      return;
    }
    if (request.operation === "article") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            wikiPageId: "974",
            revisionId: "123456789",
            title: "Ada Lovelace",
            language: "en",
            narrationVersion: 4,
            summary: "English mathematician and writer.",
            sections: [],
          },
        }),
      });
      return;
    }
    if (request.operation === "metadata") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            linkCounts: [],
            citations: [],
            sectionCitations: [],
            sectionIndexMap: [],
            images: [],
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });

  await page.goto("/search");

  const combobox = page.getByRole("combobox", { name: "Search topic" });
  const listbox = page.getByRole("listbox", {
    name: "Suggested Wikipedia articles",
  });
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await expect(listbox).toBeHidden();

  await combobox.fill("Ada");
  await expect(listbox).toBeVisible();
  await expect(combobox).toHaveAttribute("aria-expanded", "true");

  const options = listbox.getByRole("option");
  await expect(options).toHaveCount(2);
  await expect(options.first()).toContainText("Ada Lovelace");
  await expect(options.first()).toContainText(
    "English mathematician and writer (1815–1852)",
  );

  const thumbnail = options.first().locator("img");
  await expect(thumbnail).toHaveAttribute("alt", "");
  await expect(thumbnail).toHaveAttribute("aria-hidden", "true");

  const liveRegion = page.locator(
    'div[role="status"][aria-live="polite"][aria-atomic="true"]',
  );
  await expect(liveRegion).toHaveText(
    "2 suggestions available for Ada. Use up and down arrow keys to choose, or press Enter to search.",
  );

  await expectNoSeriousAxeViolations(page);

  await combobox.press("ArrowDown");
  const firstOptionId = await options.first().getAttribute("id");
  expect(firstOptionId).toBeTruthy();
  await expect(combobox).toHaveAttribute(
    "aria-activedescendant",
    firstOptionId!,
  );
  await expect(options.first()).toHaveAttribute("aria-selected", "true");

  await combobox.press("Escape");
  await expect(listbox).toBeHidden();
  await expect(combobox).toHaveAttribute("aria-expanded", "false");
  await expect(combobox).toBeFocused();
  await expect(combobox).toHaveValue("Ada");

  // Reopen at 200% text scaling on a 320px viewport without horizontal overflow.
  await page.setViewportSize({ width: 320, height: 800 });
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
  await combobox.press("ArrowDown");
  await expect(listbox).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth + 1,
    ),
  ).toBe(true);

  await combobox.press("Enter");
  await expect(page).toHaveURL(/\/article\/Ada_Lovelace$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
  ).toBeVisible();
});

test("Did you mean typo suggestion is announced and activates with one action", async ({
  page,
}) => {
  await page.route("**/api/local-wikipedia", async (route) => {
    const request = route.request().postDataJSON() as {
      operation?: string;
      term?: string;
    };
    if (request.operation !== "search") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
      return;
    }
    if (request.term === "Albrt Einstien") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            results: [],
            suggestion: "albert einstein",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          results: [
            searchResult(
              "736",
              "Albert Einstein",
              "German-born theoretical physicist (1879–1955)",
            ),
          ],
        },
      }),
    });
  });

  await page.goto("/search?q=Albrt%20Einstien");

  const status = page.locator(
    'p[role="status"][aria-live="polite"][aria-atomic="true"]',
  );
  await expect(status).toHaveText(
    "No search results found for Albrt Einstien. Did you mean albert einstein?",
  );

  const suggestionLink = page.getByRole("link", { name: "albert einstein" });
  await expect(suggestionLink).toBeVisible();
  const linkBox = await suggestionLink.boundingBox();
  expect(linkBox).not.toBeNull();
  expect(linkBox!.height).toBeGreaterThanOrEqual(44);

  await expectNoSeriousAxeViolations(page);

  await suggestionLink.click();
  await expect(page).toHaveURL(/\/search\?q=albert%20einstein$/);
  await expect(
    page.getByRole("heading", { level: 1, name: /albert einstein/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Albert Einstein/ }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Search topic" })).toHaveValue(
    "albert einstein",
  );
  await expectNoSeriousAxeViolations(page);
});
