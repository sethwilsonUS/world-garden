import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export type TrendingEvaluationPromptProfile =
  | "control"
  | "depth-writing"
  | "deep-research";

export type TrendingEvaluationBlindLabel =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H";

export type TrendingEvaluationProfile = Readonly<{
  blindLabel: TrendingEvaluationBlindLabel;
  id:
    | "luna-control"
    | "luna-depth-writing"
    | "luna-deep-research"
    | "terra-control"
    | "terra-depth-writing"
    | "terra-deep-research"
    | "sol-depth-writing"
    | "sol-deep-research";
  model: "gpt-5.6-luna" | "gpt-5.6-terra" | "gpt-5.6-sol";
  promptProfile: TrendingEvaluationPromptProfile;
  reasoningEffort: "medium";
}>;

export const TRENDING_EVALUATION_PROFILES = [
  {
    blindLabel: "A",
    id: "luna-control",
    model: "gpt-5.6-luna",
    promptProfile: "control",
    reasoningEffort: "medium",
  },
  {
    blindLabel: "B",
    id: "luna-depth-writing",
    model: "gpt-5.6-luna",
    promptProfile: "depth-writing",
    reasoningEffort: "medium",
  },
  {
    blindLabel: "C",
    id: "luna-deep-research",
    model: "gpt-5.6-luna",
    promptProfile: "deep-research",
    reasoningEffort: "medium",
  },
  {
    blindLabel: "D",
    id: "terra-control",
    model: "gpt-5.6-terra",
    promptProfile: "control",
    reasoningEffort: "medium",
  },
  {
    blindLabel: "E",
    id: "terra-depth-writing",
    model: "gpt-5.6-terra",
    promptProfile: "depth-writing",
    reasoningEffort: "medium",
  },
  {
    blindLabel: "F",
    id: "terra-deep-research",
    model: "gpt-5.6-terra",
    promptProfile: "deep-research",
    reasoningEffort: "medium",
  },
  {
    blindLabel: "G",
    id: "sol-depth-writing",
    model: "gpt-5.6-sol",
    promptProfile: "depth-writing",
    reasoningEffort: "medium",
  },
  {
    blindLabel: "H",
    id: "sol-deep-research",
    model: "gpt-5.6-sol",
    promptProfile: "deep-research",
    reasoningEffort: "medium",
  },
] as const satisfies readonly TrendingEvaluationProfile[];

export type TrendingEvaluationProfileId =
  (typeof TRENDING_EVALUATION_PROFILES)[number]["id"];

export const selectTrendingEvaluationProfiles = (
  requestedIds?: readonly string[],
): readonly TrendingEvaluationProfile[] => {
  if (!requestedIds) return TRENDING_EVALUATION_PROFILES;

  const requested = new Set(requestedIds);
  for (const id of requested) {
    if (!TRENDING_EVALUATION_PROFILES.some((profile) => profile.id === id)) {
      throw new Error(`Unknown Trending evaluation profile: ${id}`);
    }
  }

  return TRENDING_EVALUATION_PROFILES.filter((profile) =>
    requested.has(profile.id),
  );
};

export const TRENDING_EVALUATION_FIXTURE_DATES = [
  "2026-08-24",
  "2026-08-18",
  "2026-08-14",
] as const;

export type TrendingEvaluationFixtureDate =
  (typeof TRENDING_EVALUATION_FIXTURE_DATES)[number];

export type TrendingEvaluationArticle = Readonly<{
  title: string;
  extract: string;
  views: number;
}>;

export type TrendingEvaluationFixture = Readonly<{
  schemaVersion: 1;
  fixtureDate: TrendingEvaluationFixtureDate;
  sourceFeedDate: string;
  trendingDate: string;
  articles: readonly TrendingEvaluationArticle[];
}>;

const TrendingEvaluationFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    fixtureDate: z.enum(TRENDING_EVALUATION_FIXTURE_DATES),
    sourceFeedDate: z.iso.date(),
    trendingDate: z.iso.date(),
    articles: z
      .array(
        z.object({
          title: z.string().trim().min(1),
          extract: z.string().trim().min(1),
          views: z.number().int().positive(),
        }),
      )
      .length(10),
  })
  .superRefine((fixture, context) => {
    const titles = fixture.articles.map(({ title }) => title.toLowerCase());
    if (new Set(titles).size !== titles.length) {
      context.addIssue({
        code: "custom",
        message: "Fixture article titles must be unique",
        path: ["articles"],
      });
    }
  });

