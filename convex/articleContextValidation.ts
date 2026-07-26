import { ARTICLE_CONTEXT_SCHEMA_VERSION } from "../lib/article-context-types";
import { isValidContextDiagramLegend } from "../lib/article-context-legend";
import { MAX_BLOCKS_PER_ARTICLE } from "../lib/article-context-limits";

export { ARTICLE_CONTEXT_SCHEMA_VERSION } from "../lib/article-context-types";

export const MAX_ARTICLE_CONTEXT_MANIFEST_BYTES = 400_000;
export const MAX_ARTICLE_CONTEXT_BLOCKS = MAX_BLOCKS_PER_ARTICLE;

export type ArticleContextCacheKey = {
  wikiPageId: string;
  revisionId: string;
  extractorVersion: string;
  sourceHash: string;
};

export type ArticleContextBlockKey = {
  wikiPageId: string;
  revisionId: string;
  blockId: string;
  sourceHash: string;
};

export type ArticleContextReportReason =
  | "inaccurate"
  | "misleading"
  | "accessibility"
  | "broken"
  | "inappropriate"
  | "other";

export type ArticleContextReportStatus =
  | "open"
  | "reviewing"
  | "resolved"
  | "dismissed";

export type ArticleContextTextOverride = {
  title?: string;
  caption?: string;
  longDescription?: string;
};

type Environment = Record<string, string | undefined>;

export const utf8Length = (value: string) =>
  new TextEncoder().encode(value).byteLength;

export const assertBoundedKeyPart = (
  name: string,
  value: string,
  maxBytes: number,
) => {
  if (!value || value !== value.trim()) {
    throw new Error(`${name} must be a non-empty, trimmed string`);
  }
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`${name} must not contain control characters`);
  }
  if (utf8Length(value) > maxBytes) {
    throw new Error(`${name} is too long`);
  }
};

const assertSourceHash = (sourceHash: string) => {
  assertBoundedKeyPart("sourceHash", sourceHash, 256);
  if (!/^[A-Za-z0-9._~:+/=-]+$/.test(sourceHash)) {
    throw new Error("sourceHash must be an opaque ASCII hash value");
  }
};

export const assertValidCacheKey = (key: ArticleContextCacheKey) => {
  assertBoundedKeyPart("wikiPageId", key.wikiPageId, 128);
  assertBoundedKeyPart("revisionId", key.revisionId, 128);
  assertBoundedKeyPart("extractorVersion", key.extractorVersion, 64);
  assertSourceHash(key.sourceHash);
};

export const assertValidBlockKey = (key: ArticleContextBlockKey) => {
  assertBoundedKeyPart("wikiPageId", key.wikiPageId, 128);
  assertBoundedKeyPart("revisionId", key.revisionId, 128);
  assertBoundedKeyPart("blockId", key.blockId, 256);
  assertSourceHash(key.sourceHash);
};

const constantTimeEqual = (left: string, right: string) => {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const leftCode = index < left.length ? left.charCodeAt(index) : 0;
    const rightCode = index < right.length ? right.charCodeAt(index) : 0;
    mismatch |= leftCode ^ rightCode;
  }

  return mismatch === 0;
};

/**
 * Server-originated writes are authenticated inside the Convex runtime.
 * ARTICLE_CONTEXT_WRITE_SECRET is preferred; CRON_SECRET is a convenient
 * fallback for existing deployments. An explicit local-only escape hatch is
 * available for isolated development deployments and is never enabled by
 * NODE_ENV alone.
 */
