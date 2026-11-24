/**
 * Shared server-side HTTP client for Wikimedia APIs (Wikipedia Action API,
 * Wikipedia REST v1, Wikimedia Commons, Pageviews, and api.wikimedia.org).
 *
 * Keeps User-Agent identification, AbortSignal timeouts, Retry-After /
 * capped jittered 429 & 503 backoff, optional OAuth 2.0 bearer auth for
 * api.wikimedia.org, and server-side Action API conventions (formatversion=2,
 * no browser-only origin=*) in one platform-neutral module usable by Next.js
 * server routes, lib utilities, and Convex actions alike.
 */

export const WIKIMEDIA_USER_AGENT =
  "CurioGarden/1.0 (https://curiogarden.org; accessibility-first Wikipedia audio reader)";

export const WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV = "WIKIMEDIA_OAUTH_ACCESS_TOKEN";
export const WIKIMEDIA_API_PORTAL_HOST = "api.wikimedia.org";

export const DEFAULT_WIKIMEDIA_TIMEOUT_MS = 10_000;
export const DEFAULT_WIKIMEDIA_MAX_RETRIES = 2;
export const DEFAULT_WIKIMEDIA_BASE_BACKOFF_MS = 250;
export const DEFAULT_WIKIMEDIA_MAX_RETRY_DELAY_MS = 5_000;
export const DEFAULT_WIKIMEDIA_JITTER_RATIO = 0.2;

const RETRYABLE_STATUS_CODES = new Set([429, 503]);
const wikimediaTimeoutErrors = new WeakSet<object>();

export const isWikimediaTimeoutError = (error: unknown): boolean =>
  Boolean(
    error && typeof error === "object" && wikimediaTimeoutErrors.has(error),
  );

type NextFetchOptions = {
  revalidate?: number | false;
  tags?: string[];
};

export type WikimediaFetchOptions = Omit<RequestInit, "headers" | "signal"> & {
  headers?: HeadersInit;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxRetryDelayMs?: number;
  jitterRatio?: number;
  /**
   * Optional explicit OAuth 2.0 bearer token override for `api.wikimedia.org`.
   * When omitted, falls back to `process.env.WIKIMEDIA_OAUTH_ACCESS_TOKEN`.
   * Pass `null` or `""` to suppress token injection for a specific request.
   */
  accessToken?: string | null;
  /** Next.js App Router fetch caching extension, passed through when set. */
  next?: NextFetchOptions;
  /** Deterministic hooks for unit testing backoff/date parsing. */
  now?: () => number;
  random?: () => number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const createAbortError = (): DOMException =>
  new DOMException("The operation was aborted.", "AbortError");

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw signal.reason ?? createAbortError();
  }
};

const readConfiguredAccessToken = (): string | undefined => {
  // Never attempt to inject a server OAuth token in a browser context.
  if (typeof window !== "undefined") return undefined;
  if (typeof process === "undefined" || !process.env) return undefined;
  const raw = process.env[WIKIMEDIA_OAUTH_ACCESS_TOKEN_ENV];
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed || undefined;
};

export const isWikimediaApiPortalUrl = (input: string | URL): boolean => {
  try {
    const parsed = input instanceof URL ? input : new URL(input);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.toLocaleLowerCase("en-US") === WIKIMEDIA_API_PORTAL_HOST
    );
  } catch {
    return false;
  }
};

const normalizeHeadersToRecord = (
  headersInit?: HeadersInit,
): Record<string, string> => {
  const result: Record<string, string> = {};
  if (!headersInit) return result;
  if (headersInit instanceof Headers) {
    headersInit.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headersInit)) {
    for (const [key, value] of headersInit) {
      result[key] = value;
    }
    return result;
  }
  for (const [key, value] of Object.entries(headersInit)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
};

const hasHeaderCaseInsensitive = (
  headers: Record<string, string>,
  targetLower: string,
): boolean =>
  Object.keys(headers).some(
    (key) => key.toLocaleLowerCase("en-US") === targetLower,
  );

export const buildWikimediaHeaders = (
  input: string | URL,
  options: Pick<WikimediaFetchOptions, "headers" | "accessToken"> = {},
): Record<string, string> => {
  const headers = normalizeHeadersToRecord(options.headers);

  if (!hasHeaderCaseInsensitive(headers, "user-agent")) {
    headers["User-Agent"] = WIKIMEDIA_USER_AGENT;
  }

  const resolvedToken =
    options.accessToken !== undefined
      ? (options.accessToken?.trim() || undefined)
      : readConfiguredAccessToken();

  if (
    resolvedToken &&
    isWikimediaApiPortalUrl(input) &&
    !hasHeaderCaseInsensitive(headers, "authorization")
  ) {
    headers.Authorization = `Bearer ${resolvedToken}`;
  }

  return headers;
};

