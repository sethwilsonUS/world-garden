import { describe, expect, it } from "vitest";
import { fetchArticleContextManifest } from "./article-context-extractor";

const runLive = process.env.ARTICLE_CONTEXT_LIVE_TEST === "1";

const getIdentity = async (title: string) => {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    titles: title,
    prop: "revisions",
    rvprop: "ids",
  }).toString();
  const response = await fetch(url, {
    headers: { "User-Agent": "CurioGarden/1.0 (live context verification)" },
  });
  const data = await response.json();
  const page = data.query.pages[0];
  return {
    wikiPageId: String(page.pageid),
    title: page.title as string,
    revisionId: String(page.revisions[0].revid),
    language: "en",
  };
};

describe.runIf(runLive)("live Wikipedia context smoke test", () => {
  it.each([
    ["Taipei", ["map", "chart"]],
    ["Yellowstone National Park", ["map"]],
    ["2024 Atlantic hurricane season", ["timeline"]],
    ["Carbon cycle", ["diagram"]],
  ] as const)("extracts expected semantic context from %s", async (title, expectedKinds) => {
    const identity = await getIdentity(title);
    const manifest = await fetchArticleContextManifest(identity);
    const kinds = new Set(manifest.blocks.map((block) => block.kind));
    expectedKinds.forEach((kind) =>
      expect(
        kinds.has(kind),
        JSON.stringify(
          manifest.blocks.map((block) => ({
            kind: block.kind,
            section: block.section,
            title: block.title,
          })),
        ),
      ).toBe(true),
    );
    expect(JSON.stringify(manifest)).not.toMatch(/<script|<svg|data-mw-chart/i);
  }, 30_000);
});
