import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectNoPageOverflow } from "../support/expect-no-page-overflow";

const privateRoutes = [
  { path: "/dashboard", heading: /welcome back/i },
  { path: "/account", heading: /account & data/i },
  { path: "/library", heading: /^library$/i },
] as const;

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
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
      ),
    )
    .toBe(32);

  await page.getByRole("button", { name: "Open menu" }).click();
  const mobileNavigation = page.getByRole("navigation", {
    name: "Mobile navigation",
  });
  await expect(mobileNavigation).toBeVisible();

  await mobileNavigation.getByRole("button", { name: /open user/i }).click();
  const accountDataButton = page.getByRole("button", {
    name: "Account & data",
  });
  await expect(accountDataButton).toBeVisible();
  await accountDataButton.focus();
  await expect(accountDataButton).toBeFocused();

  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(serious).toEqual([]);
});
