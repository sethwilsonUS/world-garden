import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  getOpenAIClient,
  isOpenAIConfigured,
} from "@/lib/openai-client";
import { consumeArticleContextAIQuota } from "@/lib/article-context-ai-quota";
import type {
  ContextBlock,
  ContextManifest,
} from "@/lib/article-context-types";

const DEFAULT_CONTEXT_DESCRIPTION_MODEL = "gpt-5.6-luna";
export const CONTEXT_DESCRIPTION_PROMPT_VERSION = "context-accessibility-v2";
const MAX_CONTEXT_DESCRIPTION_SOURCE_CHARS = 120_000;

const ContextDescriptionSchema = z.object({
  blocks: z
    .array(
      z.object({
        id: z.string(),
        takeaway: z.string().min(1).max(320),
        spokenSummary: z.string().min(1).max(900),
        longDescription: z.string().min(1).max(3_200),
      }),
    )
    .max(6),
});

type ContextDescriptionResult = z.infer<typeof ContextDescriptionSchema>;

type ContextAIClient = Pick<OpenAI, "responses">;

type EnhanceArticleContextOptions = {
  client?: ContextAIClient;
  model?: string;
  consumeQuota?: () => Promise<boolean>;
};

export const getContextDescriptionModel = (): string => {
  const configured = process.env.CONTEXT_DESCRIPTION_MODEL?.trim();
  if (!configured) return DEFAULT_CONTEXT_DESCRIPTION_MODEL;
  return configured.startsWith("openai/")
    ? configured.slice("openai/".length)
    : configured;
};

export const isArticleContextAIEnabled = (): boolean =>
  isOpenAIConfigured() &&
  process.env.ARTICLE_CONTEXT_AI_ENABLED?.trim().toLowerCase() === "true";

const getBlockFacts = (block: ContextBlock): unknown => {
  switch (block.kind) {
    case "map":
      return {
        center: block.map.center,
        suggestedZoom: block.map.suggestedZoom,
        places: block.map.places.slice(0, 40),
        routes: block.map.routes.slice(0, 20).map((route) => ({
          id: route.id,
          name: route.name,
          description: route.description,
          pointCount: route.points.length,
          firstPoint: route.points[0],
          lastPoint: route.points.at(-1),
        })),
        areas: block.map.areas.slice(0, 20).map((area) => ({
          id: area.id,
          name: area.name,
          description: area.description,
          ringCount: area.rings.length,
        })),
      };
    case "timeline":
      return {
        chronological: block.timeline.chronological,
        eventCount: block.timeline.events.length,
        events: block.timeline.events.slice(0, 120),
      };
    case "chart":
      return {
        columns: block.chart.columns,
        series: block.chart.series,
        rowCount: block.chart.rows.length,
        rows: block.chart.rows.slice(0, 60),
        sourceChartType: block.chart.sourceChartType,
      };
    case "diagram":
      return block.diagram;
  }
};

const compactBlocksForPrompt = (blocks: ContextBlock[]) =>
  blocks.map((block) => ({
    id: block.id,
    kind: block.kind,
    title: block.title,
    section: block.section,
    deterministicCopy: {
      takeaway: block.takeaway,
      spokenSummary: block.spokenSummary,
      longDescription: block.longDescription,
    },
    extractedFacts: getBlockFacts(block),
    sources: block.sources.map(({ label, url }) => ({ label, url })),
  }));

const normalizeNumericToken = (value: string): string =>
  value.replace(/[,_\s]/g, "").replace(/^\+/, "");

const numericTokens = (value: string): Set<string> =>
  new Set(
    (value.match(/[-+]?\d[\d,_]*(?:\.\d+)?/g) ?? []).map(
      normalizeNumericToken,
    ),
  );

/**
 * Description generation is allowed to rephrase extracted facts, not invent
 * measurements or dates. Compare block by block so a date or measurement from
 * one visual cannot be borrowed to make another visual sound authoritative.
 */
