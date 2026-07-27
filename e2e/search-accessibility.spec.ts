import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type Page,
  type Route,
} from "@playwright/test";

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

  const refineSearch = page.getByRole("searchbox", {
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

  const blankSearch = page.getByRole("searchbox", { name: "Search topic" });
  await expect(blankSearch).toBeVisible();
  await expect(blankSearch).not.toBeFocused();
  await expect(page.getByText("Plant a seed")).toBeVisible();
  await expect(
    page.locator(
      'p[role="status"][aria-live="polite"][aria-atomic="true"]',
    ),
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
            document.documentElement.clientWidth,
        ),
      )
      .toBe(true);
  }

  await expectNoSeriousAxeViolations(page);
});
