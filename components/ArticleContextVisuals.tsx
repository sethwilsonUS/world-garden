"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTheme } from "./ThemeProvider";
import type {
  ContextChartBlock,
  ContextChartSeries,
  ContextCoordinate,
  ContextDiagramBlock,
  ContextMapBlock,
  ContextTimelineBlock,
} from "@/lib/article-context-types";
import type { Feature } from "geojson";
import type { ECharts, EChartsOption } from "echarts";

const CUSTOM_MAP_STYLE_URL = process.env.NEXT_PUBLIC_CONTEXT_MAP_STYLE_URL;
const MAP_STYLE_URLS = {
  light: CUSTOM_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/liberty",
  dark: CUSTOM_MAP_STYLE_URL ?? "https://tiles.openfreemap.org/styles/fiord",
};
const MAP_OVERLAY_COLORS = {
  light: {
    area: "#0f766e",
    route: "#b45309",
    marker: "#047857",
    casing: "#111827",
    markerStroke: "#ffffff",
  },
  dark: {
    area: "#34d399",
    route: "#f2ad5d",
    marker: "#34d399",
    casing: "#111827",
    markerStroke: "#111827",
  },
} as const;
const MAP_LOAD_TIMEOUT_MS = 15_000;

type MapInstance = import("maplibre-gl").Map;
type MapOverlayColors = (typeof MAP_OVERLAY_COLORS)[keyof typeof MAP_OVERLAY_COLORS];

const isReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const allMapCoordinates = (block: ContextMapBlock): ContextCoordinate[] => [
  block.map.center,
  ...block.map.places,
  ...block.map.routes.flatMap((route) => route.points),
  ...block.map.areas.flatMap((area) => area.rings.flat()),
];

