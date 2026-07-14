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

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isOptional = (
  value: unknown,
  predicate: (candidate: unknown) => boolean,
): boolean => value === undefined || predicate(value);

const isCoordinate = (value: unknown): boolean =>
  isRecord(value) &&
  isFiniteNumber(value.latitude) &&
  isFiniteNumber(value.longitude);

const isContextSource = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value.label) &&
  isString(value.url) &&
  isOptional(value.revisionId, isString) &&
  isOptional(value.license, isString) &&
  isString(value.accessedAt);

const isContextSection = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value.index) &&
  isString(value.title) &&
  isOptional(value.anchor, isString);

const isContextProvenance = (value: unknown): boolean => {
  if (
    !isRecord(value) ||
    !isString(value.articleUrl) ||
    !isString(value.articleRevisionUrl) ||
    !isString(value.sourceHash) ||
    !isString(value.extractorVersion) ||
    !["deterministic", "ai-assisted"].includes(
      String(value.descriptionMethod),
    ) ||
    !isOptional(value.model, isString) ||
    !isOptional(value.promptVersion, isString)
  ) {
    return false;
  }
  return (
    value.editorialOverride === undefined ||
    (isRecord(value.editorialOverride) &&
      value.editorialOverride.kind === "owner-accessibility-copy" &&
      isString(value.editorialOverride.updatedAt))
  );
};

const hasContextBlockBase = (value: UnknownRecord): boolean =>
  isString(value.id) &&
  isString(value.title) &&
  isString(value.caption) &&
  isString(value.longDescription) &&
  isContextSection(value.section) &&
  isFiniteNumber(value.order) &&
  Array.isArray(value.sources) &&
  value.sources.every(isContextSource) &&
  isContextProvenance(value.provenance);

const isMapBlock = (value: UnknownRecord): boolean => {
  if (!isRecord(value.map)) return false;
  const map = value.map;
  return (
    isCoordinate(map.center) &&
    isOptional(map.suggestedZoom, isFiniteNumber) &&
    Array.isArray(map.places) &&
    map.places.every(
      (place) =>
        isRecord(place) &&
        isCoordinate(place) &&
        isString(place.id) &&
        isString(place.name) &&
        isOptional(place.description, isString),
    ) &&
    Array.isArray(map.routes) &&
    map.routes.every(
      (route) =>
        isRecord(route) &&
        isString(route.id) &&
        isString(route.name) &&
        isOptional(route.description, isString) &&
        Array.isArray(route.points) &&
        route.points.every(
          (point) =>
            isRecord(point) &&
            isCoordinate(point) &&
            isOptional(point.label, isString),
        ),
    ) &&
    Array.isArray(map.areas) &&
    map.areas.every(
      (area) =>
        isRecord(area) &&
        isString(area.id) &&
        isString(area.name) &&
        isOptional(area.description, isString) &&
        Array.isArray(area.rings) &&
        area.rings.every(
          (ring) => Array.isArray(ring) && ring.every(isCoordinate),
        ),
    )
  );
};

const isDateValue = (value: unknown): boolean =>
  isRecord(value) &&
  isString(value.display) &&
  isOptional(value.iso, isString) &&
  isFiniteNumber(value.sortKey) &&
  ["day", "month", "year", "range", "circa", "unknown"].includes(
    String(value.precision),
  );

const isTimelineBlock = (value: UnknownRecord): boolean =>
  isRecord(value.timeline) &&
  typeof value.timeline.chronological === "boolean" &&
  Array.isArray(value.timeline.events) &&
  value.timeline.events.every(
    (event) =>
      isRecord(event) &&
      isString(event.id) &&
      isString(event.label) &&
      isDateValue(event.start) &&
      isOptional(event.end, isDateValue) &&
      isOptional(event.description, isString) &&
      isOptional(event.category, isString),
  );

const isChartCell = (value: unknown): boolean =>
  value === null || isString(value) || isFiniteNumber(value);

const isChartBlock = (value: UnknownRecord): boolean =>
  isRecord(value.chart) &&
  Array.isArray(value.chart.columns) &&
  value.chart.columns.every(
    (column) =>
      isRecord(column) &&
      isString(column.key) &&
      isString(column.label) &&
      ["string", "number"].includes(String(column.dataType)) &&
      isOptional(column.unit, isString),
  ) &&
  Array.isArray(value.chart.rows) &&
  value.chart.rows.every(
    (row) => isRecord(row) && Object.values(row).every(isChartCell),
  ) &&
  Array.isArray(value.chart.series) &&
  value.chart.series.every(
    (series) =>
      isRecord(series) &&
      isString(series.id) &&
      isString(series.label) &&
      ["line", "area", "bar", "pie"].includes(String(series.type)) &&
      isString(series.xColumn) &&
      isString(series.yColumn) &&
      isOptional(series.unit, isString),
  ) &&
  ["chart-extension", "wikitable"].includes(
    String(value.chart.sourceChartType),
  );

const isDiagramBlock = (value: UnknownRecord): boolean =>
  isRecord(value.diagram) &&
  isRecord(value.diagram.image) &&
  isString(value.diagram.image.src) &&
  isOptional(value.diagram.image.originalSrc, isString) &&
  isString(value.diagram.image.alt) &&
  isOptional(value.diagram.image.width, isFiniteNumber) &&
  isOptional(value.diagram.image.height, isFiniteNumber) &&
  Array.isArray(value.diagram.parts) &&
  value.diagram.parts.every(
    (part) =>
      isRecord(part) &&
      isString(part.id) &&
      isString(part.label) &&
      isOptional(part.description, isString),
  ) &&
  Array.isArray(value.diagram.relationships) &&
  value.diagram.relationships.every(
    (relationship) =>
      isRecord(relationship) &&
      isString(relationship.fromId) &&
      isString(relationship.toId) &&
      isString(relationship.label),
  ) &&
  Array.isArray(value.diagram.walkthrough) &&
  value.diagram.walkthrough.every(isString) &&
  isString(value.diagram.caption);

const isContextBlock = (value: unknown): value is ContextBlock => {
  if (!isRecord(value) || !hasContextBlockBase(value)) return false;
  if (value.kind === "map") return isMapBlock(value);
  if (value.kind === "timeline") return isTimelineBlock(value);
  if (value.kind === "chart") return isChartBlock(value);
  if (value.kind === "diagram") return isDiagramBlock(value);
  return false;
};

const isContextManifest = (value: unknown): value is ContextManifest =>
  isRecord(value) &&
  value.schemaVersion === ARTICLE_CONTEXT_SCHEMA_VERSION &&
  isString(value.wikiPageId) &&
  isString(value.title) &&
  isString(value.revisionId) &&
  isString(value.language) &&
  isString(value.sourceHash) &&
  isString(value.extractorVersion) &&
  isString(value.generatedAt) &&
  Array.isArray(value.blocks) &&
  value.blocks.every(isContextBlock);

const isArticleContextApiResponse = (
  value: unknown,
): value is ArticleContextApiResponse => {
  return (
    isRecord(value) &&
    (value.cacheStatus === "hit" || value.cacheStatus === "miss") &&
    isContextManifest(value.context)
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
