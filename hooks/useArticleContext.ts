"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ArticleContextApiResponse,
  ArticleContextRequest,
  ContextBlock,
  ContextManifest,
} from "@/lib/article-context-types";
import { ARTICLE_CONTEXT_SCHEMA_VERSION } from "@/lib/article-context-types";

export type ArticleContextLoadState =
  | { status: "idle" | "loading"; manifest: null; error: null }
  | { status: "ready"; manifest: ContextManifest; error: null }
  | { status: "error"; manifest: null; error: string };

type KeyedArticleContextState = {
  key: string;
  requestSnapshot: ArticleContextRequest | null;
  state: ArticleContextLoadState;
};

const loadingState = (): ArticleContextLoadState => ({
  status: "loading",
  manifest: null,
  error: null,
});

const idleState = (): ArticleContextLoadState => ({
  status: "idle",
  manifest: null,
  error: null,
});

const sortBlocks = (blocks: ContextBlock[]): ContextBlock[] =>
  [...blocks].sort(
    (left, right) =>
      left.order - right.order || left.title.localeCompare(right.title),
  );

const isArticleContextApiResponse = (
  value: unknown,
): value is ArticleContextApiResponse => {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<ArticleContextApiResponse>;
  return Boolean(
    response.context &&
      typeof response.context === "object" &&
      response.context.schemaVersion === ARTICLE_CONTEXT_SCHEMA_VERSION &&
      Array.isArray(response.context.blocks),
  );
};

export const useArticleContext = (request: ArticleContextRequest | null) => {
  const hasRequest = request !== null;
  const wikiPageId = request?.wikiPageId ?? "";
  const title = request?.title ?? "";
  const revisionId = request?.revisionId ?? "";
  const language = request?.language ?? "en";
  const requestKey = hasRequest
    ? JSON.stringify([wikiPageId, revisionId, language, title])
    : "";
  const requestSnapshot = useMemo<ArticleContextRequest | null>(
    () =>
      hasRequest
        ? { wikiPageId, title, revisionId, language }
        : null,
    [hasRequest, language, revisionId, title, wikiPageId],
  );
  const [reloadToken, setReloadToken] = useState(0);
  const [keyedState, setKeyedState] = useState<KeyedArticleContextState>(() => ({
    key: requestKey,
    requestSnapshot,
    state: hasRequest ? loadingState() : idleState(),
  }));

  useEffect(() => {
    if (!requestSnapshot) return;

    const controller = new AbortController();
    const key = requestKey;

    void fetch("/api/article-context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestSnapshot),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            body &&
            typeof body === "object" &&
            "error" in body &&
            typeof body.error === "string"
              ? body.error
              : "Visual context is temporarily unavailable.";
          throw new Error(message);
        }
        if (!isArticleContextApiResponse(body)) {
          throw new Error("Visual context returned an unexpected response.");
        }
        return body.context;
      })
      .then((manifest) => {
        if (controller.signal.aborted) return;
        setKeyedState({
          key,
          requestSnapshot,
          state: {
            status: "ready",
            manifest: { ...manifest, blocks: sortBlocks(manifest.blocks) },
            error: null,
          },
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setKeyedState({
          key,
          requestSnapshot,
          state: {
            status: "error",
            manifest: null,
            error:
              error instanceof Error
                ? error.message
                : "Visual context is temporarily unavailable.",
          },
        });
      });

    return () => controller.abort();
  }, [reloadToken, requestKey, requestSnapshot]);

  const retry = useCallback(() => {
    if (!requestSnapshot) return;
    setKeyedState({
      key: requestKey,
      requestSnapshot,
      state: loadingState(),
    });
    setReloadToken((value) => value + 1);
  }, [requestKey, requestSnapshot]);

  const effectiveState: ArticleContextLoadState = !requestSnapshot
    ? idleState()
    : keyedState.key === requestKey &&
        keyedState.requestSnapshot === requestSnapshot
      ? keyedState.state
      : loadingState();

  return { ...effectiveState, retry };
};
