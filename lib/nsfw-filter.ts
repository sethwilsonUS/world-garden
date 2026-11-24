import { fetchWikimediaActionApi } from "./wikimedia-client";

const WIKI_API = "https://en.wikipedia.org/w/api.php";

// MediaWiki allows max 50 titles per query for non-bots.
// Keep batches small so visible categories usually complete in one response.
const BATCH_SIZE = 10;
const MAX_CONTINUATION_PAGES = 10;
export const NSFW_FILTER_TIMEOUT_MS = 8_000;

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

export type PageSafetySignals = {
  pageprops?: Record<string, unknown>;
  byteLength?: number;
  minByteLength?: number;
};

export type FilterSafeTitlesOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type RawCategory = { title?: string };
type RawTitleMapping = { from?: string; to?: string };
type RawSafetyPage = {
  pageid?: number;
  ns?: number;
  title?: string;
  missing?: boolean | string;
  categories?: RawCategory[];
  pageprops?: Record<string, unknown>;
};

type AccumulatedSafetyPage = {
  title: string;
  missing: boolean;
  categories: { title: string }[];
  pageprops?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const isCategoryNsfw = (categoryTitle: string): boolean => {
  if (NSFW_CATEGORIES.has(categoryTitle)) return true;
  const lower = categoryTitle.toLowerCase();
  return NSFW_KEYWORDS.some((kw) => lower.includes(kw));
};

export const isDisambiguation = (categoryTitle: string): boolean =>
  categoryTitle.toLowerCase().includes("disambiguation");

export const isDisambiguationPageProps = (
  pageprops?: Record<string, unknown>,
): boolean => Boolean(pageprops && Object.hasOwn(pageprops, "disambiguation"));

/**
 * Single entry point for all "should we skip this article?" safety rules.
 * Pure function — easy to extend and unit-test.
 */
export const isUnsuitableForRandom = (
  title: string,
  categories: { title: string }[],
  signals?: PageSafetySignals,
): boolean => {
  if (title.toLowerCase().startsWith("list of")) return true;
  if (isDisambiguationPageProps(signals?.pageprops)) return true;
  if (
    signals?.minByteLength !== undefined &&
    (typeof signals.byteLength !== "number" ||
      !Number.isFinite(signals.byteLength) ||
      signals.byteLength < signals.minByteLength)
  ) {
    return true;
  }
  return categories.some(
    (c) => isCategoryNsfw(c.title) || isDisambiguation(c.title),
  );
};

function normalizeTitle(title: string): string {
  return title.replace(/_/g, " ").trim();
}

const cancelRejectedResponse = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch (error: unknown) {
    console.warn(
      "[nsfw-filter] Failed to cancel rejected Wikipedia response body:",
      error instanceof Error ? error.message : String(error),
    );
  }
};

const extractContinuationParams = (
  value: unknown,
): Record<string, string> | null => {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string | number] =>
      typeof entry[1] === "string" || typeof entry[1] === "number",
  );
  if (entries.length === 0) return null;
  return Object.fromEntries(entries.map(([key, item]) => [key, String(item)]));
};

const extractResponsePages = (rawPages: unknown): RawSafetyPage[] => {
  if (Array.isArray(rawPages)) {
    return rawPages.filter((page): page is RawSafetyPage => isRecord(page));
  }
  if (isRecord(rawPages)) {
    return Object.values(rawPages).filter((page): page is RawSafetyPage =>
      isRecord(page),
    );
  }
  return [];
};

const recordMappings = (
  target: Map<string, string>,
  rawMappings: unknown,
): void => {
  if (!Array.isArray(rawMappings)) return;
  for (const item of rawMappings) {
    if (!isRecord(item)) continue;
    const mapping = item as RawTitleMapping;
    if (typeof mapping.from !== "string" || typeof mapping.to !== "string") {
      continue;
    }
    const from = normalizeTitle(mapping.from);
    const to = normalizeTitle(mapping.to);
    if (from && to) {
      target.set(from, to);
    }
  }
};

