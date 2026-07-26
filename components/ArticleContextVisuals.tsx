"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import type {
  ContextDiagramBlock,
  ContextTimelineBlock,
} from "@/lib/article-context-types";
import {
  VisualLoadStatus,
  useNearViewport,
  type VisualLoadPhase,
} from "./ArticleContextVisualShared";

export {
  ContextMapView,
  MapSchematic,
  createMapGeoJsonFeatures,
  fitMapToFeatures,
  getMapFeatureBounds,
  type ContextMapFeatureBounds,
} from "./ArticleContextMap";

export const ContextTimelineView = ({
  block,
  caption,
  captionId,
}: {
  block: ContextTimelineBlock;
  caption: string;
  captionId: string;
}) => {
  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          block.timeline.events
            .map((event) => event.category)
            .filter((value): value is string => Boolean(value)),
        ),
      ),
    [block.timeline.events],
  );
  const [category, setCategory] = useState("all");
  const [ascending, setAscending] = useState(block.timeline.chronological);
  const events = useMemo(() => {
    const selected =
      category === "all"
        ? block.timeline.events
        : block.timeline.events.filter((event) => event.category === category);
    return [...selected].sort((a, b) =>
      ascending
        ? a.start.sortKey - b.start.sortKey
        : b.start.sortKey - a.start.sortKey,
    );
  }, [ascending, block.timeline.events, category]);

  return (
    <div className="context-kind-view">
      <div className="context-timeline-controls">
        {categories.length > 1 ? (
          <label>
            Show category
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">All categories</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setAscending((value) => !value)}
        >
          {ascending ? "Newest first" : "Oldest first"}
        </button>
      </div>
      <p className="context-status" role="status" aria-live="polite">
        {events.length} {events.length === 1 ? "event" : "events"},{" "}
        {ascending ? "oldest first" : "newest first"}
      </p>
      <ol className="context-timeline-list">
        {events.map((event) => (
          <li key={event.id}>
            <div className="context-timeline-date">
              {event.start.iso ? (
                <time dateTime={event.start.iso}>{event.start.display}</time>
              ) : (
                <span>{event.start.display}</span>
              )}
              {event.end ? (
                <>
                  <span aria-hidden="true"> — </span>
                  <span className="sr-only"> through </span>
                  {event.end.iso ? (
                    <time dateTime={event.end.iso}>{event.end.display}</time>
                  ) : (
                    <span>{event.end.display}</span>
                  )}
                </>
              ) : null}
            </div>
            <div className="context-timeline-copy">
              <strong>{event.label}</strong>
              {event.category ? (
                <span className="context-category">{event.category}</span>
              ) : null}
              {event.description ? <p>{event.description}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      <p id={captionId} className="context-visual-caption">
        {caption}
      </p>
    </div>
  );
};

export {
  ContextChartView,
  getFallbackBarGeometry,
} from "./ArticleContextChart";

export const ContextDiagramView = ({
  block,
  caption,
  captionId,
  descriptionId,
}: {
  block: ContextDiagramBlock;
  caption: string;
  captionId: string;
  descriptionId: string;
}) => {
  const image = block.diagram.image;
  const scrollRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const nearViewport = useNearViewport(scrollRef);
  const imageAttempt = `${block.provenance.sourceHash}:${image.src}:${image.width ?? "auto"}:${image.height ?? "auto"}`;
  const activeImageAttemptRef = useRef(imageAttempt);
  useLayoutEffect(() => {
    activeImageAttemptRef.current = imageAttempt;
  }, [imageAttempt]);
  const [zoomState, setZoomState] = useState<{
    key: string;
    value: number;
  } | null>(null);
  const [attemptState, setAttemptState] = useState<{
    key: string;
    phase: "loading" | "ready" | "error";
  } | null>(null);
  const [actionStatus, setActionStatus] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const phase: VisualLoadPhase = !nearViewport
    ? "deferred"
    : attemptState?.key === imageAttempt
      ? attemptState.phase
      : "loading";
  const zoom = zoomState?.key === imageAttempt ? zoomState.value : 1;
  const imageReady = phase === "ready";
  const hasSourceAspectRatio =
    typeof image.width === "number" &&
    image.width > 0 &&
    typeof image.height === "number" &&
    image.height > 0;
  const imageWidth = hasSourceAspectRatio ? image.width : 1200;
  const imageHeight = hasSourceAspectRatio ? image.height : 800;
  const imageAspectRatio = hasSourceAspectRatio
    ? `${imageWidth} / ${imageHeight}`
    : "3 / 2";
  const currentActionStatus =
    actionStatus?.key === imageAttempt ? actionStatus.message : "";

  const updateZoom = (update: (value: number) => number) => {
    const nextZoom = update(zoom);
    setZoomState({
      key: imageAttempt,
      value: nextZoom,
    });
    setActionStatus({
      key: imageAttempt,
      message: `Diagram zoom ${Math.round(nextZoom * 100)} percent.`,
    });
  };

  const finishImageLoad = useCallback(
    (imageElement: HTMLImageElement) => {
      const markReady = () => {
        setAttemptState((current) =>
          activeImageAttemptRef.current !== imageAttempt ||
          (current?.key === imageAttempt && current.phase === "error")
            ? current
            : { key: imageAttempt, phase: "ready" },
        );
      };
      const handleDecodeFailure = () => {
        if (activeImageAttemptRef.current !== imageAttempt) return;
        if (imageElement.complete && imageElement.naturalWidth > 0) {
          markReady();
          return;
        }
        setAttemptState({ key: imageAttempt, phase: "error" });
      };

      if (typeof imageElement.decode !== "function") {
        markReady();
        return;
      }
      try {
        void imageElement.decode().then(markReady, handleDecodeFailure);
      } catch {
        handleDecodeFailure();
      }
    },
    [imageAttempt],
  );

  const handleImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      finishImageLoad(event.currentTarget);
    },
    [finishImageLoad],
  );

  const handleImageError = useCallback(() => {
    if (activeImageAttemptRef.current !== imageAttempt) return;
    setAttemptState({ key: imageAttempt, phase: "error" });
  }, [imageAttempt]);

  useEffect(() => {
    const imageElement = imageRef.current;
    if (!nearViewport || !imageElement?.complete) return;
    if (imageElement.naturalWidth <= 0) {
      setAttemptState((current) =>
        current?.key === imageAttempt && current.phase === "error"
          ? current
          : { key: imageAttempt, phase: "error" },
      );
      return;
    }
    finishImageLoad(imageElement);
  }, [finishImageLoad, imageAttempt, nearViewport]);

  const statusLabel =
    phase === "deferred"
      ? "Diagram image will load as it approaches the viewport."
      : phase === "loading"
        ? "Loading diagram image."
        : phase === "error"
          ? "Diagram image unavailable. Named parts, relationships, and the walkthrough remain available below."
          : currentActionStatus || "Diagram image ready.";

  return (
    <div className="context-kind-view">
      <figure className="context-diagram-figure">
        <div
          className="context-diagram-surface"
          style={{ aspectRatio: imageAspectRatio }}
        >
          <div
            ref={scrollRef}
            className="context-diagram-scroll"
            role="region"
            aria-label={`Scrollable diagram: ${block.title}`}
            aria-busy={phase === "loading"}
            tabIndex={imageReady ? 0 : -1}
          >
            <Image
              ref={imageRef}
              src={image.src}
              alt={image.alt}
              aria-describedby={`${captionId} ${descriptionId}`}
              width={imageWidth}
              height={imageHeight}
              loading="lazy"
              unoptimized
              className={`context-diagram-image ${imageReady ? "context-diagram-image-ready" : "context-diagram-image-pending"}`}
              hidden={phase === "error"}
              onLoad={handleImageLoad}
              onError={handleImageError}
              style={{
                width: `${zoom * 100}%`,
                maxWidth: "none",
                height: "auto",
              }}
            />
          </div>
          <VisualLoadStatus
            phase={phase}
            className={
              phase === "ready" ? undefined : "context-rich-media-placeholder"
            }
          >
            {statusLabel}
          </VisualLoadStatus>
        </div>
        <figcaption id={captionId} className="context-visual-caption">
          {caption}
        </figcaption>
      </figure>
      <div
        className="context-diagram-controls"
        aria-label="Diagram zoom controls"
      >
        <button
          type="button"
          onClick={() => updateZoom((value) => Math.min(3, value + 0.25))}
          disabled={!imageReady || zoom >= 3}
        >
          Zoom in
        </button>
        <button
          type="button"
          onClick={() => updateZoom((value) => Math.max(1, value - 0.25))}
          disabled={!imageReady || zoom <= 1}
        >
          Zoom out
        </button>
        <button
          type="button"
          onClick={() => updateZoom(() => 1)}
          disabled={!imageReady || zoom === 1}
        >
          Reset image
        </button>
        <span>{Math.round(zoom * 100)} percent</span>
      </div>

      {block.diagram.parts.length > 0 ? (
        <section aria-labelledby={`${block.id}-parts-heading`}>
          <h4 id={`${block.id}-parts-heading`}>Named parts</h4>
          <dl className="context-parts-list">
            {block.diagram.parts.map((part) => (
              <div key={part.id}>
                <dt>{part.label}</dt>
                <dd>
                  {part.description ?? "No additional description provided."}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {block.diagram.relationships.length > 0 ? (
        <section aria-labelledby={`${block.id}-relationships-heading`}>
          <h4 id={`${block.id}-relationships-heading`}>Relationships</h4>
          <ul className="context-relationship-list">
            {block.diagram.relationships.map((relationship, index) => {
              const from =
                block.diagram.parts.find(
                  (part) => part.id === relationship.fromId,
                )?.label ?? relationship.fromId;
              const to =
                block.diagram.parts.find(
                  (part) => part.id === relationship.toId,
                )?.label ?? relationship.toId;
              return (
                <li
                  key={`${relationship.fromId}-${relationship.toId}-${index}`}
                >
                  <strong>{from}</strong> {relationship.label}{" "}
                  <strong>{to}</strong>.
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {block.diagram.legend && block.diagram.legend.entries.length > 0 ? (
        <section
          className="context-diagram-legend-section"
          aria-labelledby={`${block.id}-legend-heading`}
        >
          <h4 id={`${block.id}-legend-heading`}>Legend</h4>
          <ul className="context-diagram-legend">
            {block.diagram.legend.entries.map((entry, index) => (
              <li key={`${entry.color}-${entry.text}-${index}`}>
                <span
                  className="context-diagram-legend-swatch"
                  data-context-legend-swatch=""
                  aria-hidden="true"
                >
                  <span
                    className="context-diagram-legend-swatch-fill"
                    style={{ backgroundColor: entry.color }}
                  />
                </span>
                <span>
                  <span className="sr-only">Map color {entry.color}: </span>
                  {entry.text}
                </span>
              </li>
            ))}
          </ul>
          {block.diagram.legend.notes.map((note, index) => (
            <p className="context-diagram-legend-note" key={`${note}-${index}`}>
              {note}
            </p>
          ))}
        </section>
      ) : null}

      {block.diagram.walkthrough.length > 0 &&
      !block.diagram.legend?.entries.length ? (
        <section aria-labelledby={`${block.id}-walkthrough-heading`}>
          <h4 id={`${block.id}-walkthrough-heading`}>Walkthrough</h4>
          <ol className="context-walkthrough">
            {block.diagram.walkthrough.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
};
