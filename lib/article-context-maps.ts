import type {
  ArticleContextRequest,
  ContextCoordinate,
  ContextMapArea,
  ContextMapBlock,
  ContextMapPlace,
  ContextMapRoute,
  ContextSection,
} from "./article-context-types";
import {
  asString,
  buildBaseBlock,
  cleanWikitext,
  finiteNumber,
  findWikitextSection,
  formatCoordinate,
  isRecord,
  parseAttributes,
  sanitizeContextText,
  sectionAtOffset,
  sha256,
  uniqueId,
  validCoordinate,
  type BlockCandidate,
  type JsonRecord,
  type MediaWikiParsedSource,
  type SectionBoundary,
} from "./article-context-foundations";

const MAX_MAP_FEATURES = 200;
const MAX_MAP_COORDINATES = 2_000;

type NormalizedMapData = {
  places: ContextMapPlace[];
  routes: ContextMapRoute[];
  areas: ContextMapArea[];
  suggestedZoom?: number;
};

type WikitextTemplate = {
  start: number;
  raw: string;
  parameters: Map<string, string>;
};

const skipWikitextComment = (value: string, index: number): number | null => {
  if (!value.startsWith("<!--", index)) return null;
  const end = value.indexOf("-->", index + 4);
  return end < 0 ? value.length : end + 3;
};

const findBalancedTemplateEnd = (
  value: string,
  start: number,
): number | null => {
  if (!value.startsWith("{{", start)) return null;
  let depth = 0;
  for (let index = start; index < value.length - 1; index += 1) {
    const commentEnd = skipWikitextComment(value, index);
    if (commentEnd != null) {
      index = commentEnd - 1;
      continue;
    }
    if (value.startsWith("{{", index)) {
      depth += 1;
      index += 1;
      continue;
    }
    if (value.startsWith("}}", index)) {
      depth -= 1;
      index += 1;
      if (depth === 0) return index + 1;
    }
  }
  return null;
};

const topLevelDelimiterIndex = (
  value: string,
  delimiter: string,
): number => {
  let templateDepth = 0;
  let linkDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const commentEnd = skipWikitextComment(value, index);
    if (commentEnd != null) {
      index = commentEnd - 1;
      continue;
    }
    if (value.startsWith("{{", index)) {
      templateDepth += 1;
      index += 1;
      continue;
    }
    if (value.startsWith("}}", index) && templateDepth > 0) {
      templateDepth -= 1;
      index += 1;
      continue;
    }
    if (value.startsWith("[[", index)) {
      linkDepth += 1;
      index += 1;
      continue;
    }
    if (value.startsWith("]]", index) && linkDepth > 0) {
      linkDepth -= 1;
      index += 1;
      continue;
    }
    if (
      value.startsWith(delimiter, index) &&
      templateDepth === 0 &&
      linkDepth === 0
    ) {
      return index;
    }
  }
  return -1;
};

const splitTopLevelWikitext = (
  value: string,
  delimiter: string,
): string[] => {
  const parts: string[] = [];
  let partStart = 0;
  let templateDepth = 0;
  let linkDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const commentEnd = skipWikitextComment(value, index);
    if (commentEnd != null) {
      index = commentEnd - 1;
      continue;
    }
    if (value.startsWith("{{", index)) {
      templateDepth += 1;
      index += 1;
      continue;
    }
    if (value.startsWith("}}", index) && templateDepth > 0) {
      templateDepth -= 1;
      index += 1;
      continue;
    }
    if (value.startsWith("[[", index)) {
      linkDepth += 1;
      index += 1;
      continue;
    }
    if (value.startsWith("]]", index) && linkDepth > 0) {
      linkDepth -= 1;
      index += 1;
      continue;
    }
    if (
      value.startsWith(delimiter, index) &&
      templateDepth === 0 &&
      linkDepth === 0
    ) {
      parts.push(value.slice(partStart, index));
      partStart = index + delimiter.length;
      index += delimiter.length - 1;
    }
  }
  parts.push(value.slice(partStart));
  return parts;
};

