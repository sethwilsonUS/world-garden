export const MAX_ARTICLE_CONTEXT_MANIFEST_BYTES = 400_000;
export const MAX_ARTICLE_CONTEXT_BLOCKS = 6;
export const ARTICLE_CONTEXT_SCHEMA_VERSION = 2;

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
        `Context block ${block.id} is missing schema-v2 accessibility copy`,
      );
    }
    if ("takeaway" in block || "spokenSummary" in block) {
      throw new Error(`Context block ${block.id} contains legacy audio copy`);
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
    caption: normalizeOptionalText(
      "override.caption",
      override.caption,
      4_000,
    ),
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
