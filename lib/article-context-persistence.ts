import { anyApi } from "convex/server";
import { fetchAction, fetchQuery } from "convex/nextjs";
import {
  CONTEXT_DESCRIPTION_PROMPT_VERSION,
  getContextDescriptionModel,
  isArticleContextAIEnabled,
} from "@/lib/article-context-ai";
import {
  getEnhancedArticleContext,
} from "@/lib/article-context";
import {
  normalizeArticleContextRequest,
  validateContextManifest,
  type ArticleContextExtractorOptions,
} from "@/lib/article-context-extractor";
import {
  ARTICLE_CONTEXT_EXTRACTOR_VERSION,
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  type ArticleContextApiResponse,
  type ArticleContextRequest,
  type ContextBlock,
  type ContextManifest,
} from "@/lib/article-context-types";

const DETERMINISTIC_AI_RETRY_MS = 60 * 60 * 1_000;

type PersistentCacheRecord = {
  manifestJson: string;
  sourceHash: string;
  updatedAt: number;
};

type ContextModeration = {
  mode: "suppress" | "override";
  override?: Partial<
    Pick<ContextBlock, "title" | "caption" | "longDescription">
  > & {
    /** Read-only compatibility for moderation records created before schema v2. */
    takeaway?: string;
    /** Deliberately ignored; visual context no longer participates in audio. */
    spokenSummary?: string;
  };
  updatedAt: number;
};

const hasConvex = (): boolean =>
  process.env.NEXT_PUBLIC_LOCAL_MODE !== "true" &&
  Boolean(process.env.NEXT_PUBLIC_CONVEX_URL?.trim());

export const getArticleContextWriteSecret = (): string | null =>
  process.env.ARTICLE_CONTEXT_WRITE_SECRET?.trim() ||
  (process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_LOCAL_MODE === "true"
    ? process.env.CRON_SECRET?.trim() || null
    : null);

const parseCachedManifest = (
  record: PersistentCacheRecord,
  request: ArticleContextRequest,
): ContextManifest | null => {
  let manifest: ContextManifest;
  try {
    manifest = JSON.parse(record.manifestJson) as ContextManifest;
  } catch {
    return null;
  }

  if (
    manifest.schemaVersion !== ARTICLE_CONTEXT_SCHEMA_VERSION ||
    manifest.wikiPageId !== request.wikiPageId ||
    manifest.revisionId !== request.revisionId ||
    manifest.language !== request.language ||
    manifest.extractorVersion !== ARTICLE_CONTEXT_EXTRACTOR_VERSION ||
    manifest.sourceHash !== record.sourceHash ||
    validateContextManifest(manifest).length > 0
  ) {
    return null;
  }

  const aiBlocks = manifest.blocks.filter(
    (block) => block.provenance.descriptionMethod === "ai-assisted",
  );
  if (!isArticleContextAIEnabled()) {
    return aiBlocks.length === 0 ? manifest : null;
  }

  if (aiBlocks.length > 0) {
    const model = getContextDescriptionModel();
    return aiBlocks.every(
      (block) =>
        block.provenance.model === model &&
        block.provenance.promptVersion ===
          CONTEXT_DESCRIPTION_PROMPT_VERSION,
    )
      ? manifest
      : null;
  }

  // A fail-open deterministic result is reusable briefly, but a transient
  // OpenAI failure should not prevent a later request from trying Luna again.
  return Date.now() - record.updatedAt < DETERMINISTIC_AI_RETRY_MS
    ? manifest
    : null;
};