const normalizeTemplateParameter = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s_]+/g, "-");

const parseWikitextTemplate = (
  wikitext: string,
  start: number,
): WikitextTemplate | null => {
  const end = findBalancedTemplateEnd(wikitext, start);
  if (end == null) return null;
  const raw = wikitext.slice(start, end);
  const parts = splitTopLevelWikitext(raw.slice(2, -2), "|");
  const parameters = new Map<string, string>();
  parts.slice(1).forEach((part) => {
    const equals = topLevelDelimiterIndex(part, "=");
    if (equals < 0) return;
    const name = normalizeTemplateParameter(part.slice(0, equals));
    if (name) parameters.set(name, part.slice(equals + 1).trim());
  });
  return { start, raw, parameters };
};

const findOsmLocationMapTemplates = (wikitext: string): WikitextTemplate[] => {
  const searchable = wikitext.replace(/<!--[\s\S]*?-->/g, (comment) =>
    " ".repeat(comment.length),
  );
  const pattern =
    /\{\{\s*(?:template\s*:\s*)?osm[\s_]+location[\s_]+map(?=\s*(?:\||\}\}))/gi;
  const templates: WikitextTemplate[] = [];
  for (const match of searchable.matchAll(pattern)) {
    const template = parseWikitextTemplate(wikitext, match.index ?? 0);
    if (template) templates.push(template);
  }
  return templates;
};

const parseDecimalCoordTemplate = (
  value: string,
): ContextCoordinate | null => {
  const searchable = value.replace(/<!--[\s\S]*?-->/g, (comment) =>
    " ".repeat(comment.length),
  );
  const match = /\{\{\s*(?:template\s*:\s*)?coord(?=\s*(?:\||\}\}))/i.exec(
    searchable,
  );
  if (!match) return null;
  const template = parseWikitextTemplate(value, match.index);
  if (!template) return null;
  const parts = splitTopLevelWikitext(template.raw.slice(2, -2), "|")
    .slice(1)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  if (!decimal.test(parts[0]) || !decimal.test(parts[1])) return null;
  // Reject degree/minute/second forms rather than interpreting their first two
  // components as latitude and longitude. Named Coord metadata remains safe.
  if (
    parts.slice(2).some(
      (part) => decimal.test(part) || /^[NSEW]$/i.test(part),
    )
  ) {
    return null;
  }
  const latitude = finiteNumber(parts[0]);
  const longitude = finiteNumber(parts[1]);
  return latitude != null &&
    longitude != null &&
    validCoordinate(latitude, longitude)
    ? { latitude, longitude }
    : null;
};