const hasOnlySourceNumbers = (
  description: ContextDescriptionResult,
  sourceBlocks: Array<{ id: string }>,
): boolean => {
  const sourcesById = new Map(
    sourceBlocks.map((block) => [block.id, numericTokens(JSON.stringify(block))]),
  );
  return description.blocks.every((block) => {
    const allowed = sourcesById.get(block.id);
    if (!allowed) return false;
    return [...numericTokens(JSON.stringify(block))].every((token) =>
      allowed.has(token),
    );
  });
};

const hasExactBlockIds = (
  blocks: ContextBlock[],
  description: ContextDescriptionResult,
): boolean => {
  const expected = blocks.map((block) => block.id).sort();
  const received = description.blocks.map((block) => block.id).sort();
  return (
    expected.length === received.length &&
    expected.every((id, index) => id === received[index]) &&
    new Set(received).size === received.length
  );
};

export const enhanceArticleContextManifest = async (
  manifest: ContextManifest,
  options: EnhanceArticleContextOptions = {},
): Promise<ContextManifest> => {
  if (manifest.blocks.length === 0) return manifest;
  if (!options.client && !isArticleContextAIEnabled()) return manifest;
  if (
    !options.client &&
    !(await (options.consumeQuota ?? consumeArticleContextAIQuota)())
  ) {
    return manifest;
  }

  const model = options.model?.trim() || getContextDescriptionModel();
  const promptBlocks = compactBlocksForPrompt(manifest.blocks);
  const completeSourcePayload = JSON.stringify(promptBlocks);
  const sourceBlocks =
    completeSourcePayload.length <= MAX_CONTEXT_DESCRIPTION_SOURCE_CHARS
      ? promptBlocks
      : promptBlocks.map((block) => ({
          id: block.id,
          kind: block.kind,
          title: block.title,
          section: block.section,
          deterministicCopy: block.deterministicCopy,
          sources: block.sources,
          note: "Structured facts omitted from the copy-editing prompt because the block is unusually large; preserve the deterministic copy exactly rather than adding detail.",
        }));
  const sourcePayload = JSON.stringify(sourceBlocks);

  try {
    const client = options.client ?? getOpenAIClient();
    const response = await client.responses.parse({
      model,
      store: false,
      input: [
        {
          role: "system",
          content:
            "You are the accessibility copy editor for Curio Garden, an audio-first Wikipedia reader. Rewrite only the supplied deterministic descriptions so they are concise, concrete, neutral, and useful without sight. Preserve every fact exactly. Never add, infer, round, or omit dates, coordinates, measurements, values, labels, relationships, or uncertainty. For charts, call minimum and maximum values the lowest and highest; do not use from-to wording that could imply chronological endpoints. For diagrams, mention a walkthrough, named parts, or relationships only when the extracted facts actually include them; otherwise describe the static source image and its caption. Do not describe colors or visual position unless the source explicitly gives them. Spoken summaries must sound natural when read aloud and must not include URLs. Return one item for every supplied block ID.",
        },
        {
          role: "user",
          content: `Article: ${manifest.title}\nRevision: ${manifest.revisionId}\n\nContext blocks:\n${sourcePayload}`,
        },
      ],
      text: {
        format: zodTextFormat(
          ContextDescriptionSchema,
          "article_context_descriptions",
        ),
      },
    });

    const description = response.output_parsed;
    if (
      !description ||
      !hasExactBlockIds(manifest.blocks, description) ||
      !hasOnlySourceNumbers(description, sourceBlocks)
    ) {
      return manifest;
    }

    const copyById = new Map(
      description.blocks.map((block) => [block.id, block] as const),
    );

    return {
      ...manifest,
      blocks: manifest.blocks.map((block) => {
        const copy = copyById.get(block.id);
        if (!copy) return block;
        return {
          ...block,
          takeaway: copy.takeaway.trim(),
          spokenSummary: copy.spokenSummary.trim(),
          longDescription: copy.longDescription.trim(),
          provenance: {
            ...block.provenance,
            descriptionMethod: "ai-assisted" as const,
            model,
            promptVersion: CONTEXT_DESCRIPTION_PROMPT_VERSION,
          },
        };
      }),
    };
  } catch (error) {
    console.warn(
      "[article-context] AI description enhancement failed; using deterministic copy.",
      error instanceof Error ? error.message : "Unknown error",
    );
    return manifest;
  }
};
