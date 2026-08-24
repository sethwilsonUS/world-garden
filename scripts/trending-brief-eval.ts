#!/usr/bin/env -S npx tsx

import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AiCostProviderAttempt } from "../lib/ai-cost-ledger-contract";
import {
  AI_COST_PRICING_VERSION,
  estimateDirectAiCost,
} from "../lib/ai-cost-pricing";
import { getOpenAIClient } from "../lib/openai-client";
import {
  loadTrendingEvaluationFixtures,
  renderTrendingEvaluationMarkdown,
  runTrendingEvaluationMatrix,
  selectTrendingEvaluationProfiles,
  TRENDING_EVALUATION_FIXTURE_DATES,
  type TrendingEvaluationContentGenerator,
  type TrendingEvaluationFixtureDate,
  type TrendingEvaluationProfileId,
  type TrendingEvaluationRun,
  type TrendingEvaluationSource,
  type TrendingEvaluationUsage,
} from "../lib/trending-brief-evaluation";
import {
  generateTrendingBriefContent,
  type TrendingBriefGenerationEvent,
} from "../lib/trending-brief";
import { loadLocalEnvFile } from "./ai-cost-report.mjs";

export const DEFAULT_TRENDING_EVALUATION_OUTPUT_DIRECTORY =
  ".reports/trending-brief-eval";

export const TRENDING_EVALUATION_HELP_TEXT = `Trending podcast evaluation (networked and nonpublishing)

Usage:
  npm run eval:trending-podcast
  npm run eval:trending-podcast -- --profile terra-depth-writing
  npm run eval:trending-podcast -- --fixture 2026-08-24

Options:
  --profile <id>    Run one approved profile. Repeat to select several.
  --fixture <date>  Run one frozen fixture. Repeat to select several.
  --output <dir>    Write new JSON and Markdown reports to this directory.
  --help, -h        Show this help.

Defaults to all eight profiles across all three frozen fixtures. Reports are
written beneath .reports/trending-brief-eval/ and never publish podcast data.
`;

export type TrendingEvaluationCliOptions = Readonly<{
  fixtureDates: readonly TrendingEvaluationFixtureDate[];
  help: boolean;
  outputDirectory: string;
  profileIds: readonly TrendingEvaluationProfileId[];
}>;

