import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const expectNoSeriousAxeViolations = async (page: Page) => {
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter(
      (violation) =>
        violation.impact === "critical" || violation.impact === "serious",
    ),
  ).toEqual([]);
};

for (const viewport of [
  { name: "200% equivalent", width: 640, height: 800 },
  { name: "400% equivalent", width: 320, height: 800 },
]) {
  test(`feedback form reflows at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/feedback");

    await expect(
      page.getByRole("heading", { level: 1, name: "Help the garden learn." }),
    ).toBeVisible();
    await expect(
      page.getByRole("form", { name: "Share feedback" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Send feedback" }),
    ).toBeVisible();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(0);
    await expectNoSeriousAxeViolations(page);
  });
}

test("feedback route does not steal focus and supports skip navigation", async ({
  page,
}) => {
  await page.goto("/feedback");

  await expect(page.locator("body")).toBeFocused();
  const skipLink = page.getByRole("link", {
    name: "Skip to main content",
  });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Back to the garden" }),
  ).toBeFocused();
});

test("keyboard-only feedback flow validates, focuses, and confirms persistence", async ({
  page,
}) => {
  let submittedBody: unknown;
  await page.route("**/api/feedback", async (route) => {
    submittedBody = route.request().postDataJSON();
    await route.fulfill({
      status: 202,
      contentType: "application/json",
      body: JSON.stringify({ accepted: true }),
    });
  });
  await page.goto("/feedback");

  const submit = page.getByRole("button", { name: "Send feedback" });
  await submit.focus();
  await page.keyboard.press("Enter");
  const kind = page.getByLabel("What are you sharing? (required)");
  await expect(kind).toBeFocused();
  await expect(kind).toHaveAttribute("aria-invalid", "true");

  await kind.selectOption("accessibility");
  await kind.focus();
  await page.keyboard.press("Tab");
  const message = page.getByLabel("What would you like us to know? (required)");
  await expect(message).toBeFocused();
  await page.keyboard.type("The player label is unclear.");
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel("Browser, device, or access tools (optional)"),
  ).toBeFocused();
  await page.keyboard.type("VoiceOver with Safari");
  await page.keyboard.press("Tab");
  await expect(
    page.getByLabel(
      "Email address (optional unless you volunteer for research)",
    ),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("checkbox", {
      name: /I'm open to a short product research conversation/,
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("form", { name: "Share feedback" }).getByRole("status"),
  ).toHaveText("Thank you. Your feedback was sent.");
  expect(submittedBody).toEqual({
    kind: "accessibility",
    message: "The player label is unclear.",
    environment: "VoiceOver with Safari",
    researchOptIn: false,
  });
});

test("a persistence failure keeps the visitor's words", async ({ page }) => {
  await page.route("**/api/feedback", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Feedback is temporarily unavailable." }),
    }),
  );
  await page.goto("/feedback");

  await page
    .getByLabel("What are you sharing? (required)")
    .selectOption("technical");
  const message = page.getByLabel("What would you like us to know? (required)");
  await message.fill("Playback stopped at the third section.");
  await page.getByRole("button", { name: "Send feedback" }).click();

  await expect(
    page.getByRole("form", { name: "Share feedback" }).getByRole("alert"),
  ).toHaveText(
    "The feedback form is temporarily unavailable. Your words are still here, so you can try again later.",
  );
  await expect(message).toHaveValue("Playback stopped at the third section.");
});

test("article feedback keeps its context and return path", async ({ page }) => {
  await page.goto(
    "/feedback?articleTitle=Lothl%C3%B3rien&articleSlug=Lothl%C3%B3rien&articleRevisionId=123456",
  );

  await expect(
    page.getByText("Feedback on this article", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Wikipedia revision 123456")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Back to Lothlórien" }),
  ).toHaveAttribute("href", "/article/Lothl%C3%B3rien");
});

test("long article context reflows without horizontal scrolling", async ({
  page,
}) => {
  const title = "A".repeat(500);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(
    `/feedback?articleTitle=${title}&articleSlug=Long_article&articleRevisionId=42`,
  );

  await expect(
    page
      .getByRole("form", { name: "Share feedback" })
      .getByText(title, { exact: true }),
  ).toBeVisible();
  const horizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
});

test("the feedback privacy anchor clears the fixed navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/privacy#privacy-feedback");

  const target = page.locator("#privacy-feedback");
  await expect(target).toBeVisible();
  const positions = await page.evaluate(() => {
    const heading = document.querySelector("#privacy-feedback");
    const navbar = document.querySelector(".navbar");
    if (!heading || !navbar) return null;
    return {
      headingTop: heading.getBoundingClientRect().top,
      navbarBottom: navbar.getBoundingClientRect().bottom,
    };
  });
  expect(positions).not.toBeNull();
  expect(positions!.headingTop).toBeGreaterThanOrEqual(
    positions!.navbarBottom,
  );
});
