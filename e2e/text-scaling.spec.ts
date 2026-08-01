import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

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
  requestedDate: "2026-08-01",
  snapshotDate: "2026-08-01",
  snapshotIsStale: false,
  provider: "wikifeeds-v1",
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
    const category = url.searchParams.get("category") ?? "selected";
    const order = url.searchParams.get("order") ?? "newest";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...onThisDayFixture,
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

const expectNoPageOverflow = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const suspects = Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    )
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        const overflowX = getComputedStyle(element).overflowX;
        const localOverflow = element.scrollWidth - element.clientWidth;
        return {
          element: element.id
            ? `${element.tagName.toLowerCase()}#${element.id}`
            : `${element.tagName.toLowerCase()}.${Array.from(element.classList).slice(0, 2).join(".")}`,
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
          localOverflow,
          overflowX,
          text: (element.textContent ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 80),
        };
      })
      .filter(
        ({ left, right, localOverflow, overflowX }) =>
          left < -1 ||
          right > clientWidth + 1 ||
          (localOverflow > 1 && !["auto", "scroll"].includes(overflowX)),
      )
      .sort(
        (left, right) =>
          Math.max(right.right - clientWidth, right.localOverflow) -
          Math.max(left.right - clientWidth, left.localOverflow),
      )
      .slice(0, 8);

    return {
      clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      suspects,
    };
  });
  expect(
    geometry.scrollWidth - geometry.clientWidth,
    `Page-wide overflow: ${geometry.scrollWidth - geometry.clientWidth}px; body width: ${geometry.bodyScrollWidth}; suspects: ${JSON.stringify(geometry.suspects)}`,
  ).toBeLessThanOrEqual(1);
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
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();

  const themeButton = page.getByRole("button", {
    name: /switch to (light|dark) theme/i,
  });
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
    player.getByRole("button", { name: /^Playback speed / }),
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
