import { normalizeMediaWikiNumericId } from "@curio-garden/domain";
import { fetch as expoFetch } from "expo/fetch";
import { useCallback, useMemo, type ReactElement, type ReactNode } from "react";

import { useNativeAuthTransportBinding } from "../auth/NativeAuthTransportBindingContext";
import {
  NativeArticleAudioAccessContextProvider,
  type NativeArticleAudioAccess,
  type NativeArticleAudioSectionRequest,
  type NativeArticleAudioSectionResult,
} from "./NativeArticleAudioAccessContext";

type NativeFetchInit = Readonly<{
  body?: BodyInit | null;
  credentials?: RequestCredentials;
  headers?: HeadersInit;
  method?: string;
  redirect?: RequestRedirect;
  signal?: AbortSignal | null;
}>;

type FetchImplementation = (
  input: string | URL,
  init?: NativeFetchInit,
) => Promise<Response>;

const INVALID_REQUEST = Object.freeze({
  reason: "invalid-request" as const,
  retryable: false,
  status: "failed" as const,
});
const ACCOUNT_UNAVAILABLE = Object.freeze({
  reason: "account-unavailable" as const,
  retryable: true,
  status: "failed" as const,
});
const AUTHENTICATION_REJECTED = Object.freeze({
  reason: "authentication-rejected" as const,
  retryable: false,
  status: "failed" as const,
});
const ARTICLE_NOT_FOUND = Object.freeze({
  reason: "article-not-found" as const,
  retryable: false,
  status: "failed" as const,
});
const ARTICLE_CHANGED = Object.freeze({
  reason: "article-changed" as const,
  retryable: false,
  status: "failed" as const,
});
const INVALID_RESPONSE = Object.freeze({
  reason: "invalid-response" as const,
  retryable: false,
  status: "failed" as const,
});
const TEMPORARILY_UNAVAILABLE = Object.freeze({
  reason: "temporarily-unavailable" as const,
  retryable: true,
  status: "failed" as const,
});
const CANCELLED = Object.freeze({ status: "cancelled" as const });
const SUPERSEDED = Object.freeze({ status: "superseded" as const });
const MAX_SLUG_LENGTH = 500;
const MAX_SECTION_KEY_LENGTH = 500;
const ARTICLE_AUDIO_REQUEST_TIMEOUT_MS = 180_000;

function isRequestValid(
  request: unknown,
): request is NativeArticleAudioSectionRequest {
  try {
    if (typeof request !== "object" || request === null) return false;
    const candidate = request as Record<string, unknown>;
    const signal = candidate.signal;

    return (
      typeof candidate.slug === "string" &&
      candidate.slug.trim().length > 0 &&
      candidate.slug.length <= MAX_SLUG_LENGTH &&
      typeof candidate.revisionId === "string" &&
      normalizeMediaWikiNumericId(candidate.revisionId) ===
        candidate.revisionId &&
      typeof candidate.narrationVersion === "number" &&
      Number.isSafeInteger(candidate.narrationVersion) &&
      candidate.narrationVersion > 0 &&
      typeof candidate.sectionKey === "string" &&
      candidate.sectionKey.length <= MAX_SECTION_KEY_LENGTH &&
      (candidate.sectionKey === "summary" ||
        /^section-(?:0|[1-9]\d*)$/u.test(candidate.sectionKey)) &&
      (candidate.provider === "edge" || candidate.provider === "openai") &&
      (signal === undefined || signal instanceof AbortSignal)
    );
  } catch (_error: unknown) {
    void _error;
    return false;
  }
}

function failureForStatus(status: number): NativeArticleAudioSectionResult {
  if (status === 400 || status === 422) return INVALID_REQUEST;
  if (status === 401 || status === 403) return AUTHENTICATION_REJECTED;
  if (status === 404) return ARTICLE_NOT_FOUND;
  if (status === 409) return ARTICLE_CHANGED;
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return TEMPORARILY_UNAVAILABLE;
  }
  return INVALID_RESPONSE;
}

function isAudioResponse(response: Response): boolean {
  return (
    response.status === 200 &&
    response.headers.get("content-type")?.toLowerCase().startsWith("audio/") ===
      true
  );
}