const readPersistentContext = async (
  request: ArticleContextRequest,
): Promise<ContextManifest | null> => {
  if (!hasConvex()) return null;
  try {
    const record = (await fetchQuery(
      anyApi.articleContexts.getLatestArticleContextCache,
      {
        wikiPageId: request.wikiPageId,
        revisionId: request.revisionId,
        extractorVersion: ARTICLE_CONTEXT_EXTRACTOR_VERSION,
      },
    )) as PersistentCacheRecord | null;
    return record ? parseCachedManifest(record, request) : null;
  } catch (error) {
    console.warn(
      "[article-context] Durable cache read failed; rebuilding from Wikipedia.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return null;
  }
};

const savePersistentContext = async (manifest: ContextManifest): Promise<void> => {
  const adminSecret = getArticleContextWriteSecret();
  if (
    !hasConvex() ||
    !adminSecret ||
    manifest.schemaVersion !== ARTICLE_CONTEXT_SCHEMA_VERSION ||
    validateContextManifest(manifest).length > 0
  ) {
    return;
  }
  try {
    await fetchAction(anyApi.articleContexts.saveArticleContextCache, {
      adminSecret,
      wikiPageId: manifest.wikiPageId,
      revisionId: manifest.revisionId,
      extractorVersion: manifest.extractorVersion,
      sourceHash: manifest.sourceHash,
      manifestJson: JSON.stringify(manifest),
    });
  } catch (error) {
    console.warn(
      "[article-context] Durable cache write failed; serving the generated context.",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
};

const applyModeration = async (
  manifest: ContextManifest,
): Promise<ContextManifest> => {
  if (!hasConvex() || manifest.blocks.length === 0) return manifest;

  let moderation: Array<ContextModeration | null>;
  try {
    moderation = await Promise.all(
      manifest.blocks.map((block) =>
        fetchQuery(anyApi.articleContexts.getArticleContextModeration, {
          wikiPageId: manifest.wikiPageId,
          revisionId: manifest.revisionId,
          blockId: block.id,
          sourceHash: manifest.sourceHash,
        }) as Promise<ContextModeration | null>,
      ),
    );
  } catch (error) {
    console.warn(
      "[article-context] Moderation read failed; serving the validated source context.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return manifest;
  }

  return {
    ...manifest,
    blocks: manifest.blocks.flatMap((block, index) => {
      const rule = moderation[index];
      if (rule?.mode === "suppress") return [];
      if (rule?.mode !== "override" || !rule.override) return [block];
      const override: Partial<
        Pick<ContextBlock, "title" | "caption" | "longDescription">
      > = {};
      if (rule.override.title) override.title = rule.override.title;
      const caption = rule.override.caption || rule.override.takeaway;
      if (caption) override.caption = caption;
      if (rule.override.longDescription) {
        override.longDescription = rule.override.longDescription;
      }
      // A legacy spokenSummary-only override has no visual-context equivalent.
      if (Object.keys(override).length === 0) return [block];
      return [
        {
          ...block,
          ...override,
          provenance: {
            ...block.provenance,
            editorialOverride: {
              kind: "owner-accessibility-copy" as const,
              updatedAt: new Date(rule.updatedAt).toISOString(),
            },
          },
        },
      ];
    }),
  };
};

/**
 * Production-facing context service: durable cache first, deterministic and
 * fail-open AI generation second, then owner moderation at read time.
 */
export const getPublishedArticleContext = async (
  input: ArticleContextRequest,
  options: ArticleContextExtractorOptions & {
    enhance?: (manifest: ContextManifest) => Promise<ContextManifest>;
  } = {},
): Promise<ArticleContextApiResponse> => {
  // V2 rejects non-English input here, before any Convex read or write. The
  // durable cache key can therefore omit language without cross-wiki
  // collisions; add language to the schema when extraction becomes multilingual.
  const request = normalizeArticleContextRequest(input);
  const persistent = await readPersistentContext(request);
  if (persistent) {
    return {
      context: await applyModeration(persistent),
      cacheStatus: "hit",
    };
  }

  const generated = await getEnhancedArticleContext(request, options);
  await savePersistentContext(generated.context);
  return {
    context: await applyModeration(generated.context),
    cacheStatus: generated.cacheStatus,
  };
};
