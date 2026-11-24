import type {
  LocalWikipediaRequest,
  LocalWikipediaResponseFor,
  WikipediaParsedPageData,
  WikipediaRevisionIdentity,
} from "@/lib/wikipedia-contracts";
import { createRevisionMetadataClient } from "@/lib/wikipedia-metadata-client";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

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
  } catch (error: unknown) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error("Local Wikipedia request failed");
    }
    throw error;
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

const localMetadataClient = createRevisionMetadataClient((identity) =>
  requestLocalWikipedia({
    operation: "metadata",
    identity,
  }),
);

/** Test-only isolation hook; production callers never invoke this. */
export const resetLocalWikipediaClientCachesForTests = (): void => {
  localMetadataClient.reset();
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
): Promise<WikipediaParsedPageData> =>
  localMetadataClient.requestMetadata(identity, signal);
