"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { Feature } from "geojson";
import { useTheme } from "./ThemeProvider";
import type {
  ContextCoordinate,
  ContextMapBlock,
} from "@/lib/article-context-types";
import {
  StructuredDataDisclosure,
  countLabel,
  isReducedMotion,
  useNearViewport,
} from "./ArticleContextVisualShared";

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
const MAP_FEATURE_FIT_PADDING = 40;
const MAP_FEATURE_FIT_MAX_ZOOM = 10;
const EXACT_MAP_DATA_NOTE =
  "Exact place, route, and area information is available in the expandable map data below.";
const PARTIAL_MAP_STATUS =
  `Some map details could not load. ${EXACT_MAP_DATA_NOTE}`;

type MapInstance = import("maplibre-gl").Map;
type MapOverlayColors =
  (typeof MAP_OVERLAY_COLORS)[keyof typeof MAP_OVERLAY_COLORS];

const mapFeatureCoordinates = (block: ContextMapBlock): ContextCoordinate[] => [
  ...block.map.places,
  ...block.map.routes.flatMap((route) => route.points),
  ...block.map.areas.flatMap((area) => area.rings.flat()),
];

const uniqueMapFeatureCoordinates = (
  block: ContextMapBlock,
): ContextCoordinate[] =>
  mapFeatureCoordinates(block).filter(
    (coordinate, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.latitude === coordinate.latitude &&
          candidate.longitude === coordinate.longitude,
      ) === index,
  );

export type ContextMapFeatureBounds = [
  southwest: [longitude: number, latitude: number],
  northeast: [longitude: number, latitude: number],
];

const getCoordinateExtent = (
  coordinates: ContextCoordinate[],
): ContextMapFeatureBounds | null => {
  if (coordinates.length === 0) return null;

  const latitudes = coordinates.map((coordinate) => coordinate.latitude);
  const longitudes = coordinates
    .map((coordinate) => coordinate.longitude)
    .sort((a, b) => a - b);
  let largestGap = Number.NEGATIVE_INFINITY;
  let largestGapIndex = 0;

  longitudes.forEach((longitude, index) => {
    const next =
      index === longitudes.length - 1
        ? longitudes[0] + 360
        : longitudes[index + 1];
    const gap = next - longitude;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  });

  const west = longitudes[(largestGapIndex + 1) % longitudes.length];
  const rawEast = longitudes[largestGapIndex];
  const east = rawEast < west ? rawEast + 360 : rawEast;
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);

  return [[west, south], [east, north]];
};

/**
 * Find the smallest longitude interval containing every real map feature.
 * The source center is a viewport hint, not a feature, so it must not enlarge
 * or crop the fitted view. Longitudes may extend past 180 to represent a
 * compact antimeridian-crossing interval to MapLibre.
 */
export const getMapFeatureBounds = (
  block: ContextMapBlock,
): ContextMapFeatureBounds | null => {
  const coordinates = uniqueMapFeatureCoordinates(block);
  if (coordinates.length < 2) return null;
  return getCoordinateExtent(coordinates);
};

type ContextMapCamera = {
  fitBounds: (
    bounds: ContextMapFeatureBounds,
    options: {
      padding: number;
      maxZoom: number;
      duration: number;
      bearing: number;
      pitch: number;
      roll: number;
    },
  ) => unknown;
  jumpTo: (options: {
    center: [longitude: number, latitude: number];
    zoom: number;
    bearing: number;
    pitch: number;
    roll: number;
  }) => unknown;
};

export const fitMapToFeatures = (
  map: ContextMapCamera,
  block: ContextMapBlock,
): "features" | "source" => {
  const bounds = getMapFeatureBounds(block);
  if (bounds) {
    map.fitBounds(bounds, {
      padding: MAP_FEATURE_FIT_PADDING,
      maxZoom: MAP_FEATURE_FIT_MAX_ZOOM,
      duration: 0,
      bearing: 0,
      pitch: 0,
      roll: 0,
    });
    return "features";
  }

  const feature = uniqueMapFeatureCoordinates(block)[0];
  const center = feature ?? block.map.center;
  map.jumpTo({
    center: [center.longitude, center.latitude],
    zoom: block.map.suggestedZoom ?? 5,
    bearing: 0,
    pitch: 0,
    roll: 0,
  });
  return feature ? "features" : "source";
};