const DEFAULT_TRENDING_EVALUATION_FIXTURE_DIRECTORY = fileURLToPath(
  new URL("../scripts/fixtures/trending-brief-evaluation/", import.meta.url),
);

export const loadTrendingEvaluationFixtures = async ({
  fixtureDirectory = DEFAULT_TRENDING_EVALUATION_FIXTURE_DIRECTORY,
}: {
  fixtureDirectory?: string;
} = {}): Promise<readonly TrendingEvaluationFixture[]> =>
  await Promise.all(
    TRENDING_EVALUATION_FIXTURE_DATES.map(async (fixtureDate) => {
      const fixturePath = path.join(fixtureDirectory, `${fixtureDate}.json`);
      const source = await readFile(fixturePath, "utf8");
      const fixture = TrendingEvaluationFixtureSchema.parse(JSON.parse(source));
      if (fixture.fixtureDate !== fixtureDate) {
        throw new Error(
          `Trending evaluation fixture ${fixturePath} declares the wrong date`,
        );
      }
      return fixture;
    }),
  );

export type TrendingEvaluationSource = Readonly<{
  title: string;
  url: string;
}>;

export type TrendingEvaluationBrief = Readonly<{
  headline: string;
  summary: string;
  podcastDescription: string;
  spokenSummary: string;
  keyPoints: readonly string[];
  sources: readonly TrendingEvaluationSource[];
}>;

export type TrendingEvaluationUsage = Readonly<{
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
}>;

export type TrendingEvaluationGeneratorRequest = Readonly<{
  articles: readonly TrendingEvaluationArticle[];
  model: TrendingEvaluationProfile["model"];
  promptProfile: TrendingEvaluationPromptProfile;
  reasoningEffort: "medium";
  trendingDate: string;
}>;

export type TrendingEvaluationGeneratorResult = Readonly<{
  brief: TrendingEvaluationBrief;
  raw: unknown;
  research: Readonly<{
    text: string;
    sources: readonly TrendingEvaluationSource[];
    webSearchCalls: number;
    latencyMs: number;
    usage: TrendingEvaluationUsage;
  }>;
  writing: Readonly<{
    latencyMs: number;
    repairAttempts: number;
    usage: TrendingEvaluationUsage;
  }>;
  estimatedCostMicros: number | null;
  costEstimateBasis?: string | null;
}>;

/**
 * Deliberately excludes URLs, storage identifiers, force flags, and publication
 * callbacks. The evaluator can request content generation but cannot request a
 * podcast sync or mutate a publication record through this seam.
 */
export type TrendingEvaluationContentGenerator = (
  request: TrendingEvaluationGeneratorRequest,
) => Promise<TrendingEvaluationGeneratorResult>;

export type TrendingEvaluationCandidateMetrics = Readonly<{
  spokenWordCount: number;
  estimatedDurationSeconds: number;
  coveredArticleCount: number;
  sourceCount: number;
  uniqueSourceDomainCount: number;
  webSearchCalls: number;
  totalLatencyMs: number;
  researchLatencyMs: number;
  writingLatencyMs: number;
  repairAttempts: number;
  estimatedCostMicros: number | null;
  costEstimateBasis: string | null;
  usage: TrendingEvaluationUsage;
}>;

export type TrendingEvaluationCandidateResult = Readonly<{
  blindLabel: TrendingEvaluationBlindLabel;
  fixtureDate: TrendingEvaluationFixtureDate;
  sourceFeedDate: string;
  trendingDate: string;
  profileId: TrendingEvaluationProfileId;
  research: string;
  transcript: string;
  brief: TrendingEvaluationBrief;
  raw: unknown;
  stageUsage: Readonly<{
    research: TrendingEvaluationUsage;
    writing: TrendingEvaluationUsage;
  }>;
  metrics: TrendingEvaluationCandidateMetrics;
}>;

const countWords = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

const normalizeCoverageText = (text: string): string =>
  text.toLocaleLowerCase("en-US").replace(/\s+/g, " ");

