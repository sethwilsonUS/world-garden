import { isUnsuitableForRandom } from "@/lib/nsfw-filter";

const WIKI_API = "https://en.wikipedia.org/w/api.php";

export const fetchSafeRandomArticle = async (
  maxAttempts = 2,
): Promise<string> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const randomParams = new URLSearchParams({
      action: "query",
      format: "json",
      list: "random",
      rnnamespace: "0",
      rnlimit: "8",
      origin: "*",
    });
    const randomRes = await fetch(`${WIKI_API}?${randomParams}`);
    if (!randomRes.ok) throw new Error("Failed to fetch random articles");
    const randomData = await randomRes.json();
    const candidates: { title: string }[] = randomData.query?.random ?? [];
    if (candidates.length === 0) throw new Error("No articles found");

    const titles = candidates.map((c) => c.title);
    const catParams = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "categories",
      titles: titles.join("|"),
      cllimit: "50",
      origin: "*",
    });
    const catRes = await fetch(`${WIKI_API}?${catParams}`);
    if (!catRes.ok) throw new Error("Failed to check categories");
    const catData = await catRes.json();
    const pages: Record<
      string,
      { title: string; categories?: { title: string }[] }
    > = catData.query?.pages ?? {};

    for (const page of Object.values(pages)) {
      const cats = page.categories ?? [];
      if (!isUnsuitableForRandom(page.title, cats)) return page.title;
    }
  }

  throw new Error("Could not find a suitable article");
};
