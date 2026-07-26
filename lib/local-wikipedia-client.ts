import type {
  LocalWikipediaRequest,
  LocalWikipediaResponseFor,
  WikipediaParsedPageData,
  WikipediaRevisionIdentity,
} from "@/lib/wikipedia-contracts";
import { wikipediaRevisionKey } from "@/lib/wikipedia-utils";

const MAX_PARSED_CACHE_ENTRIES = 32;
const parsedCache = new Map<string, WikipediaParsedPageData>();
const parsedInFlight = new Map<string, Promise<WikipediaParsedPageData>>();
let parsedCacheGeneration = 0;

/** Test-only isolation hook; production callers never invoke this. */
export const resetLocalWikipediaClientCachesForTests = (): void => {
  parsedCacheGeneration += 1;
  parsedCache.clear();
  parsedInFlight.clear();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? new DOMException("The operation was aborted.", "AbortError");

const waitForCaller = <Value>(
  pending: Promise<Value>,
  signal?: AbortSignal,
): Promise<Value> => {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<Value>((resolve, reject) => {
    const handleAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", handleAbort, { once: true });
    pending.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", handleAbort);
    });
  });
};

const cacheParsedPage = (key: string, data: WikipediaParsedPageData): void => {
  parsedCache.set(key, data);
  if (parsedCache.size <= MAX_PARSED_CACHE_ENTRIES) return;
  const oldestKey = parsedCache.keys().next().value as string | undefined;
  if (oldestKey && oldestKey !== key) parsedCache.delete(oldestKey);
};

export const requestLocalWikipedia = async <
  Request extends LocalWikipediaRequest,
>(
  request: Request,
  signal?: AbortSignal,
): Promise<LocalWikipediaResponseFor<Request>> => {
  const response = await fetch("/api/local-wikipedia", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    ...(signal ? { signal } : {}),
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Local Wikipedia request failed");
  }
  const error =
    isRecord(payload) && typeof payload.error === "string"
      ? payload.error
      : null;
  if (!response.ok || error !== null) {
    throw new Error(error || "Local Wikipedia request failed");
  }
  if (!isRecord(payload) || !("data" in payload)) {
    throw new Error("Local Wikipedia request failed");
  }
  return payload.data as LocalWikipediaResponseFor<Request>;
};

/**
 * Share revision metadata work without sharing caller cancellation. Aborting a
 * component request stops only that caller from observing the result; the
 * revision-pinned request can still finish, populate the cache, and serve
 * another mounted consumer.
 */
export const requestLocalWikipediaMetadata = (
  identity: WikipediaRevisionIdentity,
  signal?: AbortSignal,
): Promise<WikipediaParsedPageData> => {
  if (signal?.aborted) return Promise.reject(abortReason(signal));

  const key = wikipediaRevisionKey(identity);
  const cached = parsedCache.get(key);
  if (cached) return waitForCaller(Promise.resolve(cached), signal);

  let pending = parsedInFlight.get(key);
  if (!pending) {
    const requestGeneration = parsedCacheGeneration;
    pending = requestLocalWikipedia({
      operation: "metadata",
      identity,
    })
      .then((data) => {
        if (requestGeneration === parsedCacheGeneration) {
          cacheParsedPage(key, data);
        }
        return data;
      })
      .finally(() => {
        if (parsedInFlight.get(key) === pending) parsedInFlight.delete(key);
      });
    parsedInFlight.set(key, pending);
  }
  return waitForCaller(pending, signal);
};