const getUniqueSourceDomainCount = (
  sources: readonly TrendingEvaluationSource[],
): number => {
  const domains = new Set<string>();
  for (const source of sources) {
    try {
      domains.add(new URL(source.url).hostname.toLocaleLowerCase("en-US"));
    } catch (error) {
      void error;
      // Invalid sources remain visible in raw results but do not count as a
      // distinct domain. A scorer can hard-fail the candidate later.
    }
  }
  return domains.size;
};

const addUsage = (
  first: TrendingEvaluationUsage,
  second: TrendingEvaluationUsage,
): TrendingEvaluationUsage => ({
  inputTokens: first.inputTokens + second.inputTokens,
  outputTokens: first.outputTokens + second.outputTokens,
  totalTokens: first.totalTokens + second.totalTokens,
  cachedInputTokens:
    (first.cachedInputTokens ?? 0) + (second.cachedInputTokens ?? 0),
  reasoningTokens: (first.reasoningTokens ?? 0) + (second.reasoningTokens ?? 0),
});

export const runTrendingEvaluationCandidate = async ({
  fixture,
  profile,
  generate,
  now = Date.now,
}: {
  fixture: TrendingEvaluationFixture;
  profile: TrendingEvaluationProfile;
  generate: TrendingEvaluationContentGenerator;
  now?: () => number;
}): Promise<TrendingEvaluationCandidateResult> => {
  const startedAt = now();
  const generated = await generate({
    articles: fixture.articles,
    model: profile.model,
    promptProfile: profile.promptProfile,
    reasoningEffort: profile.reasoningEffort,
    trendingDate: fixture.trendingDate,
  });
  const totalLatencyMs = Math.max(0, now() - startedAt);
  const transcript = generated.brief.spokenSummary.trim();
  const coverageText = normalizeCoverageText(
    `${generated.brief.summary} ${transcript}`,
  );
  const spokenWordCount = countWords(transcript);

  return {
    blindLabel: profile.blindLabel,
    fixtureDate: fixture.fixtureDate,
    sourceFeedDate: fixture.sourceFeedDate,
    trendingDate: fixture.trendingDate,
    profileId: profile.id,
    research: generated.research.text,
    transcript,
    brief: generated.brief,
    raw: generated.raw,
    stageUsage: {
      research: generated.research.usage,
      writing: generated.writing.usage,
    },
    metrics: {
      spokenWordCount,
      estimatedDurationSeconds: Math.round(spokenWordCount / 2.5),
      coveredArticleCount: fixture.articles.filter(({ title }) =>
        coverageText.includes(normalizeCoverageText(title)),
      ).length,
      sourceCount: generated.brief.sources.length,
      uniqueSourceDomainCount: getUniqueSourceDomainCount(
        generated.brief.sources,
      ),
      webSearchCalls: generated.research.webSearchCalls,
      totalLatencyMs,
      researchLatencyMs: generated.research.latencyMs,
      writingLatencyMs: generated.writing.latencyMs,
      repairAttempts: generated.writing.repairAttempts,
      estimatedCostMicros: generated.estimatedCostMicros,
      costEstimateBasis: generated.costEstimateBasis ?? null,
      usage: addUsage(generated.research.usage, generated.writing.usage),
    },
  };
};

export const TRENDING_EVALUATION_SCORING_WEIGHTS = {
  causalDepth: 30,
  evidenceSupport: 25,
  topicCoverage: 20,
  spokenFlow: 15,
  lengthFit: 10,
} as const;

export const TRENDING_EVALUATION_HARD_FAIL_RULES = [
  "unsupported-causal-claim",
  "unlabelled-uncertainty",
  "fabricated-source",
  "missing-web-research",
  "invalid-output",
] as const;

export type TrendingEvaluationHardFailRule =
  (typeof TRENDING_EVALUATION_HARD_FAIL_RULES)[number];

export type TrendingEvaluationDimensionScores = Readonly<
  Record<keyof typeof TRENDING_EVALUATION_SCORING_WEIGHTS, number>
>;

export const scoreTrendingEvaluationCandidate = (
  scores: TrendingEvaluationDimensionScores,
): number => {
  let weightedTotal = 0;
  for (const [dimension, weight] of Object.entries(
    TRENDING_EVALUATION_SCORING_WEIGHTS,
  ) as Array<[keyof typeof TRENDING_EVALUATION_SCORING_WEIGHTS, number]>) {
    const score = scores[dimension];
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw new Error(
        `Trending evaluation score ${dimension} must be between 0 and 100`,
      );
    }
    weightedTotal += score * (weight / 100);
  }
  return Math.round(weightedTotal * 100) / 100;
};

