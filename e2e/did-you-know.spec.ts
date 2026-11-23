import { expect, test, type Page } from "@playwright/test";

async function holdFeed(page: Page, facts: string[]) {
  const feed = Promise.withResolvers<void>();
  await page.route("**/api/featured", async (route) => {
    await feed.promise;
    const didYouKnow = facts.map((text) => ({ text, links: [], segments: [] }));
    await route.fulfill({ json: { didYouKnow } });
  });
  await page.route("**/api/trending/brief", (route) =>
    route.fulfill({ json: { brief: null } }),
  );
  await page.goto("/did-you-know");
  await expect(page).toHaveURL(/\/#today-dyk-heading$/);
  return feed.resolve;
}

test("the legacy facts link lands on the heading when its feed arrives", async ({ page }) => {
  const releaseFeed = await holdFeed(page, ["A Wikipedia fact."]);
  releaseFeed();
  const heading = page.getByRole("heading", { name: "Did you know?" });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport({ ratio: 1 });
});

test("an empty facts feed leaves a visitor who started searching in place", async ({ page }) => {
  const releaseFeed = await holdFeed(page, []);
  const search = page.getByRole("searchbox", { name: "Search topic" });
  await search.focus();
  releaseFeed();
  await expect(page.getByText("No Did You Know items are available right now.")).toBeAttached();
  await expect(search).toBeFocused();
  await expect(search).toBeInViewport();
});