const dedupeMapData = (data: NormalizedMapData): NormalizedMapData => {
  const placeKeys = new Set<string>();
  const places = data.places.filter((place) => {
    const key = `${place.latitude.toFixed(6)}:${place.longitude.toFixed(6)}:${place.name.toLowerCase()}`;
    if (placeKeys.has(key)) return false;
    placeKeys.add(key);
    return true;
  });
  const routeKeys = new Set<string>();
  const routes = data.routes.filter((route) => {
    const key = `${route.name.toLowerCase()}:${route.points
      .map((point) => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`)
      .join(";")}`;
    if (routeKeys.has(key)) return false;
    routeKeys.add(key);
    return true;
  });
  const areaKeys = new Set<string>();
  const areas = data.areas.filter((area) => {
    const first = area.rings[0]?.[0];
    const key = `${area.name.toLowerCase()}:${first?.latitude}:${first?.longitude}`;
    if (areaKeys.has(key)) return false;
    areaKeys.add(key);
    return true;
  });
  return { ...data, places, routes, areas };
};

const mapCenter = (data: NormalizedMapData): ContextCoordinate | null => {
  const coordinates: ContextCoordinate[] = [
    ...data.places,
    ...data.routes.flatMap((route) => route.points),
    ...data.areas.flatMap((area) => area.rings.flatMap((ring) => ring)),
  ];
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
    { latitude: 0, longitude: 0, longitudeSine: 0, longitudeCosine: 0 },
  );
  const circularMagnitude = Math.hypot(
    totals.longitudeSine,
    totals.longitudeCosine,
  );
  const longitude =
    circularMagnitude < 1e-12
      ? totals.longitude / coordinates.length
      : (Math.atan2(totals.longitudeSine, totals.longitudeCosine) * 180) /
        Math.PI;
  return {
    latitude: totals.latitude / coordinates.length,
    longitude,
  };
};

const mapLongDescription = (data: NormalizedMapData): string => {
  const parts: string[] = [];
  if (data.places.length > 0) {
    const placeDescriptions = data.places
      .slice(0, 20)
      .map(
        (place) =>
          `${place.name} is at ${formatCoordinate(place)}${
            place.description ? `: ${place.description}` : ""
          }`,
      );
    parts.push(
      `The source identifies ${data.places.length} ${
        data.places.length === 1 ? "place" : "places"
      }. ${placeDescriptions.join(". ")}.`,
    );
  }
  if (data.routes.length > 0) {
    parts.push(
      `It includes ${data.routes.length} ${
        data.routes.length === 1 ? "route" : "routes"
      }: ${data.routes
        .map(
          (route) =>
            `${route.name}, represented by ${route.points.length} coordinate points`,
        )
        .join("; ")}.`,
    );
  }
  if (data.areas.length > 0) {
    parts.push(
      `It outlines ${data.areas.length} ${
        data.areas.length === 1 ? "area" : "areas"
      }: ${data.areas.map((area) => area.name).join(", ")}.`,
    );
  }
  return parts.join(" ");
};

const createMapCandidate = ({
  data: unnormalized,
  request,
  sourceHash,
  generatedAt,
  section,
  position,
  priority,
  sourceIdentity,
}: {
  data: NormalizedMapData;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  section: ContextSection;
  position: number;
  priority: number;
  sourceIdentity: string;
}): BlockCandidate | null => {
  const data = dedupeMapData(unnormalized);
  const featureCount = data.places.length + data.routes.length + data.areas.length;
  const coordinateCount =
    data.places.length +
    data.routes.reduce((sum, route) => sum + route.points.length, 0) +
    data.areas.reduce(
      (sum, area) =>
        sum + area.rings.reduce((ringSum, ring) => ringSum + ring.length, 0),
      0,
    );
  if (
    featureCount === 0 ||
    featureCount > MAX_MAP_FEATURES ||
    coordinateCount > MAX_MAP_COORDINATES
  ) {
    return null;
  }
  const center = mapCenter(data);
  if (!center || !validCoordinate(center.latitude, center.longitude)) return null;

  const subject = section.index === "__summary__" ? request.title : section.title;
  const overview = [
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
  const caption = `The source map identifies ${overview.join(", ")} associated with ${subject}.`;
  const base = buildBaseBlock({
    request,
    sourceHash,
    generatedAt,
    kind: "map",
    section,
    title: `Map of ${subject}`,
    caption,
    longDescription: mapLongDescription(data),
    sourceIdentity,
  });
  const block: ContextMapBlock = {
    ...base,
    kind: "map",
    map: {
      center,
      ...(data.suggestedZoom != null
        ? { suggestedZoom: data.suggestedZoom }
        : {}),
      places: data.places,
      routes: data.routes,
      areas: data.areas,
    },
  };
  return { block, position, priority };
};

export const extractOsmLocationMapCandidates = ({
  source,
  request,
  sourceHash,
  generatedAt,
}: {
  source: MediaWikiParsedSource;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
}): { candidates: BlockCandidate[]; sectionIndexes: Set<string> } => {
  const candidates: BlockCandidate[] = [];
  const sectionIndexes = new Set<string>();
  findOsmLocationMapTemplates(source.wikitext).forEach((template, templateIndex) => {
    const section = findWikitextSection(
      source.wikitext,
      template.start,
      source.sections,
    );
    sectionIndexes.add(section.index);
    const markerIndexes = [...template.parameters.keys()]
      .flatMap((name) => {
        const match = /^mark-coord(\d+)$/.exec(name);
        return match ? [Number.parseInt(match[1], 10)] : [];
      })
      .filter((index) => Number.isSafeInteger(index) && index >= 0)
      .sort((a, b) => a - b);
    const places = markerIndexes.flatMap((markerIndex, placeIndex) => {
      const coordinateValue = template.parameters.get(`mark-coord${markerIndex}`);
      const coordinate = coordinateValue
        ? parseDecimalCoordTemplate(coordinateValue)
        : null;
      if (!coordinate) return [];
      const rawDescription =
        template.parameters.get(`mark-description${markerIndex}`) ?? "";
      const description = cleanWikitext(rawDescription, 600);
      const name =
        cleanWikitext(
          template.parameters.get(`mark-title${markerIndex}`) ??
            template.parameters.get(`label${markerIndex}`) ??
            rawDescription,
          200,
        ) || `${section.title} location ${markerIndex}`;
      return [
        {
          id: uniqueId(
            "place",
            `${name}:${coordinate.latitude}:${coordinate.longitude}`,
            placeIndex,
          ),
          name,
          ...coordinate,
          ...(description ? { description } : {}),
        } satisfies ContextMapPlace,
      ];
    });
    if (places.length === 0) return;
    const zoom = finiteNumber(template.parameters.get("zoom"));
    const candidate = createMapCandidate({
      data: {
        places,
        routes: [],
        areas: [],
        ...(zoom != null
          ? { suggestedZoom: Math.min(18, Math.max(1, Math.round(zoom))) }
          : {}),
      },
      request,
      sourceHash,
      generatedAt,
      section,
      position: template.start,
      priority: 97,
      sourceIdentity: `osm-location-map:${templateIndex}:${sha256(template.raw)}`,
    });
    if (candidate) candidates.push(candidate);
  });
  return { candidates, sectionIndexes };
};

const extractGeoCoordinates = (
  html: string,
  boundaries: SectionBoundary[],
): Array<{ coordinate: ContextCoordinate; section: ContextSection; position: number }> => {
  const coordinates: Array<{
    coordinate: ContextCoordinate;
    section: ContextSection;
    position: number;
  }> = [];
  const pattern =
    /<span\b[^>]*class="[^"]*\bgeo\b[^"]*"[^>]*>\s*(-?\d+(?:\.\d+)?)\s*;\s*(-?\d+(?:\.\d+)?)\s*<\/span>/gi;
  for (const match of html.matchAll(pattern)) {
    const latitude = finiteNumber(match[1]);
    const longitude = finiteNumber(match[2]);
    if (
      latitude == null ||
      longitude == null ||
      !validCoordinate(latitude, longitude)
    ) {
      continue;
    }
    const position = match.index ?? 0;
    coordinates.push({
      coordinate: { latitude, longitude },
      section: sectionAtOffset(boundaries, position),
      position,
    });
  }
  return coordinates;
};

export const extractHtmlMapCandidates = ({
  source,
  request,
  sourceHash,
  generatedAt,
  boundaries,
  suppressedSectionIndexes = new Set<string>(),
}: {
  source: MediaWikiParsedSource;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  boundaries: SectionBoundary[];
  suppressedSectionIndexes?: ReadonlySet<string>;
}): BlockCandidate[] => {
  const candidates: BlockCandidate[] = [];
  const geos = extractGeoCoordinates(source.html, boundaries);
  const mapTagPattern =
    /<(?:a|span)\b([^>]*\bdata-mw-kartographer=(?:"(?:mapframe|maplink)"|'(?:mapframe|maplink)')[^>]*)>([\s\S]*?)<\/(?:a|span)>/gi;
  let mapIndex = 0;
  for (const match of source.html.matchAll(mapTagPattern)) {
    const currentMapIndex = mapIndex;
    mapIndex += 1;
    const attrs = parseAttributes(match[1]);
    const position = match.index ?? 0;
    const section = sectionAtOffset(boundaries, position);
    let latitude = finiteNumber(attrs["data-lat"]);
    let longitude = finiteNumber(attrs["data-lon"]);
    if (
      latitude == null ||
      longitude == null ||
      !validCoordinate(latitude, longitude)
    ) {
      const sameSectionGeos = geos.filter(
        (geo) => geo.section.index === section.index,
      );
      const fallback =
        sameSectionGeos.length === 1 ? sameSectionGeos[0] : undefined;
      latitude = fallback?.coordinate.latitude ?? null;
      longitude = fallback?.coordinate.longitude ?? null;
    }
    if (
      latitude == null ||
      longitude == null ||
      !validCoordinate(latitude, longitude)
    ) {
      continue;
    }
    const innerLabel = sanitizeContextText(match[2], 200);
    const subject = section.index === "__summary__" ? request.title : section.title;
    const hasSemanticLabel = Boolean(
      innerLabel && !/^(map|click for interactive|\u00a0)+$/i.test(innerLabel),
    );
    // An OSM Location map frame's unlabeled coordinate is its viewport, not a
    // place. Its numbered source markers are semantic; if they are malformed,
    // omission is more accurate than announcing the viewport center. Preserve
    // independently labeled map links that happen to share the same section.
    if (suppressedSectionIndexes.has(section.index) && !hasSemanticLabel) {
      continue;
    }
    const name = hasSemanticLabel ? innerLabel : subject;
    const zoomNumber = finiteNumber(attrs["data-zoom"]);
    const suggestedZoom =
      zoomNumber != null
        ? Math.min(18, Math.max(1, Math.round(zoomNumber)))
        : undefined;
    const place: ContextMapPlace = {
      id: uniqueId("place", `${name}:${latitude}:${longitude}`, currentMapIndex),
      name,
      latitude,
      longitude,
      description: `Location supplied by Wikipedia's interactive map.`,
    };
    const candidate = createMapCandidate({
      data: {
        places: [place],
        routes: [],
        areas: [],
        ...(suggestedZoom ? { suggestedZoom } : {}),
      },
      request,
      sourceHash,
      generatedAt,
      section,
      position,
      priority: attrs["data-mw-kartographer"] === "mapframe" ? 95 : 93,
      sourceIdentity: `kartographer:${currentMapIndex}:${latitude}:${longitude}`,
    });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
};
const geoJsonName = (properties: JsonRecord | null, fallback: string): string => {
  for (const key of ["title", "name", "label"]) {
    const value = properties ? asString(properties[key]) : null;
    const clean = value ? cleanWikitext(value, 200) : "";
    if (clean) return clean;
  }
  return fallback;
};

