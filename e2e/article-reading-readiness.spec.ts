import { expect, test } from "@playwright/test";
import { createTestSection } from "../lib/test-section-narration";

test("article text and section navigation are available while listening controls load", async ({
  page,
}) => {
  const releaseScripts = Promise.withResolvers<void>();
  let articleDelivered = false;
  await page.route("**/_next/static/**/*.js*", async (route) => {
    if (articleDelivered) await releaseScripts.promise;
    await route.continue();
  });
  const title = "Ada Lovelace";
  const lead = "Ada Lovelace was a mathematician.";
  const section = createTestSection({
    title: "Early life",
    content: "Lovelace studied mathematics from an early age.",
  });
  await page.route("**/api/local-wikipedia", (route) => {
    const { operation } = route.request().postDataJSON();
    if (operation === "article") {
      articleDelivered = true;
      return route.fulfill({
        json: {
          data: {
            wikiPageId: "974",
            revisionId: "123456789",
            language: "en",
            narrationVersion: 2,
            title,
            summary: lead,
            sections: [section],
          },
        },
      });
    }
    return route.fulfill({
      json: { data: { linkCounts: [], sectionCitations: [], images: [] } },
    });
  });
  try {
    await page.goto("/article/Ada_Lovelace", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await expect(page.getByText(lead, { exact: true })).toBeVisible();
    const sections = page.getByRole("navigation", { name: "Article sections" });
    await expect(
      sections.getByText(section.title, { exact: true }),
    ).toBeVisible();
    const listen = sections.getByRole("button", {
      name: "Listen to Early life",
    });
    await expect(listen).toBeDisabled();
    await expect(page.getByText("Loading listening controls…")).toBeVisible();

    releaseScripts.resolve();
    await expect(listen).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Play all/ })).toBeEnabled();
  } finally {
    releaseScripts.resolve();
  }
});
