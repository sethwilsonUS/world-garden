import { isUnsuitableForRandom } from "@/lib/nsfw-filter";

const WIKI_API = "https://en.wikipedia.org/w/api.php";
export const RANDOM_ARTICLE_API_USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";
export const MIN_RANDOM_ARTICLE_BYTES = 4_000;
export const RANDOM_ARTICLE_TIMEOUT_MS = 8_000;

const RANDOM_CANDIDATE_LIMIT = 10;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_CONTINUATION_PAGES = 5;

export type FetchSafeRandomArticleOptions = {
  fetchImpl?: typeof fetch;
  minByteLength?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type RawRandomCategory = { title?: string };
type RawRandomPage = {
  pageid?: number;
  ns?: number;
  title?: string;
  missing?: boolean | string;
  length?: number;
  categories?: RawRandomCategory[];
  pageprops?: Record<string, unknown>;
};

type AccumulatedRandomCandidate = {
  key: string;
  ns: number;
  title: string;
  missing: boolean;
  length?: number;
  categories: { title: string }[];
  pageprops?: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const extractResponsePages = (rawPages: unknown): RawRandomPage[] => {
  if (Array.isArray(rawPages)) {
    return rawPages.filter((page): page is RawRandomPage => isRecord(page));
  }
  if (isRecord(rawPages)) {
    return Object.values(rawPages).filter((page): page is RawRandomPage =>
      isRecord(page),
    );
  }
  return [];
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

const hasPropertyContinuation = (
  continuation: Record<string, string>,
): boolean =>
  Object.keys(continuation).some(
    (key) => key !== "grncontinue" && key !== "continue",
  );

const cancelRejectedResponse = async (
  response: Response,
  controller: AbortController,
): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch (error: unknown) {
    console.warn(
      "[random-article] Failed to cancel rejected Wikipedia response body:",
      error instanceof Error ? error.message : String(error),
    );
  }
  controller.abort();
};

const fetchRandomCandidateBatch = async (
  options: FetchSafeRandomArticleOptions,
): Promise<{
  candidates: AccumulatedRandomCandidate[];
  batchComplete: boolean;
}> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? RANDOM_ARTICLE_TIMEOUT_MS;
  const baseParams: Record<string, string> = {
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "random",
    grnnamespace: "0",
    grnfilterredir: "nonredirects",
    grnlimit: String(RANDOM_CANDIDATE_LIMIT),
    prop: "categories|pageprops|info",
    clshow: "!hidden",
    cllimit: "max",
    ppprop: "disambiguation",
    origin: "*",
  };

  const candidatesByKey = new Map<string, AccumulatedRandomCandidate>();
  const seenContinuations = new Set<string>();
  let continuation: Record<string, string> | null = null;
  let batchComplete = false;

  for (let pageIndex = 0; pageIndex < MAX_CONTINUATION_PAGES; pageIndex += 1) {
    const params = new URLSearchParams(
      continuation ? { ...baseParams, ...continuation } : baseParams,
    );
    const controller = new AbortController();
    const requestSignal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let payload: unknown;
    try {
      const response = await fetchImpl(`${WIKI_API}?${params}`, {
        headers: { "Api-User-Agent": RANDOM_ARTICLE_API_USER_AGENT },
        signal: requestSignal,
      });
      if (!response.ok) {
        await cancelRejectedResponse(response, controller);
        throw new Error(`Failed to fetch random articles (${response.status})`);
      }
      payload = await response.json();
    } finally {
      clearTimeout(timeout);
    }

    if (!isRecord(payload)) {
      throw new Error("Wikipedia returned an invalid random-article response");
    }
    if (payload.error !== undefined) {
      const apiError = isRecord(payload.error)
        ? typeof payload.error.info === "string" && payload.error.info.trim()
          ? payload.error.info.trim()
          : typeof payload.error.code === "string" && payload.error.code.trim()
            ? payload.error.code.trim()
            : null
        : null;
      throw new Error(
        apiError
          ? `Wikipedia random-article API error: ${apiError}`
          : "Wikipedia returned an error for random articles",
      );
    }

    const queryData = isRecord(payload.query) ? payload.query : {};
    for (const rawPage of extractResponsePages(queryData.pages)) {
      if (typeof rawPage.title !== "string" || !rawPage.title.trim()) continue;
      const key =
        typeof rawPage.pageid === "number" && Number.isSafeInteger(rawPage.pageid)
          ? `id:${rawPage.pageid}`
          : `title:${rawPage.title}`;
      const existing = candidatesByKey.get(key);
      const pageCategories = (rawPage.categories ?? []).flatMap((category) =>
        typeof category.title === "string" && category.title.trim()
          ? [{ title: category.title }]
          : [],
      );
      const isMissing = rawPage.missing === true || rawPage.missing === "";
      const length =
        typeof rawPage.length === "number" && Number.isFinite(rawPage.length)
          ? rawPage.length
          : undefined;
      const ns = typeof rawPage.ns === "number" ? rawPage.ns : 0;

      if (existing) {
        existing.missing = existing.missing || isMissing;
        if (length !== undefined) existing.length = length;
        existing.categories.push(...pageCategories);
        if (isRecord(rawPage.pageprops)) {
          existing.pageprops = {
            ...existing.pageprops,
            ...rawPage.pageprops,
          };
        }
      } else {
        candidatesByKey.set(key, {
          key,
          ns,
          title: rawPage.title,
          missing: isMissing,
          ...(length !== undefined ? { length } : {}),
          categories: pageCategories,
          ...(isRecord(rawPage.pageprops)
            ? { pageprops: { ...rawPage.pageprops } }
            : {}),
        });
      }
    }

    if (payload.batchcomplete === true || payload.batchcomplete === "") {
      batchComplete = true;
      break;
    }

    const nextContinuation = extractContinuationParams(payload.continue);
    if (!nextContinuation || !hasPropertyContinuation(nextContinuation)) {
      // Without MediaWiki's explicit batchcomplete marker, never treat the
      // batch as verified complete.
      break;
    }

    const continuationKey = JSON.stringify(
      Object.entries(nextContinuation).sort(([a], [b]) => a.localeCompare(b)),
    );
    if (seenContinuations.has(continuationKey)) {
      break;
    }
    seenContinuations.add(continuationKey);
    continuation = nextContinuation;
  }

  return {
    candidates: [...candidatesByKey.values()],
    batchComplete,
  };
};

export const fetchSafeRandomArticle = async (
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  options: FetchSafeRandomArticleOptions = {},
): Promise<string> => {
  const minByteLength = options.minByteLength ?? MIN_RANDOM_ARTICLE_BYTES;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { candidates, batchComplete } =
      await fetchRandomCandidateBatch(options);
    if (!batchComplete) continue;
    if (candidates.length === 0) throw new Error("No articles found");

    for (const candidate of candidates) {
      if (candidate.missing || candidate.ns !== 0) continue;
      if (
        !isUnsuitableForRandom(candidate.title, candidate.categories, {
          pageprops: candidate.pageprops,
          byteLength: candidate.length,
          minByteLength,
        })
      ) {
        return candidate.title;
      }
    }
  }

  throw new Error("Could not find a suitable article");
};
