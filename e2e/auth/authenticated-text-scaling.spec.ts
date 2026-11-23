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

test("the member note leads to private feed controls and keyboard-accessible badges at 320px", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/");
  const dashboardLink = page.getByRole("complementary", { name: "Account" })
    .getByRole("link", { name: "Open Dashboard" });
  await expect(dashboardLink).toBeVisible();
  await expectNoPageOverflow(page);
  await dashboardLink.press("Enter");

  const feed = page.getByRole("region", { name: /your private feed/i });
  await expect(feed.getByRole("button").first()).toBeVisible();
  await expectNoPageOverflow(page);

  const badge = page.getByRole("button", { name: /^open .+ badge details/i }).first();
  await badge.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /^close .+ badge details/i })).toBeFocused();
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(badge).toBeFocused();
});

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
