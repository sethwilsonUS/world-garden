import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRENDING_AI_AUDIO_DISCLOSURE } from "../lib/podcast-feed";
import {
  TRENDING_EVALUATION_FIXTURE_DATES,
  type TrendingEvaluationRun,
} from "../lib/trending-brief-evaluation";
import {
  main,
  parseTrendingAudioRenderArgs,
  renderTrendingEvaluationAudio,
} from "./render-trending-brief-eval-audio";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

const createRun = (): TrendingEvaluationRun =>
  ({
    schemaVersion: 1,
    generatedAt: "2026-08-24T00:00:00.000Z",
    fixtureDates: TRENDING_EVALUATION_FIXTURE_DATES,
    profiles: [],
    candidates: TRENDING_EVALUATION_FIXTURE_DATES.map((fixtureDate) => ({
      blindLabel: "C",
      fixtureDate,
      sourceFeedDate: fixtureDate,
      trendingDate: fixtureDate,
      profileId: "luna-deep-research",
      research: "Sourced research.",
      transcript: `A sourced spoken summary for ${fixtureDate}.`,
      brief: {
        headline: "Headline",
        summary: "Summary",
        podcastDescription: "Description",
        spokenSummary: `A sourced spoken summary for ${fixtureDate}.`,
        keyPoints: ["One", "Two", "Three"],
        sources: [{ title: "Source", url: "https://example.com/story" }],
      },
      raw: {},
      stageUsage: {
        research: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        writing: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      },
      metrics: {
        spokenWordCount: 6,
        estimatedDurationSeconds: 2,
        coveredArticleCount: 1,
        sourceCount: 1,
        uniqueSourceDomainCount: 1,
        webSearchCalls: 1,
        totalLatencyMs: 1,
        researchLatencyMs: 1,
        writingLatencyMs: 1,
        repairAttempts: 0,
        estimatedCostMicros: 1,
        costEstimateBasis: "test",
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 },
      },
    })),
  }) as TrendingEvaluationRun;

describe("Trending evaluation audio rendering", () => {
  it("parses the required nonpublishing render arguments", () => {
    expect(
      parseTrendingAudioRenderArgs(
        [
          "--input",
          "report.json",
          "--profile=luna-deep-research",
          "--output",
          "audio",
        ],
        "/workspace",
      ),
    ).toEqual({
      help: false,
      inputPath: "/workspace/report.json",
      outputDirectory: "/workspace/audio",
      profileId: "luna-deep-research",
    });
  });

  it("renders every fixture through Mini/Marin with the audible disclosure", async () => {
    const outputDirectory = await mkdtemp(
      path.join(os.tmpdir(), "trending-eval-audio-"),
    );
    temporaryDirectories.push(outputDirectory);
    const requests: Array<{
      input: string;
      model: string;
      voice: string;
    }> = [];

    const result = await renderTrendingEvaluationAudio({
      inputPath: "/workspace/report.json",
      outputDirectory,
      profileId: "luna-deep-research",
      run: createRun(),
      generatedAt: "2026-08-24T01:00:00.000Z",
      synthesize: async (request) => {
        requests.push(request);
        return new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x64])], {
          type: "audio/mpeg",
        });
      },
    });

    expect(requests).toHaveLength(3);
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          input: expect.stringContaining(TRENDING_AI_AUDIO_DISCLOSURE),
          model: "gpt-4o-mini-tts",
          voice: "marin",
        }),
      ]),
    );
    expect(result.manifest.files).toHaveLength(3);
    expect(
      result.manifest.files.every(
        ({ includesAudibleAiDisclosure }) => includesAudibleAiDisclosure,
      ),
    ).toBe(true);
    await expect(stat(result.manifestPath)).resolves.toMatchObject({
      size: expect.any(Number),
    });
    const storedManifest = JSON.parse(
      await readFile(result.manifestPath, "utf8"),
    );
    expect(storedManifest.tts).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini-tts",
      voice: "marin",
    });
  });

  it("prints help without loading credentials or creating a client", async () => {
    const loadEnv = vi.fn();
    const getClient = vi.fn();
    const writeStdout = vi.fn();

    await main(["--help"], "/workspace", {
      loadEnv,
      getClient,
      writeStdout,
    });

    expect(loadEnv).not.toHaveBeenCalled();
    expect(getClient).not.toHaveBeenCalled();
    expect(writeStdout).toHaveBeenCalledWith(
      expect.stringContaining("nonpublishing Trending evaluation audio"),
    );
  });
});