export const assertArticleContextWriteAuthorized = (
  providedSecret: string,
  environment: Environment = process.env,
) => {
  const expectedSecret =
    environment.ARTICLE_CONTEXT_WRITE_SECRET?.trim() ||
    environment.CRON_SECRET?.trim();

  if (expectedSecret) {
    if (!constantTimeEqual(providedSecret, expectedSecret)) {
      throw new Error("Unauthorized");
    }
    return;
  }

  if (environment.ARTICLE_CONTEXT_ALLOW_INSECURE_LOCAL_WRITES === "1") {
    return;
  }

  throw new Error(
    "ARTICLE_CONTEXT_WRITE_SECRET (or CRON_SECRET) is not configured in Convex",
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MAX_CONTEXT_DIAGRAM_IMAGE_URL_BYTES = 8_192;
const MAX_CONTEXT_DIAGRAM_ALT_BYTES = 4_000;
const MAX_CONTEXT_DIAGRAM_WALKTHROUGH_STEPS = 12;
const MAX_CONTEXT_DIAGRAM_ID_BYTES = 256;
const MAX_CONTEXT_DIAGRAM_LABEL_BYTES = 1_000;
const MAX_CONTEXT_DIAGRAM_DESCRIPTION_BYTES = 4_000;
const MAX_CONTEXT_DIAGRAM_CAPTION_BYTES = 10_000;

const isBoundedContextText = (
  value: unknown,
  maxBytes: number,
): value is string =>
  typeof value === "string" &&
  Boolean(value) &&
  value === value.trim() &&
  !/\p{Cc}/u.test(value) &&
  utf8Length(value) <= maxBytes;

const isSafeContextImageUrl = (value: unknown): value is string => {
  if (!isBoundedContextText(value, MAX_CONTEXT_DIAGRAM_IMAGE_URL_BYTES)) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "upload.wikimedia.org" &&
      url.pathname.startsWith("/wikipedia/commons/") &&
      !url.pathname.toLocaleLowerCase().includes("/math/") &&
      !url.pathname.toLocaleLowerCase().endsWith(".svg")
    );
  } catch {
    return false;
  }
};

const isValidContextDimension = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

const isValidContextDiagram = (value: unknown): boolean => {
  if (!isRecord(value) || !isRecord(value.image)) return false;
  const image = value.image;
  if (
    !isSafeContextImageUrl(image.src) ||
    !isBoundedContextText(image.alt, MAX_CONTEXT_DIAGRAM_ALT_BYTES) ||
    (image.originalSrc !== undefined &&
      !isSafeContextImageUrl(image.originalSrc)) ||
    (image.width !== undefined && !isValidContextDimension(image.width)) ||
    (image.height !== undefined && !isValidContextDimension(image.height))
  ) {
    return false;
  }

  if (!Array.isArray(value.parts)) return false;
  const partIds = new Set<string>();
  for (const part of value.parts) {
    if (
      !isRecord(part) ||
      !isBoundedContextText(part.id, MAX_CONTEXT_DIAGRAM_ID_BYTES) ||
      partIds.has(part.id) ||
      !isBoundedContextText(part.label, MAX_CONTEXT_DIAGRAM_LABEL_BYTES) ||
      (part.description !== undefined &&
        !isBoundedContextText(
          part.description,
          MAX_CONTEXT_DIAGRAM_DESCRIPTION_BYTES,
        ))
    ) {
      return false;
    }
    partIds.add(part.id);
  }

  if (
    !Array.isArray(value.relationships) ||
    value.relationships.some(
      (relationship) =>
        !isRecord(relationship) ||
        !isBoundedContextText(
          relationship.fromId,
          MAX_CONTEXT_DIAGRAM_ID_BYTES,
        ) ||
        !isBoundedContextText(
          relationship.toId,
          MAX_CONTEXT_DIAGRAM_ID_BYTES,
        ) ||
        !isBoundedContextText(
          relationship.label,
          MAX_CONTEXT_DIAGRAM_LABEL_BYTES,
        ),
    )
  ) {
    return false;
  }

  return (
    Array.isArray(value.walkthrough) &&
    value.walkthrough.length > 0 &&
    value.walkthrough.length <= MAX_CONTEXT_DIAGRAM_WALKTHROUGH_STEPS &&
    value.walkthrough.every((step) =>
      isBoundedContextText(step, MAX_CONTEXT_DIAGRAM_DESCRIPTION_BYTES),
    ) &&
    isBoundedContextText(value.caption, MAX_CONTEXT_DIAGRAM_CAPTION_BYTES)
  );
};

