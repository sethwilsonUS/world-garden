import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import {
  claimTrendingBriefJob,
  finalizeTrendingBriefJob,
  generateUploadUrl,
  getTrendingBriefByDate,
  MAX_TRENDING_BRIEF_JOB_LEASE_MS,
  saveTrendingBrief,
  saveTrendingBriefDraft,
} from "./trending";
import { createPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";
import {
  getTrendingAudioCacheKey,
  getTrendingTtsMetadata,
} from "../lib/trending-audio-profile";
import { getTtsMetadata, getTtsProfile } from "../lib/tts-profile";

const getHandler = (registeredFunction: unknown) =>
  (
    registeredFunction as {
      _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
    }
  )._handler;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Trending publication write attestations", () => {
  it("keeps historical Edge episodes readable", async () => {
    const edge = getTtsMetadata(getTtsProfile("edge"));
    const record = {
      _id: "brief-edge",
      trendingDate: "2026-07-25",
      status: "ready",
      storageId: "edge-storage",
      provider: edge.provider,
      ttsModel: edge.model,
      voiceId: edge.voiceId,
      promptVersion: edge.promptVersion,
      ttsNormVersion: edge.ttsNormVersion,
      ttsCacheKey: `${edge.ttsCacheKey}:trending-script:ai-disclosure-v1`,
    };
    const chain = {
      withIndex: vi.fn(() => chain),
      first: vi.fn(async () => record),
    };

    await expect(
      getHandler(getTrendingBriefByDate)(
        {
          db: { query: vi.fn(() => chain) },
          storage: {
            getUrl: vi.fn(async () => "https://cdn.example/edge.mp3"),
          },
        },
        { trendingDate: record.trendingDate },
      ),
    ).resolves.toMatchObject({
      _id: "brief-edge",
      provider: "edge",
      audioUrl: "https://cdn.example/edge.mp3",
    });
  });

  it("verifies an upload attestation before generating a storage URL", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const validAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "generate-upload-url",
      args: {},
    });
    const wrongOperationAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "claim-job",
      args: {},
    });
    const generateUploadUrlMock = vi.fn(async () => "upload-url");
    const ctx = { storage: { generateUploadUrl: generateUploadUrlMock } };
    const handler = getHandler(generateUploadUrl);

    await expect(
      handler(ctx, { attestation: wrongOperationAttestation }),
    ).rejects.toThrow("A valid server attestation is required");
    expect(generateUploadUrlMock).not.toHaveBeenCalled();

    await expect(handler(ctx, { attestation: validAttestation })).resolves.toBe(
      "upload-url",
    );
    expect(generateUploadUrlMock).toHaveBeenCalledOnce();
  });

  it("binds claim arguments and caps the requested worker lease", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const claimArgs = {
      trendingDate: "2026-07-26",
      owner: "worker-1",
      leaseMs: 24 * 60 * 60 * 1000,
    };
    const validAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "claim-job",
      args: claimArgs,
    });
    const tamperedAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "claim-job",
      args: { ...claimArgs, leaseMs: 1_000 },
    });
    const first = vi.fn(async () => null);
    const query = vi.fn(() => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first,
      };
      return chain;
    });
    const insert = vi.fn(async () => "job-1");
    const ctx = { db: { query, insert, patch: vi.fn() } };
    const handler = getHandler(claimTrendingBriefJob);

    await expect(
      handler(ctx, { ...claimArgs, attestation: tamperedAttestation }),
    ).rejects.toThrow("A valid server attestation is required");
    expect(query).not.toHaveBeenCalled();

    await expect(
      handler(ctx, { ...claimArgs, attestation: validAttestation }),
    ).resolves.toEqual({ claimed: true, attempts: 1 });
    expect(insert).toHaveBeenCalledWith(
      "trendingBriefJobs",
      expect.objectContaining({
        leaseOwner: "worker-1",
        leaseExpiresAt: 1_000 + MAX_TRENDING_BRIEF_JOB_LEASE_MS,
      }),
    );
  });

  it("verifies the exact brief payload before saving publication state", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const saveArgs = {
      trendingDate: "2026-07-26",
      owner: "worker-1",
      status: "pending" as const,
      articleTitles: ["Example Trend"],
      briefPromptVersion: "trending-deep-context-v1",
    };
    const validAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "save-record",
      args: saveArgs,
    });
    const tamperedAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "save-record",
      args: { ...saveArgs, status: "ready" },
    });
    const query = vi.fn((table: string) => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first: vi.fn(async () =>
          table === "trendingBriefJobs"
            ? {
                status: "running",
                leaseOwner: "worker-1",
                leaseExpiresAt: Date.now() + 60_000,
              }
            : null,
        ),
      };
      return chain;
    });
    const insert = vi.fn(async () => "brief-1");
    const ctx = { db: { query, insert, patch: vi.fn() } };
    const handler = getHandler(saveTrendingBrief);

    await expect(
      handler(ctx, { ...saveArgs, attestation: tamperedAttestation }),
    ).rejects.toThrow("A valid server attestation is required");
    expect(query).not.toHaveBeenCalled();

    await expect(
      handler(ctx, { ...saveArgs, attestation: validAttestation }),
    ).resolves.toBe("brief-1");
    const { owner: _owner, ...storedSaveArgs } = saveArgs;
    void _owner;
    expect(insert).toHaveBeenCalledWith(
      "trendingBriefs",
      expect.objectContaining(storedSaveArgs),
    );
  });

  it("patches only a replacement draft under the active publication lease", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const draftBrief = {
      headline: "Replacement headline",
      summary: "Replacement summary",
      podcastDescription: "Replacement description",
      spokenSummary: "Replacement spoken summary",
      keyPoints: ["One", "Two", "Three"],
      sources: [{ title: "News", url: "https://news.example/story" }],
      model: "gpt-5.6-luna",
      briefPromptVersion: "trending-brief-deep-research-v1",
    };
    const draftArgs = {
      trendingDate: "2026-08-24",
      owner: "worker-1",
      draftBrief,
    };
    const validAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "save-record",
      args: draftArgs,
    });
    const tamperedAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "save-record",
      args: {
        ...draftArgs,
        draftBrief: { ...draftBrief, model: "gpt-5.6-sol" },
      },
    });
    const query = vi.fn((table: string) => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first: vi.fn(async () =>
          table === "trendingBriefJobs"
            ? {
                status: "running",
                leaseOwner: "worker-1",
                leaseExpiresAt: 60_000,
              }
            : { _id: "brief-1", status: "ready", storageId: "storage-1" },
        ),
      };
      return chain;
    });
    const patch = vi.fn();
    const handler = getHandler(saveTrendingBriefDraft);

    await expect(
      handler(
        { db: { query, patch } },
        { ...draftArgs, attestation: tamperedAttestation },
      ),
    ).rejects.toThrow("A valid server attestation is required");
    expect(query).not.toHaveBeenCalled();

    const lostLeaseQuery = vi.fn((table: string) => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first: vi.fn(async () =>
          table === "trendingBriefJobs"
            ? {
                status: "running",
                leaseOwner: "another-worker",
                leaseExpiresAt: 60_000,
              }
            : { _id: "brief-1", status: "ready", storageId: "storage-1" },
        ),
      };
      return chain;
    });
    await expect(
      handler(
        { db: { query: lostLeaseQuery, patch } },
        { ...draftArgs, attestation: validAttestation },
      ),
    ).rejects.toThrow("publication lease was lost");
    expect(patch).not.toHaveBeenCalled();

    await expect(
      handler(
        { db: { query, patch } },
        { ...draftArgs, attestation: validAttestation },
      ),
    ).resolves.toBe("brief-1");
    expect(patch).toHaveBeenCalledWith("brief-1", {
      draftBrief,
      updatedAt: 1_000,
    });
  });

  it("accepts exact Trending Mini metadata and rejects Edge for new ready publication", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const mini = {
      ...getTrendingTtsMetadata(),
      ttsCacheKey: getTrendingAudioCacheKey(),
    };
    const saveArgs = {
      trendingDate: "2026-07-26",
      owner: "worker-1",
      status: "ready" as const,
      storageId: "storage-1",
      provider: mini.provider,
      ttsModel: mini.model,
      voiceId: mini.voiceId,
      promptVersion: mini.promptVersion,
      ttsNormVersion: mini.ttsNormVersion,
      ttsCacheKey: mini.ttsCacheKey,
    };
    const handler = getHandler(saveTrendingBrief);
    const insert = vi.fn();
    const patch = vi.fn();

    const staleAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "save-record",
      args: saveArgs,
    });
    const staleQuery = vi.fn(() => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first: vi.fn(async () => ({
          status: "running",
          leaseOwner: "worker-2",
          leaseExpiresAt: Date.now() + 60_000,
        })),
      };
      return chain;
    });
    await expect(
      handler(
        { db: { query: staleQuery, insert, patch } },
        { ...saveArgs, attestation: staleAttestation },
      ),
    ).rejects.toThrow("publication lease was lost");

    const edge = getTtsMetadata(getTtsProfile("edge"));
    const edgeArgs = {
      ...saveArgs,
      provider: edge.provider,
      ttsModel: edge.model,
      voiceId: edge.voiceId,
      promptVersion: edge.promptVersion,
      ttsNormVersion: edge.ttsNormVersion,
      ttsCacheKey: `${edge.ttsCacheKey}:trending-script:ai-disclosure-v1`,
    };
    const edgeAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "save-record",
      args: edgeArgs,
    });
    const matchingQuery = vi.fn((table: string) => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first: vi.fn(async () =>
          table === "trendingBriefJobs"
            ? {
                status: "running",
                leaseOwner: "worker-1",
                leaseExpiresAt: Date.now() + 60_000,
              }
            : null,
        ),
      };
      return chain;
    });

    await expect(
      handler(
        { db: { query: matchingQuery, insert, patch } },
        { ...saveArgs, attestation: staleAttestation },
      ),
    ).resolves.toBeUndefined();
    expect(insert).toHaveBeenCalledOnce();

    insert.mockClear();
    await expect(
      handler(
        { db: { query: matchingQuery, insert, patch } },
        { ...edgeArgs, attestation: edgeAttestation },
      ),
    ).rejects.toThrow("current Trending OpenAI TTS profile");
    expect(insert).not.toHaveBeenCalled();
  });

  it("schedules an external generation cohort after a generated asset is saved", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const mini = {
      ...getTrendingTtsMetadata(),
      ttsCacheKey: getTrendingAudioCacheKey(),
    };
    const saveArgs = {
      trendingDate: "2026-07-26",
      owner: "worker-1",
      status: "ready" as const,
      storageId: "storage-1",
      durationSeconds: 12,
      byteLength: 2_048,
      provider: mini.provider,
      ttsModel: mini.model,
      voiceId: mini.voiceId,
      promptVersion: mini.promptVersion,
      ttsNormVersion: mini.ttsNormVersion,
      ttsCacheKey: getTrendingAudioCacheKey(),
      ledgerAssetKey: "00000000-0000-4000-8000-000000000001",
      ledgerGeneratedAt: 1_700_000_000_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "save-record",
      args: saveArgs,
    });
    const query = vi.fn((table: string) => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first: vi.fn(async () =>
          table === "trendingBriefJobs"
            ? {
                status: "running",
                leaseOwner: "worker-1",
                leaseExpiresAt: Date.now() + 60_000,
              }
            : null,
        ),
      };
      return chain;
    });
    const runAfter = vi.fn().mockResolvedValue("scheduled");

    await expect(
      getHandler(saveTrendingBrief)(
        {
          db: { query, insert: vi.fn(async () => "brief-1"), patch: vi.fn() },
          scheduler: { runAfter },
        },
        { ...saveArgs, attestation },
      ),
    ).resolves.toBe("brief-1");

    expect(runAfter).toHaveBeenCalledOnce();
    expect(getFunctionName(runAfter.mock.calls[0]?.[1])).toBe(
      "aiCostLedger:recordGenerationAssetInternal",
    );
    expect(runAfter.mock.calls[0]?.[2]).toMatchObject({
      eventKey: saveArgs.ledgerAssetKey,
      source: "trending_podcast",
      provider: "openai",
      model: mini.model,
      byteLength: 2_048,
      durationMs: 12_000,
      externalConsumptionUnknown: true,
      generatedAt: saveArgs.ledgerGeneratedAt,
    });
  });

  it("preserves a historical Edge variant and clears the committed replacement draft", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const mini = {
      ...getTrendingTtsMetadata(),
      ttsCacheKey: getTrendingAudioCacheKey(),
    };
    const edge = getTtsMetadata(getTtsProfile("edge"));
    const edgeCacheKey = `${edge.ttsCacheKey}:trending-script:ai-disclosure-v1`;
    const saveArgs = {
      trendingDate: "2026-07-26",
      owner: "worker-1",
      status: "ready" as const,
      storageId: "mini-storage",
      durationSeconds: 120,
      byteLength: 4_096,
      provider: mini.provider,
      ttsModel: mini.model,
      voiceId: mini.voiceId,
      promptVersion: mini.promptVersion,
      ttsNormVersion: mini.ttsNormVersion,
      ttsCacheKey: mini.ttsCacheKey,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "save-record",
      args: saveArgs,
    });
    const query = vi.fn((table: string) => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first: vi.fn(async () =>
          table === "trendingBriefJobs"
            ? {
                status: "running",
                leaseOwner: "worker-1",
                leaseExpiresAt: Date.now() + 60_000,
              }
            : {
                _id: "brief-1",
                draftBrief: {
                  headline: "Replacement headline",
                  summary: "Replacement summary",
                  podcastDescription: "Replacement description",
                  spokenSummary: "Replacement spoken summary",
                  keyPoints: ["One", "Two", "Three"],
                  sources: [],
                  model: "gpt-5.6-luna",
                  briefPromptVersion: "trending-brief-deep-research-v1",
                },
                audioVariants: [
                  {
                    storageId: "edge-storage",
                    ttsCacheKey: edgeCacheKey,
                    provider: edge.provider,
                    model: edge.model,
                    voiceId: edge.voiceId,
                    promptVersion: edge.promptVersion,
                    ttsNormVersion: edge.ttsNormVersion,
                    createdAt: 1_700_000_000_000,
                  },
                ],
              },
        ),
      };
      return chain;
    });
    const patch = vi.fn();

    await expect(
      getHandler(saveTrendingBrief)(
        { db: { query, insert: vi.fn(), patch } },
        { ...saveArgs, attestation },
      ),
    ).resolves.toBe("brief-1");
    expect(patch).toHaveBeenCalledWith(
      "brief-1",
      expect.objectContaining({
        draftBrief: undefined,
        audioVariants: [
          expect.objectContaining({
            storageId: "edge-storage",
            provider: "edge",
            ttsCacheKey: edgeCacheKey,
          }),
          expect.objectContaining({
            storageId: "mini-storage",
            provider: "openai",
            ttsCacheKey: mini.ttsCacheKey,
          }),
        ],
      }),
    );
  });

  it("verifies finalization arguments before releasing the worker lease", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const finalizeArgs = {
      trendingDate: "2026-07-26",
      owner: "worker-1",
      status: "ready" as const,
    };
    const validAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "finalize-job",
      args: finalizeArgs,
    });
    const tamperedAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "finalize-job",
      args: { ...finalizeArgs, owner: "worker-2" },
    });
    const first = vi.fn(async () => ({
      _id: "job-1",
      leaseOwner: "worker-1",
    }));
    const query = vi.fn(() => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first,
      };
      return chain;
    });
    const patch = vi.fn();
    const ctx = { db: { query, patch } };
    const handler = getHandler(finalizeTrendingBriefJob);

    await expect(
      handler(ctx, { ...finalizeArgs, attestation: tamperedAttestation }),
    ).rejects.toThrow("A valid server attestation is required");
    expect(query).not.toHaveBeenCalled();

    await expect(
      handler(ctx, { ...finalizeArgs, attestation: validAttestation }),
    ).resolves.toEqual({ updated: true });
    expect(patch).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        status: "ready",
        leaseOwner: undefined,
        leaseExpiresAt: undefined,
      }),
    );
  });
});