const resolveCanonicalTitle = (
  rawTitle: string,
  normalizedMap: ReadonlyMap<string, string>,
  redirectsMap: ReadonlyMap<string, string>,
): string => {
  let current = normalizeTitle(rawTitle);
  const normalized = normalizedMap.get(current);
  if (normalized) {
    current = normalized;
  }

  const visited = new Set<string>();
  while (redirectsMap.has(current) && !visited.has(current)) {
    visited.add(current);
    current = redirectsMap.get(current)!;
  }
  return current;
};

type BatchSafetyMetadata = {
  pagesByNormTitle: Map<string, AccumulatedSafetyPage>;
  normalizedMap: Map<string, string>;
  redirectsMap: Map<string, string>;
};

type BatchSafetyResult =
  | { status: "failed" }
  | ({ status: "complete" } & BatchSafetyMetadata)
  | ({
      status: "incomplete";
      reason: "continuation_error" | "continuation_incomplete";
    } & BatchSafetyMetadata);

const fetchBatchSafetyMetadata = async (
  batch: string[],
  options: FilterSafeTitlesOptions,
): Promise<BatchSafetyResult> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? NSFW_FILTER_TIMEOUT_MS;
  const baseParams: Record<string, string> = {
    action: "query",
    prop: "categories|pageprops",
    titles: batch.join("|"),
    clshow: "!hidden",
    cllimit: "max",
    ppprop: "disambiguation",
    redirects: "1",
  };

  const pagesByNormTitle = new Map<string, AccumulatedSafetyPage>();
  const normalizedMap = new Map<string, string>();
  const redirectsMap = new Map<string, string>();
  const seenContinuations = new Set<string>();
  let continuation: Record<string, string> | null = null;
  let receivedAnyResponse = false;

  const partialErrorResult = (): BatchSafetyResult =>
    receivedAnyResponse
      ? {
          status: "incomplete",
          reason: "continuation_error",
          pagesByNormTitle,
          normalizedMap,
          redirectsMap,
        }
      : { status: "failed" };

  for (let pageIndex = 0; pageIndex < MAX_CONTINUATION_PAGES; pageIndex += 1) {
    const requestParams = continuation
      ? { ...baseParams, ...continuation }
      : baseParams;

    let payload: unknown;
    try {
      const response = await fetchWikimediaActionApi(WIKI_API, requestParams, {
        fetchImpl,
        timeoutMs,
        signal: options.signal,
      });
      if (!response.ok) {
        await cancelRejectedResponse(response);
        return partialErrorResult();
      }
      payload = await response.json();
    } catch (error: unknown) {
      if (options.signal?.aborted) throw error;
      console.warn(
        receivedAnyResponse
          ? "[nsfw-filter] Safety metadata continuation failed; preserving partial rejections:"
          : "[nsfw-filter] Safety metadata batch failed; failing open for batch:",
        error instanceof Error ? error.message : String(error),
      );
      return partialErrorResult();
    }

    if (!isRecord(payload) || payload.error !== undefined) {
      return partialErrorResult();
    }

    receivedAnyResponse = true;
    const queryData = isRecord(payload.query) ? payload.query : {};
    recordMappings(normalizedMap, queryData.normalized);
    recordMappings(redirectsMap, queryData.redirects);

    for (const rawPage of extractResponsePages(queryData.pages)) {
      if (typeof rawPage.title !== "string" || !rawPage.title.trim()) continue;
      const normTitle = normalizeTitle(rawPage.title);
      const existing = pagesByNormTitle.get(normTitle);
      const pageCategories = (rawPage.categories ?? []).flatMap((category) =>
        typeof category.title === "string" && category.title.trim()
          ? [{ title: category.title }]
          : [],
      );
      const isMissing =
        rawPage.missing === true || rawPage.missing === "";

      if (existing) {
        existing.missing = existing.missing || isMissing;
        existing.categories.push(...pageCategories);
        if (isRecord(rawPage.pageprops)) {
          existing.pageprops = {
            ...existing.pageprops,
            ...rawPage.pageprops,
          };
        }
      } else {
        pagesByNormTitle.set(normTitle, {
          title: rawPage.title,
          missing: isMissing,
          categories: pageCategories,
          ...(isRecord(rawPage.pageprops)
            ? { pageprops: { ...rawPage.pageprops } }
            : {}),
        });
      }
    }

    if (payload.batchcomplete === true || payload.batchcomplete === "") {
      return {
        status: "complete",
        pagesByNormTitle,
        normalizedMap,
        redirectsMap,
      };
    }

    const nextContinuation = extractContinuationParams(payload.continue);
    if (!nextContinuation) {
      return {
        status: "incomplete",
        reason: "continuation_incomplete",
        pagesByNormTitle,
        normalizedMap,
        redirectsMap,
      };
    }

    const continuationKey = JSON.stringify(
      Object.entries(nextContinuation).sort(([a], [b]) => a.localeCompare(b)),
    );
    if (seenContinuations.has(continuationKey)) {
      return {
        status: "incomplete",
        reason: "continuation_incomplete",
        pagesByNormTitle,
        normalizedMap,
        redirectsMap,
      };
    }
    seenContinuations.add(continuationKey);
    continuation = nextContinuation;
  }

  return {
    status: "incomplete",
    reason: "continuation_incomplete",
    pagesByNormTitle,
    normalizedMap,
    redirectsMap,
  };
};