export const MapSchematic = ({ block }: { block: ContextMapBlock }) => {
  const coordinates = allMapCoordinates(block);
  const longitudes = coordinates.map((point) => point.longitude);
  const latitudes = coordinates.map((point) => point.latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitudeSpan = maxLongitude - minLongitude;
  const latitudeSpan = maxLatitude - minLatitude;
  const project = (point: ContextCoordinate) => ({
    x:
      longitudeSpan === 0
        ? 320
        : 32 + ((point.longitude - minLongitude) / longitudeSpan) * 576,
    y:
      latitudeSpan === 0
        ? 150
        : 24 + ((maxLatitude - point.latitude) / latitudeSpan) * 252,
  });

  return (
    <figure className="context-visual context-map-schematic">
      <svg
        viewBox="0 0 640 300"
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id={`context-map-grid-${block.id}`} width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" className="context-map-grid-line" />
          </pattern>
        </defs>
        <rect width="640" height="300" rx="14" className="context-map-paper" />
        <rect width="640" height="300" rx="14" fill={`url(#context-map-grid-${block.id})`} />
        {block.map.areas.map((area) =>
          area.rings.map((ring, ringIndex) => (
            <polygon
              key={`${area.id}-${ringIndex}`}
              points={ring.map((point) => {
                const projected = project(point);
                return `${projected.x},${projected.y}`;
              }).join(" ")}
              className="context-map-area"
            />
          )),
        )}
        {block.map.routes.map((route) => (
          <polyline
            key={route.id}
            points={route.points.map((point) => {
              const projected = project(point);
              return `${projected.x},${projected.y}`;
            }).join(" ")}
            className="context-map-route"
          />
        ))}
        {block.map.places.map((place, index) => {
          const point = project(place);
          return (
            <g key={place.id} transform={`translate(${point.x} ${point.y})`}>
              <circle r="9" className="context-map-marker-halo" />
              <circle r="4" className="context-map-marker" />
              <text x="10" y="-8" className="context-map-marker-number">
                {index + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption>
        Coordinate overview — not a street map. Exact locations and descriptions
        follow in the place and route lists.
      </figcaption>
    </figure>
  );
};

const MapControls = ({
  map,
  onAction,
}: {
  map: MapInstance | null;
  onAction: (message: string) => void;
}) => {
  const act = (label: string, action: (map: MapInstance) => void) => {
    if (!map) return;
    action(map);
    onAction(label);
  };

  return (
    <fieldset className="context-map-controls">
      <legend className="sr-only">Map controls</legend>
      <button type="button" onClick={() => act("Zoomed in", (instance) => instance.zoomIn())} disabled={!map}>
        Zoom in
      </button>
      <button type="button" onClick={() => act("Zoomed out", (instance) => instance.zoomOut())} disabled={!map}>
        Zoom out
      </button>
      <button type="button" onClick={() => act("Panned north", (instance) => instance.panBy([0, 100]))} disabled={!map}>
        Pan north
      </button>
      <button type="button" onClick={() => act("Panned south", (instance) => instance.panBy([0, -100]))} disabled={!map}>
        Pan south
      </button>
      <button type="button" onClick={() => act("Panned west", (instance) => instance.panBy([100, 0]))} disabled={!map}>
        Pan west
      </button>
      <button type="button" onClick={() => act("Panned east", (instance) => instance.panBy([-100, 0]))} disabled={!map}>
        Pan east
      </button>
    </fieldset>
  );
};

const InteractiveMap = ({
  block,
  styleUrl,
  overlayColors,
  attemptKey,
  onUnavailable,
}: {
  block: ContextMapBlock;
  styleUrl: string;
  overlayColors: MapOverlayColors;
  attemptKey: string;
  onUnavailable: (failedAttemptKey: string) => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const [map, setMap] = useState<MapInstance | null>(null);
  const [status, setStatus] = useState("Loading interactive map");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const disclosure = container.closest("details");
    let cancelled = false;
    let started = false;
    let ready = false;
    let failureReported = false;
    let loadTimeout: ReturnType<typeof setTimeout> | null = null;

    const reportUnavailable = () => {
      if (cancelled || ready || failureReported) return;
      failureReported = true;
      onUnavailable(attemptKey);
    };

    const start = () => {
      if (started || (disclosure && !disclosure.open)) return;
      started = true;
      setMap(null);
      setStatus("Loading interactive map");
      loadTimeout = setTimeout(reportUnavailable, MAP_LOAD_TIMEOUT_MS);

      import("maplibre-gl")
        .then((maplibre) => {
          if (cancelled || failureReported) return;
          const instance = new maplibre.Map({
            container,
            style: styleUrl,
            center: [block.map.center.longitude, block.map.center.latitude],
            zoom: block.map.suggestedZoom ?? 5,
            attributionControl: false,
            cooperativeGestures: true,
          });
          instance
            .getCanvas()
            .setAttribute("aria-label", `Interactive street map for ${block.title}`);
          mapRef.current = instance;

          instance.once("load", () => {
            if (cancelled || failureReported) return;
            try {
              const features: Feature[] = [
                ...block.map.areas.flatMap((area) =>
                  area.rings.map((ring) => ({
                    type: "Feature" as const,
                    properties: { kind: "area", name: area.name },
                    geometry: {
                      type: "Polygon" as const,
                      coordinates: [ring.map((point) => [point.longitude, point.latitude])],
                    },
                  })),
                ),
                ...block.map.routes.map((route) => ({
                  type: "Feature" as const,
                  properties: { kind: "route", name: route.name },
                  geometry: {
                    type: "LineString" as const,
                    coordinates: route.points.map((point) => [point.longitude, point.latitude]),
                  },
                })),
                ...block.map.places.map((place) => ({
                  type: "Feature" as const,
                  properties: { kind: "place", id: place.id, name: place.name },
                  geometry: {
                    type: "Point" as const,
                    coordinates: [place.longitude, place.latitude],
                  },
                })),
              ];

              instance.addSource("article-context", {
                type: "geojson",
                data: { type: "FeatureCollection", features },
              });
              instance.addLayer({
                id: "context-areas",
                type: "fill",
                source: "article-context",
                filter: ["==", ["get", "kind"], "area"],
                paint: { "fill-color": overlayColors.area, "fill-opacity": 0.22 },
              });
              instance.addLayer({
                id: "context-areas-casing",
                type: "line",
                source: "article-context",
                filter: ["==", ["get", "kind"], "area"],
                paint: {
                  "line-color": overlayColors.casing,
                  "line-width": 7,
                  "line-opacity": 0.9,
                },
              });
              instance.addLayer({
                id: "context-areas-outline",
                type: "line",
                source: "article-context",
                filter: ["==", ["get", "kind"], "area"],
                paint: { "line-color": overlayColors.area, "line-width": 3 },
              });
              instance.addLayer({
                id: "context-routes-casing",
                type: "line",
                source: "article-context",
                filter: ["==", ["get", "kind"], "route"],
                paint: {
                  "line-color": overlayColors.casing,
                  "line-width": 8,
                  "line-opacity": 0.9,
                },
              });
              instance.addLayer({
                id: "context-routes",
                type: "line",
                source: "article-context",
                filter: ["==", ["get", "kind"], "route"],
                paint: {
                  "line-color": overlayColors.route,
                  "line-width": 4,
                  "line-dasharray": [2, 1],
                },
              });
              instance.addLayer({
                id: "context-places",
                type: "circle",
                source: "article-context",
                filter: ["==", ["get", "kind"], "place"],
                paint: {
                  "circle-color": overlayColors.marker,
                  "circle-radius": 7,
                  "circle-stroke-color": overlayColors.markerStroke,
                  "circle-stroke-width": 3,
                },
              });
            } catch {
              reportUnavailable();
              return;
            }
            ready = true;
            if (loadTimeout) clearTimeout(loadTimeout);
            setMap(instance);
            setStatus("Interactive map ready");
          });

          instance.on("error", (event) => {
            if (cancelled || failureReported) return;
            const mapError = event as typeof event & { tile?: unknown };
            if (!ready && !mapError.tile) {
              reportUnavailable();
              return;
            }
            setStatus(
              ready
                ? "Some map details could not load. The exact place and route lists remain available."
                : "The interactive map is still loading. The exact place and route lists remain available.",
            );
          });
        })
        .catch(reportUnavailable);
    };

    disclosure?.addEventListener("toggle", start);
    start();

    return () => {
      cancelled = true;
      if (loadTimeout) clearTimeout(loadTimeout);
      disclosure?.removeEventListener("toggle", start);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [attemptKey, block, onUnavailable, overlayColors, styleUrl]);

  const centerOnPlace = (name: string, longitude: number, latitude: number) => {
    if (!map) return;
    const camera = { center: [longitude, latitude] as [number, number], zoom: Math.max(map.getZoom(), 8) };
    if (isReducedMotion()) map.jumpTo(camera);
    else map.flyTo({ ...camera, essential: false });
    setStatus(`Centered map on ${name}`);
  };

  const reset = () => {
    if (!map) return;
    map.jumpTo({
      center: [block.map.center.longitude, block.map.center.latitude],
      zoom: block.map.suggestedZoom ?? 5,
    });
    setStatus("Map view reset");
  };

  return (
    <div className="context-interactive-map">
      <div
        ref={containerRef}
        className="context-map-canvas"
      />
      <div className="context-map-toolbar">
        <MapControls map={map} onAction={setStatus} />
        <button type="button" onClick={reset} disabled={!map} className="context-map-reset">
          Reset map
        </button>
      </div>
      {block.map.places.length > 0 ? (
        <div className="context-map-place-controls">
          <p>Center the visual map on a place:</p>
          <ul>
            {block.map.places.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  disabled={!map}
                  onClick={() => centerOnPlace(place.name, place.longitude, place.latitude)}
                >
                  {place.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="context-status" role="status" aria-live="polite">{status}</p>
      <p className="context-attribution">
        Map tiles by{" "}
        <a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">
          OpenFreeMap<span className="sr-only"> (opens in a new tab)</span>
        </a>{" "}
        · Data ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
          OpenStreetMap contributors<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </div>
  );
};

export const ContextMapView = ({ block }: { block: ContextMapBlock }) => {
  const { theme } = useTheme();
  const [view, setView] = useState<"interactive" | "schematic" | "unavailable">(
    "interactive",
  );
  const toggleRef = useRef<HTMLButtonElement>(null);
  const mapViewRef = useRef<HTMLDivElement>(null);
  const centerUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(block.map.center.latitude)}&mlon=${encodeURIComponent(block.map.center.longitude)}#map=${Math.round(block.map.suggestedZoom ?? 5)}/${encodeURIComponent(block.map.center.latitude)}/${encodeURIComponent(block.map.center.longitude)}`;
  const loadNoteId = `${block.id}-map-load-note`;
  const mapAttemptKey = `${block.id}:${theme}:${MAP_STYLE_URLS[theme]}`;
  const activeMapAttemptRef = useRef(mapAttemptKey);
  useLayoutEffect(() => {
    activeMapAttemptRef.current = mapAttemptKey;
    return () => {
      if (activeMapAttemptRef.current === mapAttemptKey) {
        activeMapAttemptRef.current = "";
      }
    };
  }, [mapAttemptKey]);
  const showUnavailable = useCallback((failedAttemptKey: string) => {
    if (activeMapAttemptRef.current !== failedAttemptKey) return;
    const restoreFocus = mapViewRef.current?.contains(document.activeElement) ?? false;
    setView((current) =>
      activeMapAttemptRef.current === failedAttemptKey && current === "interactive"
        ? "unavailable"
        : current,
    );
    if (restoreFocus) {
      requestAnimationFrame(() => {
        if (activeMapAttemptRef.current !== failedAttemptKey) return;
        const activeElement = document.activeElement;
        if (
          activeElement === document.body ||
          (activeElement instanceof Node && mapViewRef.current?.contains(activeElement))
        ) {
          toggleRef.current?.focus();
        }
      });
    }
  }, []);
  const interactive = view === "interactive";
  const promptTitle = interactive
    ? "Interactive street map"
    : view === "unavailable"
      ? "Street map unavailable"
      : "Coordinate overview shown";
  const promptDescription = interactive
    ? "Street map tiles load from OpenFreeMap. Exact place, route, and area information remains available in the semantic lists below."
    : view === "unavailable"
      ? "The coordinate overview is shown instead. Exact place, route, and area information remains available below."
      : "This coordinate overview is not a street map. Exact place, route, and area information remains available below.";
  const buttonLabel = interactive
    ? "Show coordinate overview"
    : view === "unavailable"
      ? "Retry interactive street map"
      : "Show interactive street map";

  return (
    <div className="context-kind-view">
      <div className="context-map-prompt">
        <div>
          <strong>{promptTitle}</strong>
          <p id={loadNoteId}>{promptDescription}</p>
        </div>
        <button
          ref={toggleRef}
          type="button"
          className={`${interactive ? "btn-secondary" : "btn-primary"} context-load-map`}
          aria-controls={`${block.id}-map-view`}
          aria-describedby={loadNoteId}
          onClick={() => setView(interactive ? "schematic" : "interactive")}
        >
          {buttonLabel}
        </button>
      </div>
      <p
        className="sr-only context-map-failure-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {view === "unavailable"
          ? `Street map unavailable. ${promptDescription}`
          : ""}
      </p>

      <div id={`${block.id}-map-view`} ref={mapViewRef}>
        {interactive ? (
          <InteractiveMap
            block={block}
            styleUrl={MAP_STYLE_URLS[theme]}
            overlayColors={MAP_OVERLAY_COLORS[theme]}
            attemptKey={mapAttemptKey}
            onUnavailable={showUnavailable}
          />
        ) : (
          <MapSchematic block={block} />
        )}
      </div>

      <div className="context-map-actions">
        <a href={centerUrl} target="_blank" rel="noopener noreferrer" className="context-text-link">
          Open area in OpenStreetMap<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>

      {block.map.places.length > 0 ? (
        <section aria-labelledby={`${block.id}-places-heading`}>
          <h4 id={`${block.id}-places-heading`}>Places</h4>
          <ol className="context-place-list">
            {block.map.places.map((place) => (
              <li key={place.id}>
                <strong>{place.name}</strong>
                {place.description ? <span>{place.description}</span> : null}
                <span className="context-coordinates">
                  Latitude {place.latitude.toFixed(4)}, longitude {place.longitude.toFixed(4)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {block.map.routes.length > 0 ? (
        <section aria-labelledby={`${block.id}-routes-heading`}>
          <h4 id={`${block.id}-routes-heading`}>Routes</h4>
          <ul className="context-route-list">
            {block.map.routes.map((route) => (
              <li key={route.id}>
                <strong>{route.name}</strong>
                {route.description ? <span>{route.description}</span> : null}
                <span>{route.points.length} mapped points</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {block.map.areas.length > 0 ? (
        <section aria-labelledby={`${block.id}-areas-heading`}>
          <h4 id={`${block.id}-areas-heading`}>Areas</h4>
          <ul className="context-route-list">
            {block.map.areas.map((area) => (
              <li key={area.id}>
                <strong>{area.name}</strong>
                {area.description ? <span>{area.description}</span> : null}
                <span>{area.rings.length} boundary {area.rings.length === 1 ? "ring" : "rings"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

    </div>
  );
};

export const ContextTimelineView = ({ block }: { block: ContextTimelineBlock }) => {
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
    </div>
  );
};

const numericValue = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const buildLinePath = (
  rows: ContextChartBlock["chart"]["rows"],
  series: ContextChartSeries,
  min: number,
  max: number,
): string => {
  const span = max - min || 1;
  return rows.reduce((path, row, index) => {
    const value = numericValue(row[series.yColumn]);
    if (value === null) return path;
    const x = 54 + (index / Math.max(rows.length - 1, 1)) * 550;
    const y = 24 + (1 - (value - min) / span) * 190;
    const previousValue = index > 0 ? numericValue(rows[index - 1][series.yColumn]) : null;
    return `${path}${path ? " " : ""}${previousValue === null ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }, "");
};

const CHART_COLORS = ["#047857", "#b45309", "#2563eb", "#a21caf", "#be123c", "#4d7c0f"];
const FALLBACK_CHART_TOP = 24;
const FALLBACK_CHART_HEIGHT = 190;

const fallbackChartY = (value: number, min: number, max: number): number => {
  const span = max - min || 1;
  return (
    FALLBACK_CHART_TOP +
    (1 - (value - min) / span) * FALLBACK_CHART_HEIGHT
  );
};

export const getFallbackBarGeometry = (
  value: number,
  min: number,
  max: number,
): { y: number; height: number; zeroY: number } => {
  const valueY = fallbackChartY(value, min, max);
  const zeroY = fallbackChartY(0, min, max);
  return {
    y: Math.min(valueY, zeroY),
    height: Math.abs(valueY - zeroY),
    zeroY,
  };
};

const ChartGraphic = ({
  block,
  selectedSeries,
}: {
  block: ContextChartBlock;
  selectedSeries: ContextChartSeries[];
}) => {
  const values = selectedSeries.flatMap((series) =>
    block.chart.rows.map((row) => numericValue(row[series.yColumn])).filter((value): value is number => value !== null),
  );
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const zeroY = fallbackChartY(0, min, max);

  return (
    <figure className="context-visual context-chart-graphic">
      <svg viewBox="0 0 640 260" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
        <rect width="640" height="260" rx="14" className="context-chart-paper" />
        {[0, 1, 2, 3, 4].map((line) => (
          <line key={line} x1="54" x2="604" y1={24 + line * 47.5} y2={24 + line * 47.5} className="context-chart-grid" />
        ))}
        <line x1="54" x2="54" y1="24" y2="214" className="context-chart-axis" />
        <line x1="54" x2="604" y1={zeroY} y2={zeroY} className="context-chart-axis" />
        {selectedSeries.map((series, seriesIndex) => {
          const color = CHART_COLORS[seriesIndex % CHART_COLORS.length];
          if (series.type === "bar" || series.type === "pie") {
            const slotWidth = 550 / Math.max(block.chart.rows.length, 1);
            const barWidth = Math.max(2, (slotWidth * 0.72) / Math.max(selectedSeries.length, 1));
            return block.chart.rows.map((row, rowIndex) => {
              const value = numericValue(row[series.yColumn]);
              if (value === null) return null;
              const geometry = getFallbackBarGeometry(value, min, max);
              return (
                <rect
                  key={`${series.id}-${rowIndex}`}
                  x={54 + rowIndex * slotWidth + seriesIndex * barWidth + slotWidth * 0.14}
                  y={geometry.y}
                  width={barWidth}
                  height={geometry.height}
                  fill={color}
                  className={series.type === "pie" ? "context-chart-pie-bar" : undefined}
                />
              );
            });
          }
          const path = buildLinePath(block.chart.rows, series, min, max);
          return (
            <g key={series.id}>
              {series.type === "area" ? (
                <path d={`${path} L604 ${zeroY} L54 ${zeroY} Z`} fill={color} opacity="0.18" />
              ) : null}
              <path d={path} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
      </svg>
      <figcaption>
        Visual overview of the selected series. The exact values are available in the data table below.
      </figcaption>
    </figure>
  );
};

const EChartsGraphic = ({
  block,
  selectedSeries,
}: {
  block: ContextChartBlock;
  selectedSeries: ContextChartSeries[];
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const disclosure = container.closest("details");
    let chart: ECharts | null = null;
    let cancelled = false;
    let started = false;

    const start = () => {
      if (started || (disclosure && !disclosure.open)) return;
      started = true;
      import("echarts")
        .then((echarts) => {
          if (cancelled) return;
          chart = echarts.init(container, undefined, { renderer: "svg" });
          const xColumn = selectedSeries[0]?.xColumn ?? block.chart.columns[0]?.key;
          const xLabels = block.chart.rows.map((row) => String(row[xColumn] ?? "Not available"));
          const option: EChartsOption = {
            animation: !isReducedMotion(),
            animationDuration: 350,
            color: CHART_COLORS,
            backgroundColor: "transparent",
            grid: { left: 54, right: 22, top: 28, bottom: 54, containLabel: true },
            legend: { show: false },
            tooltip: { show: false },
            xAxis: { type: "category", data: xLabels, axisLabel: { hideOverlap: true } },
            yAxis: { type: "value", scale: true },
            series: selectedSeries.map((series) => {
              if (series.type === "pie") {
                return {
                  id: series.id,
                  name: series.label,
                  type: "pie" as const,
                  radius: ["35%", "68%"],
                  data: block.chart.rows
                    .map((row, index): { name: string; value: number } | null => {
                      const value = numericValue(row[series.yColumn]);
                      return value === null ? null : { name: xLabels[index], value };
                    })
                    .filter((item): item is { name: string; value: number } => item !== null),
                  label: { show: true, formatter: "{b}" },
                };
              }
              return {
                id: series.id,
                name: series.label,
                type: series.type === "bar" ? "bar" as const : "line" as const,
                data: block.chart.rows.map((row) => numericValue(row[series.yColumn])),
                connectNulls: false,
                showSymbol: block.chart.rows.length <= 30,
                areaStyle: series.type === "area" ? { opacity: 0.18 } : undefined,
                emphasis: { disabled: true },
              };
            }),
          };
          chart.setOption(option);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };

    disclosure?.addEventListener("toggle", start);
    start();
    const resize = () => chart?.resize();
    window.addEventListener("resize", resize);
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(resize)
      : null;
    resizeObserver?.observe(container);

    return () => {
      cancelled = true;
      disclosure?.removeEventListener("toggle", start);
      window.removeEventListener("resize", resize);
      resizeObserver?.disconnect();
      chart?.dispose();
    };
  }, [block, selectedSeries]);

  if (failed) return <ChartGraphic block={block} selectedSeries={selectedSeries} />;
  return (
    <figure className="context-visual context-chart-graphic">
      <div ref={containerRef} className="context-echarts" aria-hidden="true" />
      <figcaption>
        Visual overview of the selected series. The exact values are available in the data table below.
      </figcaption>
    </figure>
  );
};

export const ContextChartView = ({ block }: { block: ContextChartBlock }) => {
  const [selectedIds, setSelectedIds] = useState(() => new Set(block.chart.series.map((series) => series.id)));
  const selectedSeries = useMemo(
    () => block.chart.series.filter((series) => selectedIds.has(series.id)),
    [block.chart.series, selectedIds],
  );
  const toggleSeries = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id) && next.size > 1) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="context-kind-view">
      {block.chart.series.length > 1 ? (
        <fieldset className="context-series-controls">
          <legend>Series shown in the visual overview</legend>
          {block.chart.series.map((series) => (
            <label key={series.id}>
              <input type="checkbox" checked={selectedIds.has(series.id)} onChange={() => toggleSeries(series.id)} />
              <span>{series.label}{series.unit ? ` (${series.unit})` : ""}</span>
            </label>
          ))}
        </fieldset>
      ) : null}
      <EChartsGraphic block={block} selectedSeries={selectedSeries} />
      <div className="context-table-wrap" role="region" aria-labelledby={`${block.id}-table-caption`} tabIndex={0}>
        <table className="context-data-table">
          <caption id={`${block.id}-table-caption`}>Exact data for {block.title}</caption>
          <thead>
            <tr>
              {block.chart.columns.map((column) => (
                <th key={column.key} scope="col">
                  {column.label}{column.unit ? <span> ({column.unit})</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.chart.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {block.chart.columns.map((column, columnIndex) => (
                  columnIndex === 0 ? (
                    <th key={column.key} scope="row">{row[column.key] ?? "Not available"}</th>
                  ) : (
                    <td key={column.key}>{row[column.key] ?? "Not available"}</td>
                  )
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const ContextDiagramView = ({ block }: { block: ContextDiagramBlock }) => {
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
            width={image.width ?? 1200}
            height={image.height ?? 800}
            unoptimized
            className="context-diagram-image"
            style={{ width: `${zoom * 100}%`, maxWidth: "none", height: "auto" }}
          />
        </div>
        <figcaption>{block.diagram.caption}</figcaption>
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
