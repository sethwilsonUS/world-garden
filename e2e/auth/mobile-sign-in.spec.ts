import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

test("one tap dismisses the large-text mobile menu while sign-in loads", async ({
  page,
}) => {
  await page.goto("/?from=mobile-menu#main-content");
  await clerk.loaded({ page });
  const returnUrl = page.url();
  await page.addStyleTag({
    content: "html { --os-text-base: 53px !important; }",
  });

  const menu = page.getByRole("navigation", { name: "Mobile navigation" });
  const releaseSignIn = Promise.withResolvers<void>();
  await page.route((url) => url.pathname === "/sign-in", async (route) => {
    await releaseSignIn.promise;
    await route.continue();
  });

  try {
    await page.getByRole("button", { name: "Open menu" }).tap();
    const startsSignIn = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/sign-in",
    );
    await Promise.all([
      menu.getByRole("button", { name: "Sign in" }).tap(),
      startsSignIn.then(async (request) => {
        await expect(menu).toBeHidden();
        const redirect = new URL(request.url()).searchParams.get("redirect_url");
        if (redirect) expect(new URL(redirect, returnUrl).href).toBe(returnUrl);
        releaseSignIn.resolve();
      }),
    ]);
  } finally {
    releaseSignIn.resolve();
  }

  await expect(page).toHaveURL((url) => url.pathname === "/sign-in");
  await expect(menu).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Welcome back to the garden." }),
  ).toBeVisible();
  const identifier = page.getByRole("textbox", { name: /email/i });
  await identifier.tap();
  await expect(identifier).toBeFocused();
});
