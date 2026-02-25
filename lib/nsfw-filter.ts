const WIKI_API = "https://en.wikipedia.org/w/api.php";

const NSFW_CATEGORIES = new Set([
  "Category:Sexual acts",
  "Category:Sex positions",
  "Category:Shock sites",
  "Category:Pornography terminology",
  "Category:Sexual fetishism",
  "Category:Paraphilias",
  "Category:BDSM",
  "Category:Ejaculation",
  "Category:Anal eroticism",
  "Category:Oral sex",
  "Category:Sex toys",
  "Category:Human penis",
  "Category:Human vulva",
  "Category:Gratis pornography",
]);

const NSFW_KEYWORDS = [
  "pornograph",
  "erotic",
  "sex toy",
  "sex position",
  "sexual act",
  "shock site",
  "fetish",
  "paraphilia",
  "hentai",
  "bdsm",
  "bukkake",
  "gore ",
  "obscenity",
  "strip club",
  "sex work",
  "prostitut",
];

export const isCategoryNsfw = (categoryTitle: string): boolean => {
  if (NSFW_CATEGORIES.has(categoryTitle)) return true;
  const lower = categoryTitle.toLowerCase();
  return NSFW_KEYWORDS.some((kw) => lower.includes(kw));
};

export const isDisambiguation = (categoryTitle: string): boolean =>
  categoryTitle.toLowerCase().includes("disambiguation");

/**
 * Single entry point for all "should we skip this article in random?" rules.
 * Pure function — easy to extend and unit-test.
 */
export const isUnsuitableForRandom = (
  title: string,
  categories: { title: string }[],
): boolean => {
  if (title.toLowerCase().startsWith("list of")) return true;
  return categories.some(
    (c) => isCategoryNsfw(c.title) || isDisambiguation(c.title),
  );
};

/**
 * Batch-fetch categories for a list of titles and return only titles
 * that are not NSFW and not disambiguation pages.
 */
export const filterSafeTitles = async (titles: string[]): Promise<Set<string>> => {
  if (titles.length === 0) return new Set();

  const catParams = new URLSearchParams({
    action: "query",
    format: "json",
    prop: "categories",
    titles: titles.join("|"),
    cllimit: "50",
    origin: "*",
  });

  const res = await fetch(`${WIKI_API}?${catParams}`);
  if (!res.ok) return new Set(titles);

  const data = await res.json();
  const pages: Record<string, { title: string; categories?: { title: string }[] }> =
    data.query?.pages ?? {};

  const safe = new Set<string>();
  for (const page of Object.values(pages)) {
    const cats = page.categories ?? [];
    if (!isUnsuitableForRandom(page.title, cats)) safe.add(page.title);
  }
  return safe;
};
