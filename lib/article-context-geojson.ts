import type {
  ArticleContextRequest,
  ContextCoordinate,
  ContextMapArea,
  ContextMapBlock,
  ContextMapFeature,
  ContextMapGeometry,
  ContextMapPlace,
  ContextMapRoute,
  ContextSection,
} from "./article-context-types";
import {
  asString,
  buildBaseBlock,
  finiteNumber,
  formatCoordinate,
  isRecord,
  sanitizeContextText,
  uniqueId,
  validCoordinate,
  type BlockCandidate,
  type JsonRecord,
} from "./article-context-foundations";

const MAX_MAP_FEATURES = 200;
const MAX_MAP_COORDINATES = 50_000;
const MAX_GEOMETRY_DEPTH = 8;

type NormalizedMapData = {
  features: ContextMapFeature[];
  places: ContextMapPlace[];
  routes: ContextMapRoute[];
  areas: ContextMapArea[];
  coordinateCount: number;
};

const featureName = (
  properties: JsonRecord | null,
  fallback: string,
): string => {
  for (const key of ["title", "name", "label"]) {
    const value = properties ? asString(properties[key]) : null;
    const clean = value ? sanitizeContextText(value, 200) : "";
    if (clean) return clean;
  }
  return fallback;
};

const featureDescription = (
  properties: JsonRecord | null,
): string | undefined => {
  for (const key of ["description", "caption"]) {
    const value = properties ? asString(properties[key]) : null;
    const clean = value ? sanitizeContextText(value, 600) : "";
    if (clean) return clean;
  }
  return undefined;
};

const coordinatePair = (value: unknown): ContextCoordinate | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = finiteNumber(value[0]);
  const latitude = finiteNumber(value[1]);
  return latitude != null &&
    longitude != null &&
    validCoordinate(latitude, longitude)
    ? { latitude, longitude }
    : null;
};

const coordinateArray = (
  value: unknown,
  minimum: number,
): ContextCoordinate[] | null => {
  if (!Array.isArray(value)) return null;
  const coordinates = value.map(coordinatePair);
  return coordinates.length >= minimum && coordinates.every(Boolean)
    ? (coordinates as ContextCoordinate[])
    : null;
};

const polygonRings = (value: unknown): ContextCoordinate[][] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  const rings: ContextCoordinate[][] = [];
  for (const candidate of value) {
    const ring = coordinateArray(candidate, 4);
    if (!ring) return null;
    const first = ring[0];
    const last = ring.at(-1)!;
    if (
      first.latitude !== last.latitude ||
      first.longitude !== last.longitude
    ) {
      return null;
    }
    rings.push(ring);
  }
  return rings;
};

const parseGeometry = (
  value: unknown,
  depth = 0,
): ContextMapGeometry | null => {
  if (!isRecord(value) || depth > MAX_GEOMETRY_DEPTH) return null;
  const type = asString(value.type);
  if (type === "Point") {
    const coordinates = coordinatePair(value.coordinates);
    return coordinates ? { type, coordinates } : null;
  }
  if (type === "MultiPoint") {
    const coordinates = coordinateArray(value.coordinates, 1);
    return coordinates ? { type, coordinates } : null;
  }
  if (type === "LineString") {
    const coordinates = coordinateArray(value.coordinates, 2);
    return coordinates ? { type, coordinates } : null;
  }
  if (type === "MultiLineString") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
      return null;
    }
    const coordinates = value.coordinates.map((line) =>
      coordinateArray(line, 2),
    );
    return coordinates.every(Boolean)
      ? { type, coordinates: coordinates as ContextCoordinate[][] }
      : null;
  }
  if (type === "Polygon") {
    const coordinates = polygonRings(value.coordinates);
    return coordinates ? { type, coordinates } : null;
  }
  if (type === "MultiPolygon") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length === 0) {
      return null;
    }
    const coordinates = value.coordinates.map(polygonRings);
    return coordinates.every(Boolean)
      ? { type, coordinates: coordinates as ContextCoordinate[][][] }
      : null;
  }
  if (type === "GeometryCollection") {
    if (!Array.isArray(value.geometries) || value.geometries.length === 0) {
      return null;
    }
    const geometries = value.geometries.map((geometry) =>
      parseGeometry(geometry, depth + 1),
    );
    return geometries.every(Boolean)
      ? { type, geometries: geometries as ContextMapGeometry[] }
      : null;
  }
  return null;
};