export const MapSchematic = ({
  block,
  captionId,
  descriptionId,
}: {
  block: ContextMapBlock;
  captionId?: string;
  descriptionId?: string;
}) => {
  const coordinates = uniqueMapFeatureCoordinates(block);
  const extent = getCoordinateExtent(
    coordinates.length > 0 ? coordinates : [block.map.center],
  )!;
  const [[west, south], [east, north]] = extent;
  const longitudeSpan = east - west;
  const latitudeSpan = north - south;
  const project = (point: ContextCoordinate) => {
    const longitude = point.longitude < west ? point.longitude + 360 : point.longitude;
    return {
      x:
        longitudeSpan === 0
          ? 320
          : 32 + ((longitude - west) / longitudeSpan) * 576,
      y:
        latitudeSpan === 0
          ? 150
          : 24 + ((north - point.latitude) / latitudeSpan) * 252,
    };
  };

  return (
    <figure
      className="context-visual context-map-schematic"
      role="img"
      aria-label={`Coordinate overview for ${block.title}`}
      aria-describedby={[captionId, descriptionId].filter(Boolean).join(" ") || undefined}
    >
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
  captionId,
  descriptionId,
}: {
  block: ContextMapBlock;
  styleUrl: string;
  overlayColors: MapOverlayColors;
  attemptKey: string;
  onUnavailable: (failedAttemptKey: string) => void;
  captionId: string;
  descriptionId: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const nearViewport = useNearViewport(containerRef);
  const mapRef = useRef<MapInstance | null>(null);
  const [map, setMap] = useState<MapInstance | null>(null);
  const [status, setStatus] = useState("Interactive map waiting to load");

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !nearViewport) return;
    let cancelled = false;
    let ready = false;
    let partialFailure = false;
    let failureReported = false;
    let loadTimeout: ReturnType<typeof setTimeout> | null = null;

    const reportUnavailable = () => {
      if (cancelled || ready || failureReported) return;
      failureReported = true;
      onUnavailable(attemptKey);
    };

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
          const canvas = instance.getCanvas();
          canvas.setAttribute("aria-label", `Interactive street map for ${block.title}`);
          canvas.setAttribute("aria-describedby", `${captionId} ${descriptionId}`);
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
              fitMapToFeatures(instance, block);
            } catch {
              reportUnavailable();
              return;
            }
            ready = true;
            if (loadTimeout) clearTimeout(loadTimeout);
            setMap(instance);
            setStatus(partialFailure ? PARTIAL_MAP_STATUS : "Interactive map ready");
          });

          instance.on("error", (event) => {
            if (cancelled || failureReported) return;
            const mapError = event as typeof event & {
              sourceId?: string;
              tile?: unknown;
            };
            const resourceError = event.error as Error & { url?: string };
            const fatalBeforeLoad =
              !ready &&
              (resourceError.url === styleUrl ||
                Boolean(mapError.sourceId && !mapError.tile));
            if (fatalBeforeLoad) {
              reportUnavailable();
              return;
            }
            partialFailure = true;
            setStatus(
              ready
                ? PARTIAL_MAP_STATUS
                : `The interactive map is still loading. Some visual details may be unavailable. ${EXACT_MAP_DATA_NOTE}`,
            );
          });
        })
        .catch(reportUnavailable);

    return () => {
      cancelled = true;
      if (loadTimeout) clearTimeout(loadTimeout);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [attemptKey, block, captionId, descriptionId, nearViewport, onUnavailable, overlayColors, styleUrl]);

  const centerOnPlace = (name: string, longitude: number, latitude: number) => {
    if (!map) return;
    const camera = { center: [longitude, latitude] as [number, number], zoom: Math.max(map.getZoom(), 8) };
    if (isReducedMotion()) map.jumpTo(camera);
    else map.flyTo({ ...camera, essential: false });
    setStatus(`Centered map on ${name}`);
  };

  const reset = () => {
    if (!map) return;
    const cameraSource = fitMapToFeatures(map, block);
    setStatus(
      cameraSource === "features"
        ? "Map view reset to show all mapped features"
        : "Map view reset",
    );
  };

  return (
    <div className="context-interactive-map">
      <div
        className="context-map-surface"
        role="region"
        aria-label={`Interactive street map for ${block.title}`}
        aria-describedby={`${captionId} ${descriptionId}`}
        aria-busy={!map}
      >
        <div ref={containerRef} className="context-map-canvas" />
        {!map ? (
          <p className="context-rich-media-placeholder">
            {nearViewport
              ? "Loading interactive street map."
              : "Street map will load as it approaches the viewport."}
          </p>
        ) : null}
      </div>
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

export const ContextMapView = ({
  block,
  caption,
  captionId,
  descriptionId,
}: {
  block: ContextMapBlock;
  caption: string;
  captionId: string;
  descriptionId: string;
}) => {
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
    ? `Street map tiles load from OpenFreeMap. ${EXACT_MAP_DATA_NOTE}`
    : view === "unavailable"
      ? `The coordinate overview is shown instead. ${EXACT_MAP_DATA_NOTE}`
      : `This coordinate overview is not a street map. ${EXACT_MAP_DATA_NOTE}`;
  const buttonLabel = interactive
    ? "Show coordinate overview"
    : view === "unavailable"
      ? "Retry interactive street map"
      : "Show interactive street map";

  return (
    <div className="context-kind-view">
      <div id={`${block.id}-map-view`} ref={mapViewRef}>
        {interactive ? (
          <InteractiveMap
            block={block}
            styleUrl={MAP_STYLE_URLS[theme]}
            overlayColors={MAP_OVERLAY_COLORS[theme]}
            attemptKey={mapAttemptKey}
            onUnavailable={showUnavailable}
            captionId={captionId}
            descriptionId={descriptionId}
          />
        ) : (
          <MapSchematic
            block={block}
            captionId={captionId}
            descriptionId={descriptionId}
          />
        )}
      </div>
      <p id={captionId} className="context-visual-caption">
        {caption}
      </p>

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

      <div className="context-map-actions">
        <a href={centerUrl} target="_blank" rel="noopener noreferrer" className="context-text-link">
          Open area in OpenStreetMap<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>

      <StructuredDataDisclosure
        label="Exact map data"
        title={block.title}
        meta={[
          block.map.places.length
            ? countLabel(block.map.places.length, "place")
            : null,
          block.map.routes.length
            ? countLabel(block.map.routes.length, "route")
            : null,
          block.map.areas.length
            ? countLabel(block.map.areas.length, "area")
            : null,
        ]
          .filter((value): value is string => Boolean(value))
          .join(", ")}
      >
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
      </StructuredDataDisclosure>
    </div>
  );
};
