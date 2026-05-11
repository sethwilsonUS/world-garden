import { createHmac, timingSafeEqual } from "node:crypto";

const HOUR_MS = 60 * 60 * 1000;
const ROLLUP_SOURCE = "vercel_analytics_drain";

const SENSITIVE_DIMENSION_KEYS = [
  "auth",
  "authorization",
  "cookie",
  "device",
  "email",
  "key",
  "password",
  "secret",
  "session",
  "token",
  "user",
];

export type SanitizedDrainEvent = {
  eventType: string;
  eventName?: string;
  eventData: Record<string, string | number | boolean>;
  path?: string;
  timestamp: number;
};

export type AnalyticsRollupInput = {
  key: string;
  bucketStart: number;
  source: string;
  eventType: string;
  eventName?: string;
  path?: string;
  dimensionsJson: string;
  count: number;
};

export const sanitizeAnalyticsPath = (rawPath: unknown): string | undefined => {
  if (typeof rawPath !== "string") return undefined;
  const trimmed = rawPath.trim();
  if (!trimmed) return undefined;

  try {
    const url = new URL(trimmed, "https://curiogarden.local");
    return url.pathname || "/";
  } catch {
    return trimmed.split(/[?#]/, 1)[0] || undefined;
  }
};

const redactDimensionString = (value: string): string => {
  const withoutQuery = value.startsWith("/") ? sanitizeAnalyticsPath(value) ?? value : value;
  return withoutQuery
    .replace(/\b(token|secret|key|authorization|auth|password|session|cookie)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .slice(0, 120);
};

const isSensitiveKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return SENSITIVE_DIMENSION_KEYS.some((sensitive) => lower.includes(sensitive));
};

const parseEventData = (rawEventData: unknown): Record<string, unknown> => {
  if (!rawEventData) return {};
  if (typeof rawEventData === "object" && !Array.isArray(rawEventData)) {
    return rawEventData as Record<string, unknown>;
  }
  if (typeof rawEventData !== "string") return {};

  try {
    const parsed = JSON.parse(rawEventData);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const sanitizeDimensions = (
  rawDimensions: Record<string, unknown>,
): Record<string, string | number | boolean> => {
  const dimensions: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(rawDimensions).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!key || isSensitiveKey(key)) continue;

    if (typeof value === "string") {
      const trimmed = redactDimensionString(value.trim());
      if (trimmed) dimensions[key.slice(0, 64)] = trimmed;
      continue;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      dimensions[key.slice(0, 64)] = value;
      continue;
    }

    if (typeof value === "boolean") {
      dimensions[key.slice(0, 64)] = value;
    }
  }

  return dimensions;
};

const parseTimestamp = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;

    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
};

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const sanitizeDrainEvent = (
  rawEvent: Record<string, unknown>,
): SanitizedDrainEvent | null => {
  const eventType =
    stringValue(rawEvent.eventType) ?? stringValue(rawEvent.type) ?? "unknown";
  const eventName = stringValue(rawEvent.eventName) ?? stringValue(rawEvent.name);
  const path = sanitizeAnalyticsPath(rawEvent.path ?? rawEvent.url);
  const eventData = sanitizeDimensions(parseEventData(rawEvent.eventData));
  const timestamp = parseTimestamp(rawEvent.timestamp ?? rawEvent.time);

  return {
    eventType,
    ...(eventName ? { eventName } : {}),
    eventData,
    ...(path ? { path } : {}),
    timestamp,
  };
};

export const parseVercelAnalyticsDrainPayload = (
  rawBody: string,
): SanitizedDrainEvent[] => {
  const trimmed = rawBody.trim();
  if (!trimmed) return [];

  const parseEvents = (value: unknown): SanitizedDrainEvent[] => {
    const rawEvents = Array.isArray(value) ? value : [value];
    return rawEvents
      .filter((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
      .map(sanitizeDrainEvent)
      .filter((item): item is SanitizedDrainEvent => item !== null);
  };

  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return parseEvents(parsed);
  }

  return trimmed
    .split(/\r?\n/)
    .flatMap((line) => {
      const candidate = line.trim();
      if (!candidate) return [];
      return parseEvents(JSON.parse(candidate));
    });
};

const stableDimensionsJson = (
  dimensions: Record<string, string | number | boolean>,
): string => JSON.stringify(dimensions);

const rollupKey = ({
  bucketStart,
  source,
  eventType,
  eventName,
  path,
  dimensionsJson,
}: Omit<AnalyticsRollupInput, "key" | "count">): string => {
  const dimensionsKey = Buffer.from(dimensionsJson).toString("base64url");
  return [
    bucketStart,
    source,
    encodeURIComponent(eventType),
    encodeURIComponent(eventName ?? ""),
    encodeURIComponent(path ?? ""),
    dimensionsKey,
  ].join(":");
};

export const buildAnalyticsRollups = (
  events: SanitizedDrainEvent[],
): AnalyticsRollupInput[] => {
  const rollups = new Map<string, AnalyticsRollupInput>();

  for (const event of events) {
    const bucketStart = Math.floor(event.timestamp / HOUR_MS) * HOUR_MS;
    const dimensionsJson = stableDimensionsJson(event.eventData);
    const base = {
      bucketStart,
      source: ROLLUP_SOURCE,
      eventType: event.eventType,
      ...(event.eventName ? { eventName: event.eventName } : {}),
      ...(event.path ? { path: event.path } : {}),
      dimensionsJson,
    };
    const key = rollupKey(base);
    const existing = rollups.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    rollups.set(key, { key, ...base, count: 1 });
  }

  return [...rollups.values()];
};

export const signVercelDrainBody = (body: string, secret: string): string =>
  createHmac("sha1", secret).update(body).digest("hex");

export const verifyVercelDrainSignature = Object.assign(
  (body: string, signatureHeader: string | null, secret: string): boolean => {
    if (!signatureHeader || !secret) return false;

    const received = signatureHeader.startsWith("sha1=")
      ? signatureHeader.slice("sha1=".length)
      : signatureHeader;
    const expected = signVercelDrainBody(body, secret);

    try {
      const receivedBuffer = Buffer.from(received, "hex");
      const expectedBuffer = Buffer.from(expected, "hex");
      if (receivedBuffer.length !== expectedBuffer.length) return false;
      return timingSafeEqual(receivedBuffer, expectedBuffer);
    } catch {
      return false;
    }
  },
  { sign: signVercelDrainBody },
);