/**
 * Parse an HTTP `Retry-After` header in either delta-seconds or HTTP-date
 * format into a non-negative delay in milliseconds.
 */
export const parseRetryAfterMs = (
  headerValue: string | null,
  nowMs = Date.now(),
): number | undefined => {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (!trimmed) return undefined;

  if (/^\d+(?:\.\d+)?$/u.test(trimmed)) {
    const seconds = Number(trimmed);
    const ms = Math.round(seconds * 1_000);
    if (Number.isFinite(seconds) && seconds >= 0 && Number.isFinite(ms)) {
      return ms;
    }
    return undefined;
  }

  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) {
    return Math.max(0, parsedDate - nowMs);
  }

  return undefined;
};

export const parseRetryAfterSeconds = (
  headerValue: string | null,
  nowMs = Date.now(),
): number | undefined => {
  const ms = parseRetryAfterMs(headerValue, nowMs);
  return ms === undefined ? undefined : Math.ceil(ms / 1_000);
};

const computeRetryDelayMs = ({
  response,
  attempt,
  baseBackoffMs,
  maxRetryDelayMs,
  jitterRatio,
  now,
  random,
}: {
  response: Response;
  attempt: number;
  baseBackoffMs: number;
  maxRetryDelayMs: number;
  jitterRatio: number;
  now: () => number;
  random: () => number;
}): number | undefined => {
  const retryAfterHeader = response.headers?.get("retry-after") ?? null;
  if (retryAfterHeader !== null) {
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader, now());
    if (retryAfterMs !== undefined) {
      // Honor explicit server backoff up to our cap. When the server asks for
      // longer than maxRetryDelayMs, return the 429/503 response immediately
      // rather than blocking a worker or retrying ahead of Retry-After.
      return retryAfterMs <= maxRetryDelayMs ? retryAfterMs : undefined;
    }
  }

  const exponentialDelay = Math.min(
    maxRetryDelayMs,
    baseBackoffMs * 2 ** attempt,
  );
  const rawRandom = random();
  const clampedRandom = Number.isFinite(rawRandom)
    ? Math.min(1, Math.max(0, rawRandom))
    : 0;
  const jitter = Math.round(exponentialDelay * jitterRatio * clampedRandom);
  return Math.min(maxRetryDelayMs, exponentialDelay + jitter);
};

const waitForRetryDelay = (
  delayMs: number,
  signal?: AbortSignal,
): Promise<void> => {
  throwIfAborted(signal);
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return new Promise((resolve, reject) => {
    const handleAbort = () => {
      clearTimeout(timeout);
      reject(signal.reason ?? createAbortError());
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", handleAbort, { once: true });
  });
};

const cancelAbandonedResponse = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // Best-effort cleanup of intermediate 429/503 response bodies before retry.
  }
};

/**
 * Build a server-to-server MediaWiki Action API URL using `format=json`,
 * `formatversion=2`, and omitting browser-only `origin=*`.
 */
export const buildWikimediaActionApiUrl = (
  endpoint: string | URL,
  params:
    | Record<string, string | number | boolean | undefined>
    | URLSearchParams,
): string => {
  const url = new URL(String(endpoint));
  const search = new URLSearchParams(url.search);
  if (params instanceof URLSearchParams) {
    for (const [key, value] of params.entries()) {
      search.set(key, value);
    }
  } else {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      search.set(key, String(value));
    }
  }
  search.set("format", "json");
  search.set("formatversion", "2");
  search.delete("origin");
  url.search = search.toString();
  return url.toString();
};

/**
 * Normalize MediaWiki Action API `query.pages` (array under `formatversion=2`
 * or object map in legacy fixtures) into an array of page records. Returns
 * `null` if `pages` is missing, malformed, or contains non-object entries.
 */
export const extractActionApiPages = <
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  rawPages: unknown,
): T[] | null => {
  const values = Array.isArray(rawPages)
    ? rawPages
    : isRecord(rawPages)
      ? Object.values(rawPages)
      : null;
  if (!values) return null;
  const pages: T[] = [];
  for (const entry of values) {
    if (!isRecord(entry)) return null;
    pages.push(entry as T);
  }
  return pages;
};