const geoJsonDescription = (properties: JsonRecord | null): string | undefined => {
  for (const key of ["description", "caption"]) {
    const value = properties ? asString(properties[key]) : null;
    const clean = value ? cleanWikitext(value, 600) : "";
    if (clean) return clean;
  }
  return undefined;
};

const coordinatePair = (value: unknown): ContextCoordinate | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = finiteNumber(value[0]);
  const latitude = finiteNumber(value[1]);
  return latitude != null && longitude != null && validCoordinate(latitude, longitude)
    ? { latitude, longitude }
    : null;
};

const normalizeGeoJson = (
  value: unknown,
  fallbackName: string,
): NormalizedMapData | null => {
  const places: ContextMapPlace[] = [];
  const routes: ContextMapRoute[] = [];
  const areas: ContextMapArea[] = [];
  let featureCount = 0;
  let coordinateCount = 0;

  const addGeometry = (
    geometry: JsonRecord,
    properties: JsonRecord | null,
    index: number,
  ) => {
    if (featureCount >= MAX_MAP_FEATURES) return;
    const type = asString(geometry.type);
    const coordinates = geometry.coordinates;
    const name = geoJsonName(properties, `${fallbackName} ${index + 1}`);
    const description = geoJsonDescription(properties);
    if (type === "Point") {
      const coordinate = coordinatePair(coordinates);
      if (!coordinate) return;
      coordinateCount += 1;
      featureCount += 1;
      places.push({
        id: uniqueId("place", `${name}:${coordinate.latitude}:${coordinate.longitude}`, index),
        name,
        ...coordinate,
        ...(description ? { description } : {}),
      });
      return;
    }
    if (type === "LineString" && Array.isArray(coordinates)) {
      const points = coordinates
        .map(coordinatePair)
        .filter((point): point is ContextCoordinate => Boolean(point));
      if (points.length < 2 || points.length !== coordinates.length) return;
      coordinateCount += points.length;
      featureCount += 1;
      routes.push({
        id: uniqueId("route", `${name}:${points.length}`, index),
        name,
        ...(description ? { description } : {}),
        points,
      });
      return;
    }
    if (type === "Polygon" && Array.isArray(coordinates)) {
      const rings = coordinates.flatMap((ring) => {
        if (!Array.isArray(ring)) return [];
        const points = ring
          .map(coordinatePair)
          .filter((point): point is ContextCoordinate => Boolean(point));
        return points.length >= 4 && points.length === ring.length ? [points] : [];
      });
      if (rings.length === 0) return;
      coordinateCount += rings.reduce((sum, ring) => sum + ring.length, 0);
      featureCount += 1;
      areas.push({
        id: uniqueId("area", `${name}:${rings.length}`, index),
        name,
        ...(description ? { description } : {}),
        rings,
      });
    }
  };

  const visit = (node: unknown, inheritedProperties: JsonRecord | null = null) => {
    if (!isRecord(node) || featureCount >= MAX_MAP_FEATURES) return;
    const type = asString(node.type);
    if (type === "FeatureCollection" && Array.isArray(node.features)) {
      node.features.slice(0, MAX_MAP_FEATURES).forEach((feature) =>
        visit(feature, inheritedProperties),
      );
      return;
    }
    if (type === "Feature") {
      const properties = isRecord(node.properties) ? node.properties : null;
      if (isRecord(node.geometry)) {
        addGeometry(node.geometry, properties, featureCount);
      }
      return;
    }
    if (type === "GeometryCollection" && Array.isArray(node.geometries)) {
      node.geometries.slice(0, MAX_MAP_FEATURES).forEach((geometry) => {
        if (isRecord(geometry)) addGeometry(geometry, inheritedProperties, featureCount);
      });
      return;
    }
    if (["Point", "LineString", "Polygon"].includes(type ?? "")) {
      addGeometry(node, inheritedProperties, featureCount);
    }
  };

  visit(value);
  if (
    featureCount === 0 ||
    featureCount > MAX_MAP_FEATURES ||
    coordinateCount > MAX_MAP_COORDINATES
  ) {
    return null;
  }
  return { places, routes, areas };
};

