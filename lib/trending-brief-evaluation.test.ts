import { describe, expect, it } from "vitest";
import {
  loadTrendingEvaluationFixtures,
  renderTrendingEvaluationMarkdown,
  runTrendingEvaluationMatrix,
  runTrendingEvaluationCandidate,
  scoreTrendingEvaluationCandidate,
  selectTrendingEvaluationWinner,
  selectTrendingEvaluationProfiles,
  TRENDING_EVALUATION_HARD_FAIL_RULES,
  TRENDING_EVALUATION_FIXTURE_DATES,
  TRENDING_EVALUATION_PROFILES,
  TRENDING_EVALUATION_SCORING_WEIGHTS,
} from "./trending-brief-evaluation";

describe("Trending brief evaluation profiles", () => {
  it("selects the approved eight profiles in a stable blind order", () => {
    expect(
      selectTrendingEvaluationProfiles().map(
        ({ blindLabel, id, model, promptProfile, reasoningEffort }) => ({
          blindLabel,
          id,
          model,
          promptProfile,
          reasoningEffort,
        }),
      ),
    ).toEqual([
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
    ]);

    expect(TRENDING_EVALUATION_PROFILES).toHaveLength(8);
  });

  it("rejects unknown profile identifiers instead of silently changing the matrix", () => {
    expect(() =>
      selectTrendingEvaluationProfiles(["luna-control", "mystery-profile"]),
    ).toThrow("Unknown Trending evaluation profile: mystery-profile");
  });
});

describe("Trending brief evaluation fixtures", () => {
  it("loads the three frozen ten-topic Wikimedia inputs in date order", async () => {
    const fixtures = await loadTrendingEvaluationFixtures();

    expect(TRENDING_EVALUATION_FIXTURE_DATES).toEqual([
      "2026-08-24",
      "2026-08-18",
      "2026-08-14",
    ]);
    expect(
      fixtures.map(
        ({ fixtureDate, sourceFeedDate, trendingDate, articles }) => ({
          fixtureDate,
          sourceFeedDate,
          trendingDate,
          articleCount: articles.length,
          firstTitle: articles[0]?.title,
        }),
      ),
    ).toEqual([
      {
        fixtureDate: "2026-08-24",
        sourceFeedDate: "2026-08-24",
        trendingDate: "2026-08-23",
        articleCount: 10,
        firstTitle: "Spider-Man: Brand New Day",
      },
      {
        fixtureDate: "2026-08-18",
        sourceFeedDate: "2026-08-18",
        trendingDate: "2026-08-17",
        articleCount: 10,
        firstTitle: "Wladimir Klitschko",
      },
      {
        fixtureDate: "2026-08-14",
        sourceFeedDate: "2026-08-13",
        trendingDate: "2026-08-12",
        articleCount: 10,
        firstTitle: "Joshua Kushner",
      },
    ]);

    expect(fixtures[2]?.articles.map(({ title }) => title)).toEqual([
      "Joshua Kushner",
      "Spider-Man: Brand New Day",
      "Lucy Davis",
      "Solar eclipse of August 12, 2026",
      "Brian Madjo",
      "List of solar eclipses visible from the British Isles",
      "David Crowley (Wisconsin politician)",
      "The Odyssey (2026 film)",
      "Francesca Hong",
      "Deaths in 2026",
    ]);
  });
});

describe("Trending brief evaluation runner", () => {
  it("captures research, transcript, raw responses, usage, latency, and web metrics without publication inputs", async () => {
    const [fixture] = await loadTrendingEvaluationFixtures();
    const [profile] = selectTrendingEvaluationProfiles(["luna-control"]);
    if (!fixture || !profile) throw new Error("Expected evaluation inputs");

    const observedRequests: unknown[] = [];
    const timestamps = [1_000, 1_345];
    const result = await runTrendingEvaluationCandidate({
      fixture,
      profile,
      now: () => timestamps.shift() ?? 1_345,
      generate: async (request) => {
        observedRequests.push(request);
        return {
          brief: {
            headline: "Why these pages are trending",
            summary: "Spider-Man: Brand New Day followed a film release.",
            podcastDescription: "The stories behind today's Wikipedia traffic.",
            spokenSummary:
              "Spider-Man: Brand New Day drew readers after its film release. Kevin Keegan also received renewed attention.",
            keyPoints: ["Film release", "Football coverage", "Uncertainty"],
            sources: [
              { title: "Example report", url: "https://news.example/report" },
            ],
          },
          raw: {
            researchResponse: { id: "research-response" },
            writingResponse: { id: "writing-response" },
          },
          research: {
            text: "Recent reporting connects the film to its release.",
            sources: [
              { title: "Example report", url: "https://news.example/report" },
            ],
            webSearchCalls: 2,
            latencyMs: 200,
            usage: {
              inputTokens: 100,
              outputTokens: 40,
              totalTokens: 140,
            },
          },
          writing: {
            latencyMs: 120,
            repairAttempts: 0,
            usage: {
              inputTokens: 180,
              outputTokens: 80,
              totalTokens: 260,
            },
          },
          estimatedCostMicros: 321,
        };
      },
    });

    expect(observedRequests).toEqual([
      {
        articles: fixture.articles,
        model: "gpt-5.6-luna",
        promptProfile: "control",
        reasoningEffort: "medium",
        trendingDate: "2026-08-23",
      },
    ]);
    expect(observedRequests[0]).not.toHaveProperty("baseUrl");
    expect(observedRequests[0]).not.toHaveProperty("force");
    expect(observedRequests[0]).not.toHaveProperty("regenArt");
    expect(observedRequests[0]).not.toHaveProperty("publish");

    expect(result).toMatchObject({
      blindLabel: "A",
      fixtureDate: "2026-08-24",
      sourceFeedDate: "2026-08-24",
      profileId: "luna-control",
      research: "Recent reporting connects the film to its release.",
      transcript:
        "Spider-Man: Brand New Day drew readers after its film release. Kevin Keegan also received renewed attention.",
      raw: {
        researchResponse: { id: "research-response" },
        writingResponse: { id: "writing-response" },
      },
      metrics: {
        estimatedCostMicros: 321,
        sourceCount: 1,
        uniqueSourceDomainCount: 1,
        totalLatencyMs: 345,
        researchLatencyMs: 200,
        writingLatencyMs: 120,
        webSearchCalls: 2,
        usage: {
          inputTokens: 280,
          outputTokens: 120,
          totalTokens: 400,
        },
      },
    });
    expect(result.metrics.spokenWordCount).toBe(16);
    expect(result.metrics.coveredArticleCount).toBe(2);
  });
});