const coordinatesFromGeometry = (
  geometry: ContextMapGeometry,
): ContextCoordinate[] => {
  if (geometry.type === "Point") return [geometry.coordinates];
  if (geometry.type === "MultiPoint" || geometry.type === "LineString") {
    return geometry.coordinates;
  }
  if (geometry.type === "MultiLineString" || geometry.type === "Polygon") {
    return geometry.coordinates.flat();
  }
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
  return geometry.geometries.flatMap(coordinatesFromGeometry);
};

const addLegacyGeometry = ({
  geometry,
  name,
  description,
  featureIndex,
  places,
  routes,
  areas,
}: {
  geometry: ContextMapGeometry;
  name: string;
  description?: string;
  featureIndex: number;
  places: ContextMapPlace[];
  routes: ContextMapRoute[];
  areas: ContextMapArea[];
}): void => {
  const details = description ? { description } : {};
  if (geometry.type === "Point") {
    places.push({
      id: uniqueId(
        "place",
        `${name}:${geometry.coordinates.latitude}:${geometry.coordinates.longitude}`,
        featureIndex,
      ),
      name,
      ...geometry.coordinates,
      ...details,
    });
    return;
  }
  if (geometry.type === "MultiPoint") {
    geometry.coordinates.forEach((coordinates, index) =>
      addLegacyGeometry({
        geometry: { type: "Point", coordinates },
        name: geometry.coordinates.length === 1 ? name : `${name} ${index + 1}`,
        description,
        featureIndex: featureIndex * 1_000 + index,
        places,
        routes,
        areas,
      }),
    );
    return;
  }
  if (geometry.type === "LineString") {
    routes.push({
      id: uniqueId(
        "route",
        `${name}:${JSON.stringify(geometry.coordinates)}`,
        featureIndex,
      ),
      name,
      points: geometry.coordinates,
      ...details,
    });
    return;
  }
  if (geometry.type === "MultiLineString") {
    geometry.coordinates.forEach((coordinates, index) =>
      addLegacyGeometry({
        geometry: { type: "LineString", coordinates },
        name: geometry.coordinates.length === 1 ? name : `${name} ${index + 1}`,
        description,
        featureIndex: featureIndex * 1_000 + index,
        places,
        routes,
        areas,
      }),
    );
    return;
  }
  if (geometry.type === "Polygon") {
    areas.push({
      id: uniqueId(
        "area",
        `${name}:${JSON.stringify(geometry.coordinates)}`,
        featureIndex,
      ),
      name,
      rings: geometry.coordinates,
      ...details,
    });
    return;
  }
  if (geometry.type === "MultiPolygon") {
    geometry.coordinates.forEach((coordinates, index) =>
      addLegacyGeometry({
        geometry: { type: "Polygon", coordinates },
        name: geometry.coordinates.length === 1 ? name : `${name} ${index + 1}`,
        description,
        featureIndex: featureIndex * 1_000 + index,
        places,
        routes,
        areas,
      }),
    );
    return;
  }
  geometry.geometries.forEach((child, index) =>
    addLegacyGeometry({
      geometry: child,
      name: geometry.geometries.length === 1 ? name : `${name} ${index + 1}`,
      description,
      featureIndex: featureIndex * 1_000 + index,
      places,
      routes,
      areas,
    }),
  );
};

export const normalizeGeoJson = (
  value: unknown,
  fallbackName: string,
): NormalizedMapData | null => {
  if (!isRecord(value)) return null;
  const sourceFeatures: Array<{
    geometry: ContextMapGeometry;
    properties: JsonRecord | null;
  }> = [];
  const type = asString(value.type);
  if (type === "FeatureCollection") {
    if (
      !Array.isArray(value.features) ||
      value.features.length === 0 ||
      value.features.length > MAX_MAP_FEATURES
    ) {
      return null;
    }
    for (const valueFeature of value.features) {
      if (!isRecord(valueFeature) || valueFeature.type !== "Feature")
        return null;
      const geometry = parseGeometry(valueFeature.geometry);
      if (!geometry) return null;
      sourceFeatures.push({
        geometry,
        properties: isRecord(valueFeature.properties)
          ? valueFeature.properties
          : null,
      });
    }
  } else if (type === "Feature") {
    const geometry = parseGeometry(value.geometry);
    if (!geometry) return null;
    sourceFeatures.push({
      geometry,
      properties: isRecord(value.properties) ? value.properties : null,
    });
  } else {
    const geometry = parseGeometry(value);
    if (!geometry) return null;
    sourceFeatures.push({ geometry, properties: null });
  }

  const coordinateCount = sourceFeatures.reduce(
    (total, feature) =>
      total + coordinatesFromGeometry(feature.geometry).length,
    0,
  );
  if (coordinateCount === 0 || coordinateCount > MAX_MAP_COORDINATES)
    return null;

  const places: ContextMapPlace[] = [];
  const routes: ContextMapRoute[] = [];
  const areas: ContextMapArea[] = [];
  const features = sourceFeatures.map(({ geometry, properties }, index) => {
    const name = featureName(properties, `${fallbackName} ${index + 1}`);
    const description = featureDescription(properties);
    addLegacyGeometry({
      geometry,
      name,
      description,
      featureIndex: index,
      places,
      routes,
      areas,
    });
    return {
      id: uniqueId("feature", `${name}:${JSON.stringify(geometry)}`, index),
      name,
      ...(description ? { description } : {}),
      geometry,
    } satisfies ContextMapFeature;
  });
  return { features, places, routes, areas, coordinateCount };
};