export const extractWikitextMapCandidates = ({
  source,
  request,
  sourceHash,
  generatedAt,
}: {
  source: MediaWikiParsedSource;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
}): BlockCandidate[] => {
  const candidates: BlockCandidate[] = [];
  const pattern = /<(mapframe|maplink)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let index = 0;
  for (const match of source.wikitext.matchAll(pattern)) {
    const rawPayload = match[3].trim();
    if (!rawPayload || rawPayload.length > 1_000_000) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      continue;
    }
    const position = match.index ?? 0;
    const section = findWikitextSection(
      source.wikitext,
      position,
      source.sections,
    );
    const normalized = normalizeGeoJson(payload, section.title || request.title);
    if (!normalized) continue;
    const attrs = parseAttributes(match[2]);
    const zoom = finiteNumber(attrs.zoom);
    const candidate = createMapCandidate({
      data: {
        ...normalized,
        ...(zoom != null
          ? { suggestedZoom: Math.min(18, Math.max(1, Math.round(zoom))) }
          : {}),
      },
      request,
      sourceHash,
      generatedAt,
      section,
      position,
      priority: 98,
      sourceIdentity: `geojson:${index}:${sha256(rawPayload)}`,
    });
    if (candidate) candidates.push(candidate);
    index += 1;
  }
  return candidates;
};
