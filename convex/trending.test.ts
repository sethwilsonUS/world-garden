import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimTrendingBriefJob,
  finalizeTrendingBriefJob,
  generateUploadUrl,
  MAX_TRENDING_BRIEF_JOB_LEASE_MS,
  saveTrendingBrief,
} from "./trending";
import { createPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";
import { getTrendingAudioCacheKey } from "../lib/trending-audio-profile";
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

  it("rejects stale owners and non-Edge ready publication metadata before writing", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    const edge = getTtsMetadata(getTtsProfile("edge"));
    const saveArgs = {
      trendingDate: "2026-07-26",
      owner: "worker-1",
      status: "ready" as const,
      storageId: "storage-1",
      provider: edge.provider,
      ttsModel: edge.model,
      voiceId: edge.voiceId,
      promptVersion: edge.promptVersion,
      ttsNormVersion: edge.ttsNormVersion,
      ttsCacheKey: getTrendingAudioCacheKey(),
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

    const spoofedArgs = { ...saveArgs, provider: "openai" };
    const spoofedAttestation = await createPublicAudioWriteAttestation({
      pipeline: "trending",
      operation: "save-record",
      args: spoofedArgs,
    });
    const matchingQuery = vi.fn(() => {
      const chain = {
        withIndex: vi.fn(() => chain),
        first: vi.fn(async () => ({
          status: "running",
          leaseOwner: "worker-1",
          leaseExpiresAt: Date.now() + 60_000,
        })),
      };
      return chain;
    });
    await expect(
      handler(
        { db: { query: matchingQuery, insert, patch } },
        { ...spoofedArgs, attestation: spoofedAttestation },
      ),
    ).rejects.toThrow("current Edge TTS profile");
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
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