const mapCenter = (features: ContextMapFeature[]): ContextCoordinate | null => {
  const coordinates = features.flatMap((feature) =>
    coordinatesFromGeometry(feature.geometry),
  );
  if (coordinates.length === 0) return null;
  const totals = coordinates.reduce<{
    latitude: number;
    longitude: number;
    longitudeSine: number;
    longitudeCosine: number;
  }>(
    (sum, coordinate) => ({
      latitude: sum.latitude + coordinate.latitude,
      longitude: sum.longitude + coordinate.longitude,
      longitudeSine:
        sum.longitudeSine + Math.sin((coordinate.longitude * Math.PI) / 180),
      longitudeCosine:
        sum.longitudeCosine + Math.cos((coordinate.longitude * Math.PI) / 180),
    }),
    {
      latitude: 0,
      longitude: 0,
      longitudeSine: 0,
      longitudeCosine: 0,
    },
  );
  const circularMagnitude = Math.hypot(
    totals.longitudeSine,
    totals.longitudeCosine,
  );
  return {
    latitude: totals.latitude / coordinates.length,
    longitude:
      circularMagnitude < 1e-12
        ? totals.longitude / coordinates.length
        : (Math.atan2(totals.longitudeSine, totals.longitudeCosine) * 180) /
          Math.PI,
  };
};

const mapDescription = (data: NormalizedMapData): string => {
  const examples = data.places
    .slice(0, 20)
    .map(
      (place) =>
        `${place.name} is at ${formatCoordinate(place)}${
          place.description ? `: ${place.description}` : ""
        }`,
    );
  const summary = [
    `${data.features.length} source ${
      data.features.length === 1 ? "feature" : "features"
    }`,
    data.places.length > 0
      ? `${data.places.length} ${data.places.length === 1 ? "place" : "places"}`
      : null,
    data.routes.length > 0
      ? `${data.routes.length} ${data.routes.length === 1 ? "route" : "routes"}`
      : null,
    data.areas.length > 0
      ? `${data.areas.length} ${data.areas.length === 1 ? "area" : "areas"}`
      : null,
  ].filter((part): part is string => Boolean(part));
  return `The source map contains ${summary.join(", ")} across ${
    data.coordinateCount
  } coordinate points.${examples.length > 0 ? ` ${examples.join(". ")}.` : ""}`;
};

export const createMapCandidateFromGeoJson = ({
  value,
  fallbackName,
  suggestedZoom,
  request,
  sourceHash,
  generatedAt,
  section,
  position,
  sourceIdentity,
}: {
  value: unknown;
  fallbackName: string;
  suggestedZoom?: number;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  section: ContextSection;
  position: number;
  sourceIdentity: string;
}): BlockCandidate | null => {
  const data = normalizeGeoJson(value, fallbackName);
  if (!data) return null;
  const center = mapCenter(data.features);
  if (!center || !validCoordinate(center.latitude, center.longitude))
    return null;
  const subject =
    section.index === "__summary__" ? request.title : section.title;
  const base = buildBaseBlock({
    request,
    sourceHash,
    generatedAt,
    kind: "map",
    section,
    title: `Map of ${subject}`,
    caption: `The source map identifies ${data.features.length} ${
      data.features.length === 1 ? "feature" : "features"
    } associated with ${subject}.`,
    longDescription: mapDescription(data),
    sourceIdentity,
  });
  const block: ContextMapBlock = {
    ...base,
    kind: "map",
    map: {
      center,
      ...(suggestedZoom != null
        ? {
            suggestedZoom: Math.min(18, Math.max(1, Math.round(suggestedZoom))),
          }
        : {}),
      features: data.features,
      places: data.places,
      routes: data.routes,
      areas: data.areas,
    },
  };
  return { block, position, priority: 98 };
};