const evaluateBatchSafety = async (
  batch: string[],
  options: FilterSafeTitlesOptions,
  safe: Set<string>,
  allowFailOpen: boolean,
): Promise<void> => {
  const result = await fetchBatchSafetyMetadata(batch, options);

  if (result.status === "failed") {
    if (allowFailOpen) {
      // On a first-request upstream failure with no metadata, let these
      // titles through rather than blocking all trending articles.
      for (const t of batch) safe.add(t);
    }
    return;
  }

  const { pagesByNormTitle, normalizedMap, redirectsMap } = result;

  if (result.status === "complete") {
    for (const originalTitle of batch) {
      const resolvedNorm = resolveCanonicalTitle(
        originalTitle,
        normalizedMap,
        redirectsMap,
      );
      const page = pagesByNormTitle.get(resolvedNorm);

      // Missing or deleted pages are not blocked by the safety filter.
      if (!page || page.missing) {
        safe.add(originalTitle);
        continue;
      }

      if (
        !isUnsuitableForRandom(page.title, page.categories, {
          pageprops: page.pageprops,
        })
      ) {
        safe.add(originalTitle);
        safe.add(normalizeTitle(originalTitle));
        safe.add(page.title);
        safe.add(normalizeTitle(page.title));
      }
    }
    return;
  }

  // Batch metadata is incomplete: keep every confirmed rejection out, and
  // never classify unverified titles as safe. When a batch simply exhausted
  // continuations or looped on a token, bisect the remaining unverified titles
  // so safe titles can still complete in smaller batches.
  const unverified: string[] = [];
  for (const originalTitle of batch) {
    const resolvedNorm = resolveCanonicalTitle(
      originalTitle,
      normalizedMap,
      redirectsMap,
    );
    const page = pagesByNormTitle.get(resolvedNorm);
    if (
      page &&
      !page.missing &&
      isUnsuitableForRandom(page.title, page.categories, {
        pageprops: page.pageprops,
      })
    ) {
      continue;
    }
    unverified.push(originalTitle);
  }

  if (
    result.reason !== "continuation_incomplete" ||
    unverified.length === 0 ||
    batch.length <= 1
  ) {
    return;
  }

  if (unverified.length === 1) {
    await evaluateBatchSafety(unverified, options, safe, false);
    return;
  }

  const mid = Math.ceil(unverified.length / 2);
  await evaluateBatchSafety(unverified.slice(0, mid), options, safe, false);
  await evaluateBatchSafety(unverified.slice(mid), options, safe, false);
};

/**
 * Batch-fetch visible categories and disambiguation pageprops for a list of
 * titles and return only titles that are not NSFW, disambiguation, or list
 * pages. Follows MediaWiki continuations and resolves redirects/normalizations
 * back to the original candidate titles.
 */
export const filterSafeTitles = async (
  titles: string[],
  options: FilterSafeTitlesOptions = {},
): Promise<Set<string>> => {
  if (titles.length === 0) return new Set();

  const safe = new Set<string>();

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const batch = titles.slice(i, i + BATCH_SIZE);
    await evaluateBatchSafety(batch, options, safe, true);
  }

  return safe;
};