describe("Trending brief evaluation scoring", () => {
  it("uses the approved weighted rubric and explicit hard-fail rules", () => {
    expect(TRENDING_EVALUATION_SCORING_WEIGHTS).toEqual({
      causalDepth: 30,
      evidenceSupport: 25,
      topicCoverage: 20,
      spokenFlow: 15,
      lengthFit: 10,
    });
    expect(TRENDING_EVALUATION_HARD_FAIL_RULES).toEqual([
      "unsupported-causal-claim",
      "unlabelled-uncertainty",
      "fabricated-source",
      "missing-web-research",
      "invalid-output",
    ]);

    expect(
      scoreTrendingEvaluationCandidate({
        causalDepth: 90,
        evidenceSupport: 80,
        topicCoverage: 70,
        spokenFlow: 60,
        lengthFit: 50,
      }),
    ).toBe(75);
  });

  it("chooses the lower-cost passing candidate within five points of the leader", () => {
    const winner = selectTrendingEvaluationWinner([
      {
        blindLabel: "A",
        profileId: "luna-control",
        weightedScore: 90,
        hardFailures: [],
        estimatedCostMicros: 1_000,
        totalLatencyMs: 500,
      },
      {
        blindLabel: "E",
        profileId: "terra-depth-writing",
        weightedScore: 87,
        hardFailures: [],
        estimatedCostMicros: 300,
        totalLatencyMs: 700,
      },
      {
        blindLabel: "G",
        profileId: "sol-depth-writing",
        weightedScore: 84,
        hardFailures: [],
        estimatedCostMicros: 100,
        totalLatencyMs: 200,
      },
      {
        blindLabel: "H",
        profileId: "sol-deep-research",
        weightedScore: 95,
        hardFailures: ["unsupported-causal-claim"],
        estimatedCostMicros: 50,
        totalLatencyMs: 100,
      },
    ]);

    expect(winner).toEqual({
      highestPassingScore: 90,
      finalistProfileIds: ["luna-control", "terra-depth-writing"],
      selected: expect.objectContaining({
        blindLabel: "E",
        profileId: "terra-depth-writing",
        weightedScore: 87,
      }),
    });
  });

  it("uses latency as the tie-breaker when finalist costs are equal", () => {
    const winner = selectTrendingEvaluationWinner([
      {
        blindLabel: "B",
        profileId: "luna-depth-writing",
        weightedScore: 91,
        hardFailures: [],
        estimatedCostMicros: 400,
        totalLatencyMs: 800,
      },
      {
        blindLabel: "F",
        profileId: "terra-deep-research",
        weightedScore: 88,
        hardFailures: [],
        estimatedCostMicros: 400,
        totalLatencyMs: 600,
      },
    ]);

    expect(winner.selected.profileId).toBe("terra-deep-research");
  });
});