const parseFlagValue = (
  argv: readonly string[],
  index: number,
): Readonly<{ consumed: number; value: string }> => {
  const argument = argv[index] ?? "";
  const separator = argument.indexOf("=");
  if (separator >= 0) {
    const value = argument.slice(separator + 1).trim();
    if (!value) {
      throw new Error(`${argument.slice(0, separator)} requires a value.`);
    }
    return { consumed: 0, value };
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${argument} requires a value.`);
  }
  return { consumed: 1, value };
};

export const parseTrendingEvaluationArgs = (
  argv: readonly string[],
  cwd = process.cwd(),
): TrendingEvaluationCliOptions => {
  const fixtureDates: string[] = [];
  const profileIds: string[] = [];
  let help = false;
  let outputDirectory = path.resolve(
    cwd,
    DEFAULT_TRENDING_EVALUATION_OUTPUT_DIRECTORY,
  );

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--help" || argument === "-h") {
      help = true;
      continue;
    }
    if (argument === "--profile" || argument.startsWith("--profile=")) {
      const parsed = parseFlagValue(argv, index);
      profileIds.push(parsed.value);
      index += parsed.consumed;
      continue;
    }
    if (argument === "--fixture" || argument.startsWith("--fixture=")) {
      const parsed = parseFlagValue(argv, index);
      fixtureDates.push(parsed.value);
      index += parsed.consumed;
      continue;
    }
    if (argument === "--output" || argument.startsWith("--output=")) {
      const parsed = parseFlagValue(argv, index);
      outputDirectory = path.resolve(cwd, parsed.value);
      index += parsed.consumed;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  const profiles = selectTrendingEvaluationProfiles(
    profileIds.length > 0 ? profileIds : undefined,
  );
  const validFixtureDates = new Set<string>(TRENDING_EVALUATION_FIXTURE_DATES);
  for (const fixtureDate of fixtureDates) {
    if (!validFixtureDates.has(fixtureDate)) {
      throw new Error(`Unknown Trending evaluation fixture: ${fixtureDate}`);
    }
  }

  return {
    fixtureDates:
      fixtureDates.length > 0
        ? (fixtureDates as TrendingEvaluationFixtureDate[])
        : [...TRENDING_EVALUATION_FIXTURE_DATES],
    help,
    outputDirectory,
    profileIds: profiles.map(({ id }) => id),
  };
};

const getArtifactTimestamp = (generatedAt: string): string => {
  const parsed = new Date(generatedAt);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Trending evaluation generatedAt must be an ISO timestamp");
  }
  return parsed.toISOString().replace(/[:.]/g, "-");
};

export const writeTrendingEvaluationArtifacts = async ({
  run,
  outputDirectory = path.resolve(DEFAULT_TRENDING_EVALUATION_OUTPUT_DIRECTORY),
}: {
  run: TrendingEvaluationRun;
  outputDirectory?: string;
}): Promise<Readonly<{ jsonPath: string; markdownPath: string }>> => {
  const basename = `trending-brief-evaluation-${getArtifactTimestamp(
    run.generatedAt,
  )}`;
  const jsonPath = path.join(outputDirectory, `${basename}.json`);
  const markdownPath = path.join(outputDirectory, `${basename}.md`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(jsonPath, `${JSON.stringify(run, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await writeFile(
    markdownPath,
    renderTrendingEvaluationMarkdown({
      generatedAt: run.generatedAt,
      candidates: run.candidates,
    }),
    { encoding: "utf8", flag: "wx" },
  );

  return { jsonPath, markdownPath };
};

export const writeTrendingEvaluationCheckpoint = async ({
  run,
  outputDirectory = path.resolve(DEFAULT_TRENDING_EVALUATION_OUTPUT_DIRECTORY),
}: {
  run: TrendingEvaluationRun;
  outputDirectory?: string;
}): Promise<string> => {
  const checkpointPath = path.join(
    outputDirectory,
    `trending-brief-evaluation-${getArtifactTimestamp(run.generatedAt)}.checkpoint.json`,
  );
  const temporaryPath = `${checkpointPath}.${process.pid}.tmp`;
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(run, null, 2)}\n`, "utf8");
  await rename(temporaryPath, checkpointPath);
  return checkpointPath;
};

type ProductionTrendingGenerator = typeof generateTrendingBriefContent;
type ProductionTrendingClient =
  Parameters<ProductionTrendingGenerator>[0]["client"];

const emptyUsage = (): TrendingEvaluationUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});

const sumEventUsage = (
  events: readonly TrendingBriefGenerationEvent[],
): TrendingEvaluationUsage =>
  events.reduce<TrendingEvaluationUsage>(
    (total, event) => ({
      inputTokens: total.inputTokens + event.usage.inputTokens,
      outputTokens: total.outputTokens + event.usage.outputTokens,
      totalTokens: total.totalTokens + event.usage.totalTokens,
    }),
    emptyUsage(),
  );

const dedupeEventSources = (
  events: readonly Extract<
    TrendingBriefGenerationEvent,
    { type: "research" }
  >[],
): readonly TrendingEvaluationSource[] => {
  const byUrl = new Map<string, TrendingEvaluationSource>();
  for (const event of events) {
    for (const source of event.sources) {
      if (!byUrl.has(source.url)) byUrl.set(source.url, source);
    }
  }
  return [...byUrl.values()];
};

const toPricingAttempt = (
  event: TrendingBriefGenerationEvent,
  index: number,
): AiCostProviderAttempt => ({
  eventKey: `trending-eval-${index}`,
  correlationId: "trending-eval",
  lifecycleVersion: 1,
  operation:
    event.type === "research"
      ? "trending_brief_research"
      : "trending_brief_writing",
  source: "trending_brief",
  requestedProvider: "openai",
  effectiveProvider: "openai",
  model: event.model,
  serviceTier: "auto",
  profile: event.profile,
  state: "succeeded",
  failureCategory: null,
  dispatchedAt: 0,
  completedAt: event.latencyMs,
  inputCharacters: null,
  inputWords: null,
  inputTokens: event.usage.inputTokens,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: event.usage.outputTokens,
  reasoningOutputTokens: null,
  audioInputTokens: null,
  audioOutputTokens: null,
  webSearchCalls: event.type === "research" ? event.webSearchCalls : null,
  responseAudioBytes: null,
  audioDurationMs: null,
  durationMeasurement: "measured",
  isFallbackAttempt: false,
});

const estimateTraceCostMicros = (
  events: readonly TrendingBriefGenerationEvent[],
): number | null => {
  let total = 0;
  for (const [index, event] of events.entries()) {
    const estimate = estimateDirectAiCost(toPricingAttempt(event, index));
    if (estimate.amountMicros == null) return null;
    total += estimate.amountMicros;
  }
  return total;
};

export const createProductionTrendingEvaluationGenerator =
  ({
    client,
    generateContent = generateTrendingBriefContent,
  }: {
    client: ProductionTrendingClient;
    generateContent?: ProductionTrendingGenerator;
  }): TrendingEvaluationContentGenerator =>
  async (request) => {
    const events: TrendingBriefGenerationEvent[] = [];
    const brief = await generateContent({
      client,
      model: request.model,
      trendingDate: request.trendingDate,
      articles: request.articles.map((article) => ({ ...article })),
      profile: request.promptProfile,
      onEvent: (event) => events.push(event),
    });
    const researchEvents = events.filter(
      (
        event,
      ): event is Extract<TrendingBriefGenerationEvent, { type: "research" }> =>
        event.type === "research",
    );
    const writingEvents = events.filter(
      (
        event,
      ): event is Extract<TrendingBriefGenerationEvent, { type: "writing" }> =>
        event.type === "writing",
    );
    if (researchEvents.length === 0 || writingEvents.length === 0) {
      throw new Error(
        "Trending evaluation generation completed without a complete trace",
      );
    }
    const estimatedCostMicros = estimateTraceCostMicros(events);

    return {
      brief,
      raw: { events, brief },
      research: {
        text: researchEvents
          .map((event) =>
            event.topicTitle
              ? `${event.topicTitle}\n${event.researchText}`
              : event.researchText,
          )
          .join("\n\n"),
        sources: dedupeEventSources(researchEvents),
        webSearchCalls: researchEvents.reduce(
          (total, event) => total + event.webSearchCalls,
          0,
        ),
        latencyMs: researchEvents.reduce(
          (total, event) => total + event.latencyMs,
          0,
        ),
        usage: sumEventUsage(researchEvents),
      },
      writing: {
        latencyMs: writingEvents.reduce(
          (total, event) => total + event.latencyMs,
          0,
        ),
        repairAttempts: writingEvents.filter(
          ({ attempt }) => attempt === "repair",
        ).length,
        usage: sumEventUsage(writingEvents),
      },
      estimatedCostMicros,
      costEstimateBasis:
        estimatedCostMicros == null
          ? null
          : `${AI_COST_PRICING_VERSION}; all input tokens treated as uncached`,
    };
  };

type TrendingEvaluationMainDependencies = Readonly<{
  createGenerator?: (
    client: ProductionTrendingClient,
  ) => TrendingEvaluationContentGenerator;
  generatedAt?: string;
  getClient?: () => ProductionTrendingClient;
  loadEnv?: (cwd: string) => Promise<unknown>;
  writeArtifacts?: typeof writeTrendingEvaluationArtifacts;
  writeCheckpoint?: typeof writeTrendingEvaluationCheckpoint;
  writeStdout?: (text: string) => unknown;
}>;

export const main = async (
  args = process.argv.slice(2),
  cwd = process.cwd(),
  {
    createGenerator = (client) =>
      createProductionTrendingEvaluationGenerator({ client }),
    generatedAt = new Date().toISOString(),
    getClient = getOpenAIClient,
    loadEnv = loadLocalEnvFile,
    writeArtifacts = writeTrendingEvaluationArtifacts,
    writeCheckpoint = writeTrendingEvaluationCheckpoint,
    writeStdout = (text) => process.stdout.write(text),
  }: TrendingEvaluationMainDependencies = {},
): Promise<void> => {
  const options = parseTrendingEvaluationArgs(args, cwd);
  if (options.help) {
    writeStdout(TRENDING_EVALUATION_HELP_TEXT);
    return;
  }

  await loadEnv(cwd);
  process.env.AI_COST_LEDGER_MODE = "off";
  const client = getClient();
  const generate = createGenerator(client);
  const requestedFixtureDates = new Set(options.fixtureDates);
  const fixtures = (await loadTrendingEvaluationFixtures()).filter(
    ({ fixtureDate }) => requestedFixtureDates.has(fixtureDate),
  );
  const profiles = selectTrendingEvaluationProfiles(options.profileIds);
  const run = await runTrendingEvaluationMatrix({
    fixtures,
    profiles,
    generate,
    generatedAt,
    onProgress: async (progress) => {
      await writeCheckpoint({
        run: progress,
        outputDirectory: options.outputDirectory,
      });
    },
  });
  const artifacts = await writeArtifacts({
    run,
    outputDirectory: options.outputDirectory,
  });
  const checkpointPath = path.join(
    options.outputDirectory,
    `trending-brief-evaluation-${getArtifactTimestamp(run.generatedAt)}.checkpoint.json`,
  );
  await rm(checkpointPath, { force: true });
  const failures = run.failures ?? [];
  writeStdout(
    `Generated ${run.candidates.length} ${
      run.candidates.length === 1 ? "candidate" : "candidates"
    }${
      failures.length === 0
        ? ""
        : ` with ${failures.length} failed ${
            failures.length === 1 ? "candidate" : "candidates"
          }`
    } across ${fixtures.length} ${
      fixtures.length === 1 ? "fixture" : "fixtures"
    }.\nRaw JSON: ${artifacts.jsonPath}\nBlinded Markdown: ${
      artifacts.markdownPath
    }\n`,
  );
  if (failures.length > 0) {
    throw new Error(
      `Trending evaluation completed with ${failures.length} failed ${
        failures.length === 1 ? "candidate" : "candidates"
      }; completed results were written to ${artifacts.jsonPath}`,
    );
  }
};

const isMain =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[trending-brief-eval] ${message}`);
    process.exitCode = 1;
  });
}
