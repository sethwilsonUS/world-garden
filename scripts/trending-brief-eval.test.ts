import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadTrendingEvaluationFixtures,
  runTrendingEvaluationMatrix,
  selectTrendingEvaluationProfiles,
} from "../lib/trending-brief-evaluation";
import {
  createProductionTrendingEvaluationGenerator,
  DEFAULT_TRENDING_EVALUATION_OUTPUT_DIRECTORY,
  main,
  parseTrendingEvaluationArgs,
  TRENDING_EVALUATION_HELP_TEXT,
  writeTrendingEvaluationArtifacts,
  writeTrendingEvaluationCheckpoint,
} from "./trending-brief-eval";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("Trending brief evaluation CLI", () => {
  it("parses repeatable profile and fixture filters plus an output directory", () => {
    expect(
      parseTrendingEvaluationArgs(
        [
          "--profile",
          "luna-control",
          "--profile=terra-depth-writing",
          "--fixture",
          "2026-08-24",
          "--fixture=2026-08-14",
          "--output",
          "custom-reports",
        ],
        "/workspace",
      ),
    ).toEqual({
      fixtureDates: ["2026-08-24", "2026-08-14"],
      help: false,
      outputDirectory: "/workspace/custom-reports",
      profileIds: ["luna-control", "terra-depth-writing"],
    });
    expect(DEFAULT_TRENDING_EVALUATION_OUTPUT_DIRECTORY).toBe(
      ".reports/trending-brief-eval",
    );
  });

  it("shows help without loading credentials or running generation", async () => {
    let output = "";
    await main(["--help"], "/workspace", {
      getClient: () => {
        throw new Error("client must not be created for help");
      },
      loadEnv: async () => {
        throw new Error("environment must not load for help");
      },
      writeStdout: (text) => {
        output += text;
      },
    });

    expect(output).toBe(TRENDING_EVALUATION_HELP_TEXT);
  });

  it("runs only selected frozen inputs with cost recording disabled", async () => {
    const previousLedgerMode = process.env.AI_COST_LEDGER_MODE;
    const callOrder: string[] = [];
    let writtenRun: unknown;
    let output = "";

    try {
      await main(
        ["--profile", "terra-depth-writing", "--fixture", "2026-08-14"],
        "/workspace",
        {
          generatedAt: "2026-08-24T13:00:00.000Z",
          loadEnv: async () => {
            callOrder.push("env");
          },
          getClient: () => {
            callOrder.push(`client:${process.env.AI_COST_LEDGER_MODE}`);
            return {} as never;
          },
          createGenerator: () => async (request) => ({
            brief: {
              headline: "Headline",
              summary: "Summary",
              podcastDescription: "Description",
              spokenSummary: `A complete result for ${request.articles[0]?.title}.`,
              keyPoints: ["One", "Two", "Three"],
              sources: [{ title: "News", url: "https://example.com/news" }],
            },
            raw: { model: request.model },
            research: {
              text: "Research",
              sources: [{ title: "News", url: "https://example.com/news" }],
              webSearchCalls: 1,
              latencyMs: 1,
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
            writing: {
              latencyMs: 1,
              repairAttempts: 0,
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
            estimatedCostMicros: 10_000,
            costEstimateBasis: "test-estimate",
          }),
          writeArtifacts: async ({ run }) => {
            writtenRun = run;
            return {
              jsonPath: "/safe/evaluation.json",
              markdownPath: "/safe/evaluation.md",
            };
          },
          writeCheckpoint: async () => "/safe/evaluation.checkpoint.json",
          writeStdout: (text) => {
            output += text;
          },
        },
      );
    } finally {
      if (previousLedgerMode === undefined) {
        delete process.env.AI_COST_LEDGER_MODE;
      } else {
        process.env.AI_COST_LEDGER_MODE = previousLedgerMode;
      }
    }

    expect(callOrder).toEqual(["env", "client:off"]);
    expect(writtenRun).toMatchObject({
      fixtureDates: ["2026-08-14"],
      profiles: [{ id: "terra-depth-writing" }],
      candidates: [
        {
          profileId: "terra-depth-writing",
          sourceFeedDate: "2026-08-13",
          trendingDate: "2026-08-12",
        },
      ],
    });
    expect(output).toContain("1 candidate across 1 fixture");
    expect(output).toContain("/safe/evaluation.json");
    expect(output).toContain("/safe/evaluation.md");
  });

  it("checkpoints each attempted candidate and preserves partial artifacts on failures", async () => {
    const outputDirectory = await mkdtemp(
      path.join(os.tmpdir(), "curio-trending-eval-checkpoint-"),
    );
    temporaryDirectories.push(outputDirectory);
    const checkpoints: Array<{ candidates: number; failures: number }> = [];
    let finalRun: unknown;
    let output = "";

    await expect(
      main(
        [
          "--profile",
          "luna-control",
          "--profile",
          "sol-deep-research",
          "--fixture",
          "2026-08-24",
          "--output",
          outputDirectory,
        ],
        "/workspace",
        {
          generatedAt: "2026-08-24T13:00:00.000Z",
          loadEnv: async () => undefined,
          getClient: () => ({}) as never,
          createGenerator: () => async (request) => {
            if (request.model === "gpt-5.6-luna") {
              throw new Error("temporary upstream failure");
            }
            return {
              brief: {
                headline: "Headline",
                summary: "Summary",
                podcastDescription: "Description",
                spokenSummary: "A complete result.",
                keyPoints: ["One", "Two", "Three"],
                sources: [{ title: "News", url: "https://example.com/news" }],
              },
              raw: { model: request.model },
              research: {
                text: "Research",
                sources: [{ title: "News", url: "https://example.com/news" }],
                webSearchCalls: 1,
                latencyMs: 1,
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              },
              writing: {
                latencyMs: 1,
                repairAttempts: 0,
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              },
              estimatedCostMicros: null,
            };
          },
          writeCheckpoint: async ({ run }) => {
            checkpoints.push({
              candidates: run.candidates.length,
              failures: run.failures?.length ?? 0,
            });
            return path.join(outputDirectory, "checkpoint.json");
          },
          writeArtifacts: async ({ run }) => {
            finalRun = run;
            return {
              jsonPath: path.join(outputDirectory, "partial.json"),
              markdownPath: path.join(outputDirectory, "partial.md"),
            };
          },
          writeStdout: (text) => {
            output += text;
          },
        },
      ),
    ).rejects.toThrow("completed with 1 failed candidate");

    expect(checkpoints).toEqual([
      { candidates: 0, failures: 1 },
      { candidates: 1, failures: 1 },
    ]);
    expect(finalRun).toMatchObject({
      candidates: [{ profileId: "sol-deep-research" }],
      failures: [
        {
          profileId: "luna-control",
          message: "temporary upstream failure",
        },
      ],
    });
    expect(output).toContain("1 candidate with 1 failed candidate");
    expect(output).toContain("partial.json");
  });
});

describe("Trending brief evaluation artifacts", () => {
  it("writes timestamped raw JSON and blinded Markdown without overwriting", async () => {
    const outputDirectory = await mkdtemp(
      path.join(os.tmpdir(), "curio-trending-eval-"),
    );
    temporaryDirectories.push(outputDirectory);
    const [fixture] = await loadTrendingEvaluationFixtures();
    const [profile] = selectTrendingEvaluationProfiles(["luna-control"]);
    if (!fixture || !profile) throw new Error("Expected artifact inputs");
    const run = await runTrendingEvaluationMatrix({
      fixtures: [fixture],
      profiles: [profile],
      generatedAt: "2026-08-24T12:34:56.789Z",
      now: () => 100,
      generate: async () => ({
        brief: {
          headline: "Headline",
          summary: "Summary",
          podcastDescription: "Description",
          spokenSummary: "A complete spoken evaluation transcript.",
          keyPoints: ["One", "Two", "Three"],
          sources: [{ title: "News", url: "https://example.com/news" }],
        },
        raw: {
          researchResponse: { id: "research-1" },
          writingResponse: { id: "writing-1" },
        },
        research: {
          text: "Frozen research notes.",
          sources: [{ title: "News", url: "https://example.com/news" }],
          webSearchCalls: 1,
          latencyMs: 20,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        },
        writing: {
          latencyMs: 30,
          repairAttempts: 0,
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        },
        estimatedCostMicros: 40,
      }),
    });

    const artifacts = await writeTrendingEvaluationArtifacts({
      outputDirectory,
      run,
    });

    expect(path.basename(artifacts.jsonPath)).toBe(
      "trending-brief-evaluation-2026-08-24T12-34-56-789Z.json",
    );
    expect(path.basename(artifacts.markdownPath)).toBe(
      "trending-brief-evaluation-2026-08-24T12-34-56-789Z.md",
    );
    const rawJson = await readFile(artifacts.jsonPath, "utf8");
    const markdown = await readFile(artifacts.markdownPath, "utf8");
    expect(rawJson).toContain('"model": "gpt-5.6-luna"');
    expect(rawJson).toContain('"research": "Frozen research notes."');
    expect(rawJson).toContain('"researchResponse"');
    expect(rawJson).toContain('"stageUsage"');
    expect(markdown).toContain("## Candidate A");
    expect(markdown).toContain("A complete spoken evaluation transcript.");
    expect(markdown).not.toContain("gpt-5.6-luna");
    expect(markdown).not.toContain("luna-control");

    await expect(
      writeTrendingEvaluationArtifacts({ outputDirectory, run }),
    ).rejects.toMatchObject({ code: "EEXIST" });
  });

  it("writes an atomically replaced progress checkpoint", async () => {
    const outputDirectory = await mkdtemp(
      path.join(os.tmpdir(), "curio-trending-eval-checkpoint-file-"),
    );
    temporaryDirectories.push(outputDirectory);
    const [fixture] = await loadTrendingEvaluationFixtures();
    const [profile] = selectTrendingEvaluationProfiles(["luna-control"]);
    if (!fixture || !profile) throw new Error("Expected checkpoint inputs");
    const run = await runTrendingEvaluationMatrix({
      fixtures: [fixture],
      profiles: [profile],
      generatedAt: "2026-08-24T12:34:56.789Z",
      generate: async () => ({
        brief: {
          headline: "Headline",
          summary: "Summary",
          podcastDescription: "Description",
          spokenSummary: "A complete spoken evaluation transcript.",
          keyPoints: ["One", "Two", "Three"],
          sources: [{ title: "News", url: "https://example.com/news" }],
        },
        raw: {},
        research: {
          text: "Research",
          sources: [],
          webSearchCalls: 1,
          latencyMs: 1,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
        writing: {
          latencyMs: 1,
          repairAttempts: 0,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        },
        estimatedCostMicros: null,
      }),
    });

    const checkpointPath = await writeTrendingEvaluationCheckpoint({
      outputDirectory,
      run,
    });

    expect(path.basename(checkpointPath)).toBe(
      "trending-brief-evaluation-2026-08-24T12-34-56-789Z.checkpoint.json",
    );
    await expect(readFile(checkpointPath, "utf8")).resolves.toContain(
      '"candidates"',
    );
  });
});

describe("Trending brief production content adapter", () => {
  it("aggregates generation events without exposing the publication pipeline", async () => {
    const calls: unknown[] = [];
    const brief = {
      headline: "Headline",
      summary: "Summary",
      podcastDescription: "Description",
      spokenSummary: "Spoken summary.",
      keyPoints: ["One", "Two", "Three"],
      sources: [{ title: "News", url: "https://example.com/news" }],
    };
    const generator = createProductionTrendingEvaluationGenerator({
      client: {} as never,
      generateContent: async (request) => {
        calls.push(request);
        request.onEvent?.({
          type: "research",
          profile: "deep-research",
          topicIndex: 0,
          topicTitle: "Topic One",
          researchText: "First research note.",
          sources: brief.sources,
          webSearchCalls: 1,
          latencyMs: 10,
          model: "gpt-5.6-terra-2026-08-01",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          rawResponse: { id: "resp_research_1", status: "completed" },
        });
        request.onEvent?.({
          type: "research",
          profile: "deep-research",
          topicIndex: 1,
          topicTitle: "Topic Two",
          researchText: "Second research note.",
          sources: brief.sources,
          webSearchCalls: 2,
          latencyMs: 20,
          model: "gpt-5.6-terra-2026-08-01",
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        });
        request.onEvent?.({
          type: "writing",
          profile: "deep-research",
          attempt: "initial",
          brief,
          latencyMs: 30,
          model: "gpt-5.6-terra-2026-08-01",
          usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
        });
        request.onEvent?.({
          type: "writing",
          profile: "deep-research",
          attempt: "repair",
          brief,
          latencyMs: 40,
          model: "gpt-5.6-terra-2026-08-01",
          usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
          rawResponse: { id: "resp_writing_repair", status: "completed" },
        });
        return brief;
      },
    });

    const result = await generator({
      articles: [
        { title: "Topic One", extract: "Context one.", views: 1_000 },
        { title: "Topic Two", extract: "Context two.", views: 900 },
      ],
      model: "gpt-5.6-terra",
      promptProfile: "deep-research",
      reasoningEffort: "medium",
      trendingDate: "2026-08-23",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      articles: expect.any(Array),
      model: "gpt-5.6-terra",
      profile: "deep-research",
      trendingDate: "2026-08-23",
      onEvent: expect.any(Function),
    });
    expect(calls[0]).not.toHaveProperty("baseUrl");
    expect(calls[0]).not.toHaveProperty("force");
    expect(result).toMatchObject({
      brief,
      estimatedCostMicros: 30_800,
      costEstimateBasis: expect.stringMatching(
        /requested model gpt-5\.6-terra.*provider echoed gpt-5\.6-terra-2026-08-01.*all input tokens treated as uncached/,
      ),
      research: {
        text: "Topic One\nFirst research note.\n\nTopic Two\nSecond research note.",
        webSearchCalls: 3,
        latencyMs: 30,
        usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
      },
      writing: {
        latencyMs: 70,
        repairAttempts: 1,
        usage: { inputTokens: 70, outputTokens: 35, totalTokens: 105 },
      },
      raw: {
        events: expect.arrayContaining([
          expect.objectContaining({
            type: "research",
            model: "gpt-5.6-terra-2026-08-01",
            rawResponse: {
              id: "resp_research_1",
              status: "completed",
            },
          }),
          expect.objectContaining({
            type: "writing",
            attempt: "repair",
            rawResponse: {
              id: "resp_writing_repair",
              status: "completed",
            },
          }),
        ]),
      },
    });
  });
});