export const validateAndNormalizeManifestJson = (
  manifestJson: string,
  key: ArticleContextCacheKey,
) => {
  assertValidCacheKey(key);

  if (utf8Length(manifestJson) > MAX_ARTICLE_CONTEXT_MANIFEST_BYTES) {
    throw new Error(
      `Article context manifests may not exceed ${MAX_ARTICLE_CONTEXT_MANIFEST_BYTES} UTF-8 bytes`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestJson);
  } catch {
    throw new Error("manifestJson must contain valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error("manifestJson must contain a JSON object");
  }
  if (parsed.schemaVersion !== ARTICLE_CONTEXT_SCHEMA_VERSION) {
    throw new Error("Unsupported article context schemaVersion");
  }
  if (parsed.wikiPageId !== key.wikiPageId) {
    throw new Error("Manifest wikiPageId does not match the cache key");
  }
  if (parsed.revisionId !== key.revisionId) {
    throw new Error("Manifest revisionId does not match the cache key");
  }
  if (parsed.extractorVersion !== key.extractorVersion) {
    throw new Error("Manifest extractorVersion does not match the cache key");
  }
  if (parsed.sourceHash !== key.sourceHash) {
    throw new Error("Manifest sourceHash does not match the cache key");
  }
  if (!Array.isArray(parsed.blocks)) {
    throw new Error("Manifest blocks must be an array");
  }
  if (parsed.blocks.length > MAX_ARTICLE_CONTEXT_BLOCKS) {
    throw new Error(
      `Article context manifests may not contain more than ${MAX_ARTICLE_CONTEXT_BLOCKS} blocks`,
    );
  }

  const seenBlockIds = new Set<string>();
  for (const block of parsed.blocks) {
    if (!isRecord(block) || typeof block.id !== "string") {
      throw new Error("Every context block must have a string id");
    }
    assertBoundedKeyPart("block.id", block.id, 256);
    if (seenBlockIds.has(block.id)) {
      throw new Error(`Duplicate context block id: ${block.id}`);
    }
    seenBlockIds.add(block.id);

    if (
      block.kind !== "map" &&
      block.kind !== "timeline" &&
      block.kind !== "chart" &&
      block.kind !== "diagram"
    ) {
      throw new Error(`Unsupported context block kind for ${block.id}`);
    }

    if (
      typeof block.title !== "string" ||
      !block.title.trim() ||
      typeof block.caption !== "string" ||
      !block.caption.trim() ||
      typeof block.longDescription !== "string" ||
      !block.longDescription.trim()
    ) {
      throw new Error(
        `Context block ${block.id} is missing schema-v${ARTICLE_CONTEXT_SCHEMA_VERSION} accessibility copy`,
      );
    }
    if ("takeaway" in block || "spokenSummary" in block) {
      throw new Error(`Context block ${block.id} contains legacy audio copy`);
    }
    if (block.kind === "diagram") {
      if (!isValidContextDiagram(block.diagram)) {
        throw new Error(`Context diagram ${block.id} has invalid diagram data`);
      }
      if (
        isRecord(block.diagram) &&
        block.diagram.legend !== undefined &&
        !isValidContextDiagramLegend(block.diagram.legend)
      ) {
        throw new Error(`Context diagram ${block.id} has an invalid legend`);
      }
    }

    if (!isRecord(block.provenance)) {
      throw new Error(`Context block ${block.id} is missing provenance`);
    }
    if (block.provenance.sourceHash !== key.sourceHash) {
      throw new Error(`Context block ${block.id} has a mismatched sourceHash`);
    }
    if (block.provenance.extractorVersion !== key.extractorVersion) {
      throw new Error(
        `Context block ${block.id} has a mismatched extractorVersion`,
      );
    }
  }

  const normalizedJson = JSON.stringify(parsed);
  const byteLength = utf8Length(normalizedJson);
  if (byteLength > MAX_ARTICLE_CONTEXT_MANIFEST_BYTES) {
    throw new Error(
      `Article context manifests may not exceed ${MAX_ARTICLE_CONTEXT_MANIFEST_BYTES} UTF-8 bytes`,
    );
  }

  return {
    manifestJson: normalizedJson,
    byteLength,
    blockCount: parsed.blocks.length,
    schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
  };
};

export const normalizeOptionalText = (
  name: string,
  value: string | undefined,
  maxBytes: number,
) => {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (utf8Length(normalized) > maxBytes) {
    throw new Error(`${name} is too long`);
  }
  return normalized;
};

export const validateTextOverride = (
  override: ArticleContextTextOverride | undefined,
) => {
  if (!override || !isRecord(override)) {
    throw new Error("An override requires at least one replacement text field");
  }

  const normalized: ArticleContextTextOverride = {
    title: normalizeOptionalText("override.title", override.title, 500),
    caption: normalizeOptionalText("override.caption", override.caption, 4_000),
    longDescription: normalizeOptionalText(
      "override.longDescription",
      override.longDescription,
      32_000,
    ),
  };

  if (!Object.values(normalized).some((value) => value !== undefined)) {
    throw new Error("An override requires at least one replacement text field");
  }

  return normalized;
};
