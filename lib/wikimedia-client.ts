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
const NULL_BODY_STATUS_CODES = new Set([101, 103, 204, 205, 304]);
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
  } catch (error: unknown) {
    if (error instanceof TypeError) return false;
    throw error;
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

const resolveAttemptAbortError = (
  controller: AbortController,
  callerSignal: AbortSignal | undefined,
  timedOut: boolean,
): unknown => {
  if (callerSignal?.aborted) {
    return callerSignal.reason ?? createAbortError();
  }
  const reason: unknown = controller.signal.reason;
  const error =
    reason instanceof Error || reason instanceof DOMException
      ? reason
      : createAbortError();
  if (timedOut && typeof error === "object" && error !== null) {
    wikimediaTimeoutErrors.add(error);
  }
  return error;
};

const awaitWithAbortSignal = (
  pending: Promise<unknown>,
  signal: AbortSignal,
  getAbortError: () => unknown,
): Promise<void> => {
  if (signal.aborted) {
    return Promise.reject(getAbortError());
  }

  return new Promise<void>((resolve, reject) => {
    const handleAbort = () => {
      reject(getAbortError());
    };
    signal.addEventListener("abort", handleAbort, { once: true });
    pending.then(
      () => {
        signal.removeEventListener("abort", handleAbort);
        resolve();
      },
      (error: unknown) => {
        signal.removeEventListener("abort", handleAbort);
        reject(error);
      },
    );
  });
};

const cancelAbandonedResponse = async (
  response: Response,
  signal: AbortSignal,
  getAbortError: () => unknown,
): Promise<void> => {
  if (!response.body || response.body.locked) return;
  const cancelPromise = response.body.cancel().catch(() => undefined);
  await awaitWithAbortSignal(cancelPromise, signal, getAbortError);
};

const releaseReaderLock = (
  reader: ReadableStreamDefaultReader<Uint8Array> | null,
): void => {
  if (!reader) return;
  try {
    reader.releaseLock();
  } catch (error: unknown) {
    if (!(error instanceof TypeError)) {
      throw error;
    }
  }
};

const unrefTimer = (timer: ReturnType<typeof setTimeout>): void => {
  if (
    typeof timer === "object" &&
    timer !== null &&
    "unref" in timer &&
    typeof (timer as { unref?: unknown }).unref === "function"
  ) {
    (timer as { unref: () => void }).unref();
  }
};

const isValidResponseStatus = (status: number): boolean =>
  Number.isInteger(status) && status >= 200 && status <= 599;

const bindAttemptLifecycleToResponse = (
  response: Response,
  {
    controller,
    callerSignal,
    hasTimedOut,
    cleanup,
    unrefTimeout,
  }: {
    controller: AbortController;
    callerSignal?: AbortSignal;
    hasTimedOut: () => boolean;
    cleanup: () => void;
    unrefTimeout: () => void;
  },
): Response => {
  const originalBody = response.body;
  if (
    !originalBody ||
    typeof originalBody.getReader !== "function" ||
    response.bodyUsed ||
    originalBody.locked ||
    !isValidResponseStatus(response.status) ||
    NULL_BODY_STATUS_CODES.has(response.status)
  ) {
    cleanup();
    return response;
  }

  let settled = false;
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null =
    null;

  const resolveAbortError = (): unknown =>
    resolveAttemptAbortError(controller, callerSignal, hasTimedOut());

  const cleanupAll = () => {
    controller.signal.removeEventListener("abort", handleAttemptAbort);
    cleanup();
  };

  const cancelUpstreamBestEffort = (reason?: unknown) => {
    const reader = upstreamReader;
    if (reader) {
      void reader
        .cancel(reason)
        .catch(() => undefined)
        .finally(() => {
          releaseReaderLock(reader);
        });
    } else if (!originalBody.locked) {
      void originalBody.cancel(reason).catch(() => undefined);
    }
  };

  const handleAttemptAbort = () => {
    if (settled) return;
    settled = true;
    cleanupAll();
    const error = resolveAbortError();
    try {
      streamController?.error(error);
    } catch (streamError: unknown) {
      if (!(streamError instanceof TypeError)) {
        throw streamError;
      }
    }
    cancelUpstreamBestEffort(error);
  };

  const wrappedBody = new ReadableStream<Uint8Array>({
    start(ctrl) {
      streamController = ctrl;
    },
    async pull(ctrl) {
      if (settled) return;
      if (controller.signal.aborted) {
        handleAttemptAbort();
        return;
      }

      try {
        upstreamReader ??= originalBody.getReader();
        const { done, value } = await upstreamReader.read();
        if (settled) return;
        if (done) {
          settled = true;
          cleanupAll();
          releaseReaderLock(upstreamReader);
          ctrl.close();
          return;
        }
        if (value !== undefined) {
          ctrl.enqueue(value);
        }
      } catch (error: unknown) {
        if (settled) return;
        settled = true;
        cleanupAll();
        if (
          hasTimedOut() &&
          !callerSignal?.aborted &&
          error &&
          typeof error === "object"
        ) {
          wikimediaTimeoutErrors.add(error);
        }
        releaseReaderLock(upstreamReader);
        ctrl.error(error);
      }
    },
    async cancel(reason) {
      if (settled) return;
      settled = true;
      // Stop erroring the stream on abort, but keep the attempt timeout and
      // caller abort listener active until upstream cancellation settles.
      controller.signal.removeEventListener("abort", handleAttemptAbort);
      const reader = upstreamReader;
      const cancelPromise = (
        reader
          ? reader.cancel(reason)
          : !originalBody.locked
            ? originalBody.cancel(reason)
            : Promise.resolve()
      )
        .catch(() => undefined)
        .finally(() => {
          releaseReaderLock(reader);
        });

      try {
        await awaitWithAbortSignal(
          cancelPromise,
          controller.signal,
          resolveAbortError,
        );
      } finally {
        cleanupAll();
      }
    },
  });

  controller.signal.addEventListener("abort", handleAttemptAbort, { once: true });
  if (controller.signal.aborted) {
    handleAttemptAbort();
  } else {
    unrefTimeout();
  }

  const wrappedResponse = new Response(wrappedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });

  if (response.url) {
    Object.defineProperty(wrappedResponse, "url", {
      value: response.url,
      configurable: true,
    });
  }
  if (response.redirected) {
    Object.defineProperty(wrappedResponse, "redirected", {
      value: response.redirected,
      configurable: true,
    });
  }

  return wrappedResponse;
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

export type ActionApiTitleMappings = {
  normalized: Map<string, string>;
  normalizedLower: Map<string, string>;
  converted: Map<string, string>;
  convertedLower: Map<string, string>;
  redirects: Map<string, string>;
  redirectsLower: Map<string, string>;
};

const MAX_ACTION_API_REDIRECT_HOPS = 16;

const normalizeActionApiTitleSpaces = (title: string): string =>
  title.replace(/_/g, " ").trim();

const recordActionApiTitleMappings = (
  exactMap: Map<string, string>,
  lowerMap: Map<string, string>,
  rawMappings: unknown,
): void => {
  if (!Array.isArray(rawMappings)) return;
  for (const entry of rawMappings) {
    if (!isRecord(entry)) continue;
    if (typeof entry.from !== "string" || typeof entry.to !== "string") {
      continue;
    }
    const from = normalizeActionApiTitleSpaces(entry.from);
    const to = normalizeActionApiTitleSpaces(entry.to);
    if (!from || !to) continue;
    exactMap.set(from, to);
    const fromLower = from.toLowerCase();
    if (!lowerMap.has(fromLower)) {
      lowerMap.set(fromLower, to);
    }
  }
};

/**
 * Extract MediaWiki Action API `query.normalized`, `query.converted`, and
 * `query.redirects` title mappings for resolving requested titles to returned
 * canonical pages.
 */
export const extractActionApiTitleMappings = (
  queryData: unknown,
): ActionApiTitleMappings => {
  const mappings: ActionApiTitleMappings = {
    normalized: new Map(),
    normalizedLower: new Map(),
    converted: new Map(),
    convertedLower: new Map(),
    redirects: new Map(),
    redirectsLower: new Map(),
  };
  if (!isRecord(queryData)) return mappings;

  recordActionApiTitleMappings(
    mappings.normalized,
    mappings.normalizedLower,
    queryData.normalized,
  );
  recordActionApiTitleMappings(
    mappings.converted,
    mappings.convertedLower,
    queryData.converted,
  );
  recordActionApiTitleMappings(
    mappings.redirects,
    mappings.redirectsLower,
    queryData.redirects,
  );
  return mappings;
};

const lookupActionApiTitleMapping = (
  title: string,
  exactMap: ReadonlyMap<string, string>,
  lowerMap: ReadonlyMap<string, string>,
): string | undefined =>
  exactMap.get(title) ?? lowerMap.get(title.toLowerCase());

/**
 * Resolve a requested title through MediaWiki Action API `normalized`,
 * `converted`, and `redirects` mappings with cycle protection.
 */
export const resolveActionApiCanonicalTitle = (
  rawTitle: string,
  mappings: ActionApiTitleMappings,
): string => {
  let current = normalizeActionApiTitleSpaces(rawTitle);
  if (!current) return current;

  const normalized = lookupActionApiTitleMapping(
    current,
    mappings.normalized,
    mappings.normalizedLower,
  );
  if (normalized) {
    current = normalized;
  }

  const converted = lookupActionApiTitleMapping(
    current,
    mappings.converted,
    mappings.convertedLower,
  );
  if (converted) {
    current = converted;
  }

  const visited = new Set<string>();
  for (let hop = 0; hop < MAX_ACTION_API_REDIRECT_HOPS; hop += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    const next = lookupActionApiTitleMapping(
      current,
      mappings.redirects,
      mappings.redirectsLower,
    );
    if (!next || next === current) break;
    current = next;
  }

  return current;
};

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
    let cleanedUp = false;
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      const timeoutError = createAbortError();
      wikimediaTimeoutErrors.add(timeoutError);
      controller.abort(timeoutError);
    }, timeoutMs);
    const cleanupAttempt = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    };

    let retryDelayMs: number | undefined;
    let handedOffToResponse = false;
    try {
      const requestInit: RequestInit & { next?: NextFetchOptions } = {
        ...restInit,
        headers,
        signal: controller.signal,
        ...(next !== undefined ? { next } : {}),
      };
      const response = await fetchImpl(targetUrl, requestInit);

      const shouldRetry =
        attempt < maxRetries && RETRYABLE_STATUS_CODES.has(response.status);
      retryDelayMs = shouldRetry
        ? computeRetryDelayMs({
            response,
            attempt,
            baseBackoffMs,
            maxRetryDelayMs,
            jitterRatio,
            now,
            random,
          })
        : undefined;

      if (retryDelayMs === undefined) {
        const boundResponse = bindAttemptLifecycleToResponse(response, {
          controller,
          callerSignal,
          hasTimedOut: () => timedOut,
          cleanup: cleanupAttempt,
          unrefTimeout: () => unrefTimer(timeout),
        });
        handedOffToResponse = true;
        return boundResponse;
      }

      await cancelAbandonedResponse(response, controller.signal, () =>
        resolveAttemptAbortError(controller, callerSignal, timedOut),
      );
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
      if (!handedOffToResponse) {
        cleanupAttempt();
      }
    }

    await waitForRetryDelay(retryDelayMs, callerSignal);
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