export type TrendingEvaluationProfileScore = Readonly<{
  blindLabel: TrendingEvaluationBlindLabel;
  profileId: TrendingEvaluationProfileId;
  weightedScore: number;
  hardFailures: readonly TrendingEvaluationHardFailRule[];
  estimatedCostMicros: number | null;
  totalLatencyMs: number;
}>;

export type TrendingEvaluationWinner = Readonly<{
  highestPassingScore: number;
  finalistProfileIds: readonly TrendingEvaluationProfileId[];
  selected: TrendingEvaluationProfileScore;
}>;

const compareFinalists = (
  first: TrendingEvaluationProfileScore,
  second: TrendingEvaluationProfileScore,
): number => {
  const firstCost = first.estimatedCostMicros ?? Number.POSITIVE_INFINITY;
  const secondCost = second.estimatedCostMicros ?? Number.POSITIVE_INFINITY;
  if (firstCost !== secondCost) return firstCost - secondCost;
  if (first.totalLatencyMs !== second.totalLatencyMs) {
    return first.totalLatencyMs - second.totalLatencyMs;
  }
  if (first.weightedScore !== second.weightedScore) {
    return second.weightedScore - first.weightedScore;
  }
  return first.blindLabel.localeCompare(second.blindLabel);
};

export const selectTrendingEvaluationWinner = (
  scores: readonly TrendingEvaluationProfileScore[],
): TrendingEvaluationWinner => {
  const passing = scores.filter(({ hardFailures, weightedScore }) => {
    if (
      !Number.isFinite(weightedScore) ||
      weightedScore < 0 ||
      weightedScore > 100
    ) {
      throw new Error(
        "Trending evaluation weighted scores must be between 0 and 100",
      );
    }
    return hardFailures.length === 0;
  });
  if (passing.length === 0) {
    throw new Error("No passing Trending evaluation candidates");
  }

  const highestPassingScore = Math.max(
    ...passing.map(({ weightedScore }) => weightedScore),
  );
  const finalists = passing
    .filter(({ weightedScore }) => highestPassingScore - weightedScore <= 5)
    .sort((first, second) => first.blindLabel.localeCompare(second.blindLabel));
  const selected = [...finalists].sort(compareFinalists)[0];
  if (!selected) throw new Error("No passing Trending evaluation finalists");

  return {
    highestPassingScore,
    finalistProfileIds: finalists.map(({ profileId }) => profileId),
    selected,
  };
};

