import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const privateRoutes = [
  { path: "/dashboard", heading: /welcome back/i },
  { path: "/account", heading: /account & data/i },
  { path: "/library", heading: /^library$/i },
] as const;

const expectNoPageOverflow = async (page: Page) => {
  await page.evaluate(() => document.fonts.ready);
  const geometry = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;
    const overflowers = Array.from(
      document.querySelectorAll<HTMLElement>("body *"),
    )
      .map((element) => {
        const bounds = element.getBoundingClientRect();
        return {
          element: element.id
            ? `${element.tagName.toLowerCase()}#${element.id}`
            : element.tagName.toLowerCase(),
          left: Math.round(bounds.left),
          right: Math.round(bounds.right),
        };
      })
      .filter(({ left, right }) => left < -1 || right > clientWidth + 1)
      .slice(0, 8);

    return {
      overflow: document.documentElement.scrollWidth - clientWidth,
      overflowers,
    };
  });
  expect(
    geometry.overflow,
    `Page-wide overflowers: ${JSON.stringify(geometry.overflowers)}`,
  ).toBeLessThanOrEqual(1);
};

test.beforeEach(async ({ context, page, browserName }) => {
  test.skip(browserName !== "chromium", "OS text-scale emulation uses CDP.");
  const session = await context.newCDPSession(page);
  await session.send("Emulation.setEmulatedOSTextScale", { scale: 2 });
});

for (const route of privateRoutes) {
  test(`${route.path} reflows signed-in content at Android 200%`, async ({
    page,
  }) => {
    await page.goto(route.path);
    await expect(
      page.getByRole("heading", { name: route.heading }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() =>
          Number.parseFloat(
            getComputedStyle(document.documentElement).fontSize,
          ),
        ),
      )
      .toBe(32);
    await expectNoPageOverflow(page);
  });
}

test("signed-in dashboard keeps navigation and focus usable", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Account & data" }).first().focus();
  await expect(
    page.getByRole("link", { name: "Account & data" }).first(),
  ).toBeFocused();

  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(serious).toEqual([]);
});
