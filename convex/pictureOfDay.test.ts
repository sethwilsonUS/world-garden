import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import {
  MAX_PICTURE_OF_DAY_AUDIO_JOB_LEASE_MS,
  claimPictureOfDayAudioJob,
  finalizePictureOfDayAudioJob,
  generateUploadUrl,
  getPictureOfDayAudio,
  savePictureOfDayAudio,
} from "./pictureOfDay";
import { createPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";
import { getTtsMetadata, getTtsProfile } from "../lib/tts-profile";

const getHandler = (registeredFunction: unknown) =>
  (
    registeredFunction as {
      _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
    }
  )._handler;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Picture of the Day audio publication writes", () => {
  it("keeps the audio lookup public", async () => {
    const record = {
      _id: "picture-audio-1",
      feedDate: "2026-07-26",
      pictureKey: "File:Bunny.jpg",
      scriptVersion: 1,
      status: "ready",
      storageId: "storage-1",
    };
    const first = vi.fn(async () => record);
    const getUrl = vi.fn(async () => "https://cdn.example.com/bunny.mp3");

    await expect(
      getHandler(getPictureOfDayAudio)(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({ first })),
            })),
          },
          storage: { getUrl },
        },
        {
          feedDate: record.feedDate,
          pictureKey: record.pictureKey,
          scriptVersion: record.scriptVersion,
        },
      ),
    ).resolves.toEqual({
      ...record,
      audioUrl: "https://cdn.example.com/bunny.mp3",
    });
    expect(getUrl).toHaveBeenCalledWith("storage-1");
  });

  it("verifies an operation-specific attestation before generating an upload URL", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const validAttestation = await createPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "generate-upload-url",
      args: {},
    });
    const wrongOperationAttestation = await createPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "save-record",
      args: {},
    });
    const generateUploadUrlMock = vi.fn(async () => "upload-url");
    const ctx = { storage: { generateUploadUrl: generateUploadUrlMock } };
    const handler = getHandler(generateUploadUrl);

    await expect(
      handler(ctx, { attestation: wrongOperationAttestation }),
    ).rejects.toThrow("valid server attestation");
    expect(generateUploadUrlMock).not.toHaveBeenCalled();

    await expect(handler(ctx, { attestation: validAttestation })).resolves.toBe(
      "upload-url",
    );
    expect(generateUploadUrlMock).toHaveBeenCalledOnce();
  });

  it("caps even a validly signed caller lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const writeArgs = {
      feedDate: "2026-07-26",
      pictureKey: "File:Bunny.jpg",
      scriptVersion: 1,
      owner: "worker-1",
      leaseMs: 365 * 24 * 60 * 60 * 1000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "claim-job",
      args: writeArgs,
    });
    const insert = vi.fn(async () => "job-1");

    await expect(
      getHandler(claimPictureOfDayAudioJob)(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () => null),
              })),
            })),
            insert,
          },
        },
        { ...writeArgs, attestation },
      ),
    ).resolves.toEqual({ claimed: true, attempts: 1 });

    expect(insert).toHaveBeenCalledWith(
      "pictureOfDayAudioJobs",
      expect.objectContaining({
        leaseExpiresAt: Date.now() + MAX_PICTURE_OF_DAY_AUDIO_JOB_LEASE_MS,
      }),
    );
  });

  it("rejects a save whose signed status was changed, then accepts the exact payload", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const edge = getTtsMetadata(getTtsProfile("edge"));
    const writeArgs = {
      feedDate: "2026-07-26",
      pictureKey: "File:Bunny.jpg",
      scriptVersion: 1,
      owner: "worker-1",
      status: "ready" as const,
      title: "A patient bunny",
      storageId: "storage-1",
      ...edge,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "save-record",
      args: writeArgs,
    });
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        first: vi.fn(async () =>
          table === "pictureOfDayAudioJobs"
            ? {
                status: "running",
                leaseOwner: "worker-1",
                leaseExpiresAt: Date.now() + 60_000,
              }
            : null,
        ),
      })),
    }));
    const insert = vi.fn(async () => "picture-audio-1");
    const handler = getHandler(savePictureOfDayAudio);

    await expect(
      handler(
        { db: { query, insert } },
        { ...writeArgs, status: "failed", attestation },
      ),
    ).rejects.toThrow("valid server attestation");
    expect(query).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();

    await expect(
      handler({ db: { query, insert } }, { ...writeArgs, attestation }),
    ).resolves.toBe("picture-audio-1");
    expect(insert).toHaveBeenCalledOnce();
  });

  it("rejects a correctly signed ready save after its lease is reclaimed", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const writeArgs = {
      feedDate: "2026-07-26",
      pictureKey: "File:Bunny.jpg",
      scriptVersion: 1,
      owner: "stale-worker",
      status: "ready" as const,
      storageId: "storage-1",
      ...getTtsMetadata(getTtsProfile("edge")),
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "save-record",
      args: writeArgs,
    });
    const insert = vi.fn();
    const patch = vi.fn();
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        first: vi.fn(async () => ({
          status: "running",
          leaseOwner: "new-worker",
          leaseExpiresAt: Date.now() + 60_000,
        })),
      })),
    }));

    await expect(
      getHandler(savePictureOfDayAudio)(
        { db: { query, insert, patch } },
        { ...writeArgs, attestation },
      ),
    ).rejects.toThrow("publication lease was lost");
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("schedules an external generation cohort after generated narration is saved", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const edge = getTtsMetadata(getTtsProfile("edge"));
    const writeArgs = {
      feedDate: "2026-07-26",
      pictureKey: "File:Bunny.jpg",
      scriptVersion: 1,
      owner: "worker-1",
      status: "ready" as const,
      storageId: "storage-1",
      durationSeconds: 9,
      byteLength: 1_024,
      ...edge,
      ledgerAssetKey: "00000000-0000-4000-8000-000000000002",
      ledgerGeneratedAt: 1_700_000_000_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "save-record",
      args: writeArgs,
    });
    const query = vi.fn((table: string) => ({
      withIndex: vi.fn(() => ({
        first: vi.fn(async () =>
          table === "pictureOfDayAudioJobs"
            ? {
                status: "running",
                leaseOwner: "worker-1",
                leaseExpiresAt: Date.now() + 60_000,
              }
            : null,
        ),
      })),
    }));
    const runAfter = vi.fn().mockResolvedValue("scheduled");

    await expect(
      getHandler(savePictureOfDayAudio)(
        {
          db: {
            query,
            insert: vi.fn(async () => "picture-audio-1"),
            patch: vi.fn(),
          },
          scheduler: { runAfter },
        },
        { ...writeArgs, attestation },
      ),
    ).resolves.toBe("picture-audio-1");

    expect(runAfter).toHaveBeenCalledOnce();
    expect(getFunctionName(runAfter.mock.calls[0]?.[1])).toBe(
      "aiCostLedger:recordGenerationAssetInternal",
    );
    expect(runAfter.mock.calls[0]?.[2]).toMatchObject({
      eventKey: writeArgs.ledgerAssetKey,
      source: "picture_of_day",
      provider: "edge",
      model: edge.model,
      byteLength: 1_024,
      durationMs: 9_000,
      externalConsumptionUnknown: true,
      generatedAt: writeArgs.ledgerGeneratedAt,
    });
  });

  it("rejects a finalize whose signed owner was changed, then accepts the exact payload", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const writeArgs = {
      feedDate: "2026-07-26",
      pictureKey: "File:Bunny.jpg",
      scriptVersion: 1,
      owner: "worker-1",
      status: "ready" as const,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "picture-of-day",
      operation: "finalize-job",
      args: writeArgs,
    });
    const query = vi.fn(() => ({
      withIndex: vi.fn(() => ({
        first: vi.fn(async () => ({
          _id: "job-1",
          leaseOwner: "worker-1",
        })),
      })),
    }));
    const patch = vi.fn();
    const handler = getHandler(finalizePictureOfDayAudioJob);

    await expect(
      handler(
        { db: { query, patch } },
        { ...writeArgs, owner: "worker-2", attestation },
      ),
    ).rejects.toThrow("valid server attestation");
    expect(query).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();

    await expect(
      handler({ db: { query, patch } }, { ...writeArgs, attestation }),
    ).resolves.toEqual({ updated: true });
    expect(patch).toHaveBeenCalledOnce();
  });
});