const formatEvaluationDate = (date: string): string =>
  new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00.000Z`));

const escapeMarkdownLabel = (text: string): string =>
  text.replace(/([\\[\]])/g, "\\$1");

const protectMarkdownHeadingStructure = (text: string): string =>
  text.trim().replace(/^(\s*)(#{1,6})(?=\s)/gm, "$1\\$2");

const renderSource = (source: TrendingEvaluationSource): string => {
  try {
    const url = new URL(source.url);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return `- [${escapeMarkdownLabel(source.title)}](${source.url})`;
    }
  } catch (error) {
    void error;
    // Render invalid values as text so a reviewer can flag the hard failure.
  }
  return `- ${escapeMarkdownLabel(source.title)} — invalid source URL`;
};

export const renderTrendingEvaluationMarkdown = ({
  generatedAt,
  candidates,
}: {
  generatedAt: string;
  candidates: readonly TrendingEvaluationCandidateResult[];
}): string => {
  const candidatesByLabel = new Map<
    TrendingEvaluationBlindLabel,
    TrendingEvaluationCandidateResult[]
  >();
  for (const candidate of candidates) {
    const group = candidatesByLabel.get(candidate.blindLabel) ?? [];
    group.push(candidate);
    candidatesByLabel.set(candidate.blindLabel, group);
  }

  const lines = [
    "# Trending Podcast Evaluation",
    "",
    `Generated: ${generatedAt}`,
    "",
    "Model and prompt identities are intentionally omitted from this listening report. Candidate letters remain stable across every fixture.",
    "",
    "## Scoring rubric",
    "",
    "Score each dimension from 0 to 100. The weighted total uses causal depth (30%), evidence support (25%), topic coverage (20%), spoken flow (15%), and length fit (10%). The target transcript length is 300–420 spoken words; candidates inside that band receive full length-fit credit.",
    "",
    `Hard failures: ${TRENDING_EVALUATION_HARD_FAIL_RULES.join(", ")}.`,
  ];

  for (const profile of TRENDING_EVALUATION_PROFILES) {
    const group = candidatesByLabel.get(profile.blindLabel);
    if (!group || group.length === 0) continue;
    lines.push("", `## Candidate ${profile.blindLabel}`);

    const fixtureOrder = new Map(
      TRENDING_EVALUATION_FIXTURE_DATES.map((date, index) => [date, index]),
    );
    group.sort(
      (first, second) =>
        (fixtureOrder.get(first.fixtureDate) ?? Number.MAX_SAFE_INTEGER) -
        (fixtureOrder.get(second.fixtureDate) ?? Number.MAX_SAFE_INTEGER),
    );

    for (const candidate of group) {
      const { metrics } = candidate;
      lines.push(
        "",
        `### Fixture date: ${formatEvaluationDate(candidate.fixtureDate)}`,
        "",
        `Source feed date: ${formatEvaluationDate(candidate.sourceFeedDate)}`,
        "",
        `Trending data date: ${formatEvaluationDate(candidate.trendingDate)}`,
        "",
        "#### Measurements",
        "",
        `- Spoken words: ${metrics.spokenWordCount}`,
        `- Estimated duration: ${metrics.estimatedDurationSeconds} seconds`,
        `- Exact-title topic coverage: ${metrics.coveredArticleCount} of 10`,
        `- Sources: ${metrics.sourceCount} across ${metrics.uniqueSourceDomainCount} domains`,
        "",
        "#### Transcript",
        "",
        protectMarkdownHeadingStructure(candidate.transcript),
        "",
        "#### Research notes",
        "",
        protectMarkdownHeadingStructure(candidate.research),
        "",
        "#### Sources",
        "",
        ...(candidate.brief.sources.length > 0
          ? candidate.brief.sources.map(renderSource)
          : ["- No sources returned."]),
      );
    }
  }

  return `${lines.join("\n")}\n`;
};

export type TrendingEvaluationRun = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  fixtureDates: readonly TrendingEvaluationFixtureDate[];
  profiles: readonly TrendingEvaluationProfile[];
  candidates: readonly TrendingEvaluationCandidateResult[];
  /** Omitted by reports produced before failure-resilient evaluation runs. */
  failures?: readonly TrendingEvaluationCandidateFailure[];
}>;

export type TrendingEvaluationCandidateFailure = Readonly<{
  blindLabel: TrendingEvaluationBlindLabel;
  fixtureDate: TrendingEvaluationFixtureDate;
  profileId: TrendingEvaluationProfileId;
  message: string;
}>;

const toEvaluationFailureMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const runTrendingEvaluationMatrix = async ({
  fixtures,
  profiles,
  generate,
  generatedAt = new Date().toISOString(),
  now = Date.now,
  onProgress,
}: {
  fixtures: readonly TrendingEvaluationFixture[];
  profiles: readonly TrendingEvaluationProfile[];
  generate: TrendingEvaluationContentGenerator;
  generatedAt?: string;
  now?: () => number;
  onProgress?: (run: TrendingEvaluationRun) => void | Promise<void>;
}): Promise<TrendingEvaluationRun> => {
  const candidates: TrendingEvaluationCandidateResult[] = [];
  const failures: TrendingEvaluationCandidateFailure[] = [];
  const toRun = (): TrendingEvaluationRun => ({
    schemaVersion: 1,
    generatedAt,
    fixtureDates: fixtures.map(({ fixtureDate }) => fixtureDate),
    profiles,
    candidates: [...candidates],
    failures: [...failures],
  });

  for (const profile of profiles) {
    for (const fixture of fixtures) {
      try {
        candidates.push(
          await runTrendingEvaluationCandidate({
            fixture,
            profile,
            generate,
            now,
          }),
        );
      } catch (error) {
        failures.push({
          blindLabel: profile.blindLabel,
          fixtureDate: fixture.fixtureDate,
          profileId: profile.id,
          message: toEvaluationFailureMessage(error),
        });
      }
      await onProgress?.(toRun());
    }
  }

  return toRun();
};