describe("Trending brief evaluation report", () => {
  it("renders stable A-H headings and accessible prose without revealing profiles", async () => {
    const [fixture] = await loadTrendingEvaluationFixtures();
    const [profileA, profileH] = selectTrendingEvaluationProfiles([
      "luna-control",
      "sol-deep-research",
    ]);
    if (!fixture || !profileA || !profileH) {
      throw new Error("Expected report inputs");
    }

    const generate = async () => ({
      brief: {
        headline: "A daily brief",
        summary: "A supported summary.",
        podcastDescription: "A podcast description.",
        spokenSummary: "A clear spoken transcript for this candidate.",
        keyPoints: ["One", "Two", "Three"],
        sources: [{ title: "Example News", url: "https://example.com/report" }],
      },
      raw: { responseId: "raw-response" },
      research: {
        text: "A concise research note.",
        sources: [{ title: "Example News", url: "https://example.com/report" }],
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
    });
    const candidateH = await runTrendingEvaluationCandidate({
      fixture,
      profile: profileH,
      generate,
      now: () => 100,
    });
    const candidateA = await runTrendingEvaluationCandidate({
      fixture,
      profile: profileA,
      generate,
      now: () => 100,
    });

    const markdown = renderTrendingEvaluationMarkdown({
      generatedAt: "2026-08-24T12:00:00.000Z",
      candidates: [candidateH, candidateA],
    });

    expect(markdown).toContain("# Trending Podcast Evaluation");
    expect(markdown).toContain(
      "The target transcript length is 300–420 spoken words",
    );
    expect(markdown).toContain("## Candidate A");
    expect(markdown).toContain("## Candidate H");
    expect(markdown.indexOf("## Candidate A")).toBeLessThan(
      markdown.indexOf("## Candidate H"),
    );
    expect(markdown).toContain("### Fixture date: August 24, 2026");
    expect(markdown).toContain("Source feed date: August 24, 2026");
    expect(markdown).toContain("#### Transcript");
    expect(markdown).toContain("A clear spoken transcript for this candidate.");
    expect(markdown).toContain("#### Research notes");
    expect(markdown).toContain("- Spoken words: 7");
    expect(markdown).toContain("- Estimated duration: 3 seconds");
    expect(markdown).toContain("- Exact-title topic coverage: 0 of 10");
    expect(markdown).toContain("- Sources: 1 across 1 domains");
    expect(markdown).toContain("- [Example News](https://example.com/report)");
    expect(markdown).not.toContain("luna-control");
    expect(markdown).not.toContain("sol-deep-research");
    expect(markdown).not.toContain("gpt-5.6");
    expect(markdown).not.toContain("Web search calls");
    expect(markdown).not.toContain("Total tokens");
    expect(markdown).not.toContain("Total latency");
    expect(markdown).not.toContain("Estimated cost");
    expect(markdown).not.toContain("<table");
  });
});

describe("Trending brief evaluation matrix", () => {
  it("runs selected profiles and fixtures in stable order through only the content seam", async () => {
    const [fixture] = await loadTrendingEvaluationFixtures();
    const profiles = selectTrendingEvaluationProfiles([
      "luna-control",
      "sol-deep-research",
    ]);
    if (!fixture) throw new Error("Expected matrix fixture");
    const requests: Array<{ model: string; promptProfile: string }> = [];

    const run = await runTrendingEvaluationMatrix({
      fixtures: [fixture],
      profiles,
      generatedAt: "2026-08-24T12:00:00.000Z",
      now: () => 100,
      generate: async (request) => {
        requests.push({
          model: request.model,
          promptProfile: request.promptProfile,
        });
        return {
          brief: {
            headline: "Headline",
            summary: "Summary",
            podcastDescription: "Description",
            spokenSummary: "A complete spoken result.",
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
    });

    expect(requests).toEqual([
      { model: "gpt-5.6-luna", promptProfile: "control" },
      { model: "gpt-5.6-sol", promptProfile: "deep-research" },
    ]);
    expect(run).toMatchObject({
      schemaVersion: 1,
      generatedAt: "2026-08-24T12:00:00.000Z",
      fixtureDates: ["2026-08-24"],
      profiles: [
        { blindLabel: "A", id: "luna-control" },
        { blindLabel: "H", id: "sol-deep-research" },
      ],
      candidates: [
        { blindLabel: "A", profileId: "luna-control" },
        { blindLabel: "H", profileId: "sol-deep-research" },
      ],
    });
  });

  it("records a failed candidate and checkpoints every attempted result", async () => {
    const [fixture] = await loadTrendingEvaluationFixtures();
    const profiles = selectTrendingEvaluationProfiles([
      "luna-control",
      "sol-deep-research",
    ]);
    if (!fixture) throw new Error("Expected matrix fixture");
    const checkpoints: Array<{
      candidateCount: number;
      failureCount: number;
    }> = [];

    const run = await runTrendingEvaluationMatrix({
      fixtures: [fixture],
      profiles,
      generatedAt: "2026-08-24T12:00:00.000Z",
      now: () => 100,
      generate: async (request) => {
        if (request.model === "gpt-5.6-luna") {
          throw new Error("transient upstream failure");
        }
        return {
          brief: {
            headline: "Headline",
            summary: "Summary",
            podcastDescription: "Description",
            spokenSummary: "A complete spoken result.",
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
      onProgress: (progress) => {
        checkpoints.push({
          candidateCount: progress.candidates.length,
          failureCount: progress.failures?.length ?? 0,
        });
      },
    });

    expect(checkpoints).toEqual([
      { candidateCount: 0, failureCount: 1 },
      { candidateCount: 1, failureCount: 1 },
    ]);
    expect(run.candidates).toHaveLength(1);
    expect(run.failures).toEqual([
      expect.objectContaining({
        blindLabel: "A",
        fixtureDate: "2026-08-24",
        profileId: "luna-control",
        message: "transient upstream failure",
      }),
    ]);
  });
});