/** MediaWiki marks missing pages as `missing: true` (v2) or `missing: ""` (v1). */
export const isMissingActionApiPage = (page: {
  missing?: unknown;
}): boolean => page.missing === true || page.missing === "";

/**
 * Perform a server-side HTTP request to a Wikimedia API with:
 * - policy-compliant `User-Agent`
 * - optional `Authorization: Bearer` on `https://api.wikimedia.org`
 * - per-attempt `AbortSignal` timeout + caller cancellation forwarding
 * - `429`/`503` retry honoring `Retry-After` (seconds or HTTP-date) with
 *   capped jittered exponential backoff; never retries other `4xx` errors.
 */
export const fetchWikimedia = async (
  input: string | URL,
  options: WikimediaFetchOptions = {},
): Promise<Response> => {
  const {
    headers: rawHeaders,
    signal: callerSignal,
    fetchImpl = fetch,
    timeoutMs: rawTimeoutMs = DEFAULT_WIKIMEDIA_TIMEOUT_MS,
    maxRetries: rawMaxRetries = DEFAULT_WIKIMEDIA_MAX_RETRIES,
    baseBackoffMs: rawBaseBackoffMs = DEFAULT_WIKIMEDIA_BASE_BACKOFF_MS,
    maxRetryDelayMs: rawMaxRetryDelayMs = DEFAULT_WIKIMEDIA_MAX_RETRY_DELAY_MS,
    jitterRatio: rawJitterRatio = DEFAULT_WIKIMEDIA_JITTER_RATIO,
    accessToken,
    next,
    now = Date.now,
    random = Math.random,
    ...restInit
  } = options;

  const timeoutMs =
    Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0
      ? rawTimeoutMs
      : DEFAULT_WIKIMEDIA_TIMEOUT_MS;
  const maxRetries =
    Number.isFinite(rawMaxRetries) && rawMaxRetries >= 0
      ? Math.floor(rawMaxRetries)
      : DEFAULT_WIKIMEDIA_MAX_RETRIES;
  const baseBackoffMs =
    Number.isFinite(rawBaseBackoffMs) && rawBaseBackoffMs >= 0
      ? rawBaseBackoffMs
      : DEFAULT_WIKIMEDIA_BASE_BACKOFF_MS;
  const maxRetryDelayMs =
    Number.isFinite(rawMaxRetryDelayMs) && rawMaxRetryDelayMs >= 0
      ? rawMaxRetryDelayMs
      : DEFAULT_WIKIMEDIA_MAX_RETRY_DELAY_MS;
  const jitterRatio =
    Number.isFinite(rawJitterRatio) && rawJitterRatio >= 0
      ? rawJitterRatio
      : DEFAULT_WIKIMEDIA_JITTER_RATIO;

  const targetUrl = String(input);
  const headers = buildWikimediaHeaders(targetUrl, {
    headers: rawHeaders,
    accessToken,
  });

  for (let attempt = 0; ; attempt += 1) {
    throwIfAborted(callerSignal);

    const controller = new AbortController();
    let timedOut = false;
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      const requestInit: RequestInit & { next?: NextFetchOptions } = {
        ...restInit,
        headers,
        signal: controller.signal,
        ...(next !== undefined ? { next } : {}),
      };
      response = await fetchImpl(targetUrl, requestInit);
    } catch (error: unknown) {
      if (
        timedOut &&
        !callerSignal?.aborted &&
        error &&
        typeof error === "object"
      ) {
        wikimediaTimeoutErrors.add(error);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }

    if (
      attempt >= maxRetries ||
      !RETRYABLE_STATUS_CODES.has(response.status)
    ) {
      return response;
    }

    const delayMs = computeRetryDelayMs({
      response,
      attempt,
      baseBackoffMs,
      maxRetryDelayMs,
      jitterRatio,
      now,
      random,
    });
    if (delayMs === undefined) {
      return response;
    }

    await cancelAbandonedResponse(response);
    await waitForRetryDelay(delayMs, callerSignal);
  }
};

export const fetchWikimediaActionApi = (
  endpoint: string | URL,
  params:
    | Record<string, string | number | boolean | undefined>
    | URLSearchParams,
  options: WikimediaFetchOptions = {},
): Promise<Response> =>
  fetchWikimedia(buildWikimediaActionApiUrl(endpoint, params), options);
