"use client";

import Image from "next/image";
import { useMemo, useState } from "react";
import type {
  ContextDiagramBlock,
  ContextTimelineBlock,
} from "@/lib/article-context-types";

export {
  ContextMapView,
  MapSchematic,
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
    () => Array.from(new Set(block.timeline.events.map((event) => event.category).filter((value): value is string => Boolean(value)))),
    [block.timeline.events],
  );
  const [category, setCategory] = useState("all");
  const [ascending, setAscending] = useState(block.timeline.chronological);
  const events = useMemo(() => {
    const selected = category === "all"
      ? block.timeline.events
      : block.timeline.events.filter((event) => event.category === category);
    return [...selected].sort((a, b) => ascending ? a.start.sortKey - b.start.sortKey : b.start.sortKey - a.start.sortKey);
  }, [ascending, block.timeline.events, category]);

  return (
    <div className="context-kind-view">
      <div className="context-timeline-controls">
        {categories.length > 1 ? (
          <label>
            Show category
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        ) : null}
        <button type="button" className="btn-secondary" onClick={() => setAscending((value) => !value)}>
          {ascending ? "Newest first" : "Oldest first"}
        </button>
      </div>
      <p className="context-status" role="status" aria-live="polite">
        {events.length} {events.length === 1 ? "event" : "events"}, {ascending ? "oldest first" : "newest first"}
      </p>
      <ol className="context-timeline-list">
        {events.map((event) => (
          <li key={event.id}>
            <div className="context-timeline-date">
              {event.start.iso ? <time dateTime={event.start.iso}>{event.start.display}</time> : <span>{event.start.display}</span>}
              {event.end ? (
                <>
                  <span aria-hidden="true"> — </span>
                  <span className="sr-only"> through </span>
                  {event.end.iso ? <time dateTime={event.end.iso}>{event.end.display}</time> : <span>{event.end.display}</span>}
                </>
              ) : null}
            </div>
            <div className="context-timeline-copy">
              <strong>{event.label}</strong>
              {event.category ? <span className="context-category">{event.category}</span> : null}
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
  const [zoom, setZoom] = useState(1);
  const image = block.diagram.image;
  return (
    <div className="context-kind-view">
      <figure className="context-diagram-figure">
        <div
          className="context-diagram-scroll"
          role="region"
          aria-label={`Scrollable diagram: ${block.title}`}
          tabIndex={0}
        >
          <Image
            src={image.src}
            alt={image.alt}
            aria-describedby={`${captionId} ${descriptionId}`}
            width={image.width ?? 1200}
            height={image.height ?? 800}
            unoptimized
            className="context-diagram-image"
            style={{ width: `${zoom * 100}%`, maxWidth: "none", height: "auto" }}
          />
        </div>
        <figcaption id={captionId} className="context-visual-caption">
          {caption}
        </figcaption>
      </figure>
      <div className="context-diagram-controls" aria-label="Diagram zoom controls">
        <button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} disabled={zoom >= 3}>
          Zoom in
        </button>
        <button type="button" onClick={() => setZoom((value) => Math.max(1, value - 0.25))} disabled={zoom <= 1}>
          Zoom out
        </button>
        <button type="button" onClick={() => setZoom(1)} disabled={zoom === 1}>
          Reset image
        </button>
        <span aria-live="polite">{Math.round(zoom * 100)} percent</span>
      </div>

      {block.diagram.parts.length > 0 ? (
        <section aria-labelledby={`${block.id}-parts-heading`}>
          <h4 id={`${block.id}-parts-heading`}>Named parts</h4>
          <dl className="context-parts-list">
            {block.diagram.parts.map((part) => (
              <div key={part.id}>
                <dt>{part.label}</dt>
                <dd>{part.description ?? "No additional description provided."}</dd>
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
              const from = block.diagram.parts.find((part) => part.id === relationship.fromId)?.label ?? relationship.fromId;
              const to = block.diagram.parts.find((part) => part.id === relationship.toId)?.label ?? relationship.toId;
              return <li key={`${relationship.fromId}-${relationship.toId}-${index}`}><strong>{from}</strong> {relationship.label} <strong>{to}</strong>.</li>;
            })}
          </ul>
        </section>
      ) : null}

      {block.diagram.walkthrough.length > 0 ? (
        <section aria-labelledby={`${block.id}-walkthrough-heading`}>
          <h4 id={`${block.id}-walkthrough-heading`}>Walkthrough</h4>
          <ol className="context-walkthrough">
            {block.diagram.walkthrough.map((step, index) => <li key={index}>{step}</li>)}
          </ol>
        </section>
      ) : null}
    </div>
  );
};
