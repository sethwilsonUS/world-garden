const WIKI_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";

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

function normalizeTitle(title: string): string {
  return title.replace(/_/g, " ").trim();
}

// MediaWiki allows max 50 titles per query for non-bots.
// Keep batches small so cllimit=max covers all categories per batch.
const BATCH_SIZE = 10;

/**
 * Batch-fetch categories for a list of titles and return only titles
 * that are not NSFW and not disambiguation pages.
 * Normalizes titles to handle underscore/space mismatches between APIs.
 */
export const filterSafeTitles = async (titles: string[]): Promise<Set<string>> => {
  if (titles.length === 0) return new Set();

  const safe = new Set<string>();

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE);
    try {
      const catParams = new URLSearchParams({
        action: "query",
        format: "json",
        prop: "categories",
        titles: batch.join("|"),
        cllimit: "max",
        origin: "*",
      });

      const res = await fetch(`${WIKI_API}?${catParams}`, {
        headers: { "User-Agent": USER_AGENT },
      });

      if (!res.ok) {
        // On API failure, let these titles through rather than blocking all
        for (const t of batch) safe.add(t);
        continue;
      }

      const data = await res.json();
      const pages: Record<string, { title: string; categories?: { title: string }[] }> =
        data.query?.pages ?? {};

      // Build a lookup from normalized title → original input title
      const inputByNormalized = new Map<string, string>();
      for (const t of batch) {
        inputByNormalized.set(normalizeTitle(t), t);
      }

      const pagesFound = new Set<string>();
      for (const page of Object.values(pages)) {
        const cats = page.categories ?? [];
        const norm = normalizeTitle(page.title);
        pagesFound.add(norm);

        if (!isUnsuitableForRandom(page.title, cats)) {
          // Add back the original input title so .has() works in the caller
          const original = inputByNormalized.get(norm);
          if (original) safe.add(original);
          safe.add(page.title);
          safe.add(norm);
        }
      }

      // Any title not found in the API response (missing/deleted pages) — let through
      for (const t of batch) {
        if (!pagesFound.has(normalizeTitle(t))) {
          safe.add(t);
        }
      }
    } catch {
      // On network error, let batch through
      for (const t of batch) safe.add(t);
    }
  }

  return safe;
};