export function NativeArticleAudioAccessProvider({
  children,
  fetchImpl = expoFetch,
  webOrigin,
}: {
  readonly children: ReactNode;
  readonly fetchImpl?: FetchImplementation;
  readonly webOrigin: string;
}): ReactElement {
  const binding = useNativeAuthTransportBinding();

  const requestSection = useCallback(
    async (
      request: NativeArticleAudioSectionRequest,
    ): Promise<NativeArticleAudioSectionResult> => {
      if (!isRequestValid(request)) return INVALID_REQUEST;
      if (request.signal?.aborted) return CANCELLED;

      const operationEpoch = binding.accountEpoch;
      const endpoint = `${webOrigin}/api/article/audio/section`;

      const runAttempt = async (
        forceRefresh: boolean,
      ): Promise<
        NativeArticleAudioSectionResult | Readonly<{ shouldRefresh: true }>
      > => {
        let credentials: Awaited<
          ReturnType<typeof binding.resolveRequestCredentials>
        >;
        try {
          credentials = await binding.resolveRequestCredentials({
            forceRefresh,
          });
        } catch (error: unknown) {
          void error;
          if (!binding.isCurrentAccountEpoch(operationEpoch)) return SUPERSEDED;
          return request.signal?.aborted ? CANCELLED : ACCOUNT_UNAVAILABLE;
        }
        if (
          !binding.isCurrentAccountEpoch(operationEpoch) ||
          ("accountEpoch" in credentials &&
            credentials.accountEpoch !== operationEpoch)
        ) {
          return SUPERSEDED;
        }
        if (credentials.status === "superseded") return SUPERSEDED;
        if (request.signal?.aborted) return CANCELLED;
        if (credentials.status === "unavailable") return ACCOUNT_UNAVAILABLE;
        if (forceRefresh && credentials.status !== "authenticated") {
          return AUTHENTICATION_REJECTED;
        }

        const provider =
          credentials.status === "authenticated" ? request.provider : "edge";
        const headers: Record<string, string> = {
          Accept: "audio/mpeg, audio/*;q=0.9",
          "Content-Type": "application/json",
        };
        if (credentials.status === "authenticated") {
          headers.Authorization = `Bearer ${credentials.sessionToken}`;
        }

        const timeoutController = new AbortController();
        let didTimeout = false;
        const cancelForCaller = (): void => timeoutController.abort();
        try {
          request.signal?.addEventListener("abort", cancelForCaller, {
            once: true,
          });
        } catch (error: unknown) {
          void error;
          return INVALID_REQUEST;
        }
        const timeoutId = setTimeout(() => {
          didTimeout = true;
          timeoutController.abort();
        }, ARTICLE_AUDIO_REQUEST_TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetchImpl(endpoint, {
            body: JSON.stringify({
              narrationVersion: request.narrationVersion,
              provider,
              revisionId: request.revisionId,
              sectionKey: request.sectionKey,
              slug: request.slug,
            }),
            credentials: "omit",
            headers,
            method: "POST",
            redirect: "error",
            signal: timeoutController.signal,
          });
        } catch (error: unknown) {
          // The caller receives only a stable classification; using the caught
          // value here makes the intentional sanitization visible to static
          // architecture checks without logging or persisting it.
          void error;
          if (!binding.isCurrentAccountEpoch(operationEpoch)) return SUPERSEDED;
          if (request.signal?.aborted) return CANCELLED;
          return TEMPORARILY_UNAVAILABLE;
        } finally {
          clearTimeout(timeoutId);
          request.signal?.removeEventListener("abort", cancelForCaller);
        }

        if (!binding.isCurrentAccountEpoch(operationEpoch)) return SUPERSEDED;
        if (request.signal?.aborted) return CANCELLED;
        if (didTimeout) return TEMPORARILY_UNAVAILABLE;
        if (
          response.status === 401 &&
          credentials.status === "authenticated" &&
          !forceRefresh
        ) {
          return { shouldRefresh: true };
        }
        if (!response.ok) return failureForStatus(response.status);
        if (!isAudioResponse(response)) return INVALID_RESPONSE;

        return { accountEpoch: operationEpoch, response, status: "ready" };
      };

      const firstResult = await runAttempt(false);
      if ("shouldRefresh" in firstResult) {
        const refreshedResult = await runAttempt(true);
        return "shouldRefresh" in refreshedResult
          ? AUTHENTICATION_REJECTED
          : refreshedResult;
      }
      return firstResult;
    },
    [binding, fetchImpl, webOrigin],
  );

  const value = useMemo<NativeArticleAudioAccess>(
    () => ({ accountEpoch: binding.accountEpoch, requestSection }),
    [binding.accountEpoch, requestSection],
  );

  return (
    <NativeArticleAudioAccessContextProvider value={value}>
      {children}
    </NativeArticleAudioAccessContextProvider>
  );
}
