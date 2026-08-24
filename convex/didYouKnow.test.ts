import { afterEach, describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import {
  claimDidYouKnowAudioJob,
  MAX_DID_YOU_KNOW_AUDIO_JOB_LEASE_MS,
  saveDidYouKnowAudio,
} from "./didYouKnow";
import { createPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";
import { getTtsMetadata, getTtsProfile } from "../lib/tts-profile";
import { registeredInvoker } from "./testing/registeredFunctions";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  delete process.env.TTS_QUOTA_BYPASS_SECRET;
});

describe("Did You Know audio publication writes", () => {
  it("rejects a save whose signed status was changed", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const signedArgs = {
      feedDate: "2026-07-26",
      owner: "worker-1",
      status: "ready" as const,
      title: "Did You Know",
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "did-you-know",
      operation: "save-record",
      args: signedArgs,
    });
    const query = vi.fn();
    const handler = registeredInvoker(saveDidYouKnowAudio);

    await expect(
      handler(
        { db: { query } },
        { ...signedArgs, status: "failed", attestation },
      ),
    ).rejects.toThrow("valid server attestation");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a correctly signed save after another worker reclaims the lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const metadata = getTtsMetadata(getTtsProfile("edge"));
    const writeArgs = {
      feedDate: "2026-07-26",
      owner: "stale-worker",
      status: "ready" as const,
      title: "Did You Know",
      storageId: "storage-1" as Id<"_storage">,
      ...metadata,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "did-you-know",
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
    const handler = registeredInvoker(saveDidYouKnowAudio);

    await expect(
      handler(
        { db: { query, insert, patch } },
        { ...writeArgs, attestation },
      ),
    ).rejects.toThrow("publication lease was lost");
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("caps even a validly signed caller lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      feedDate: "2026-07-26",
      owner: "worker-1",
      leaseMs: 365 * 24 * 60 * 60 * 1000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "did-you-know",
      operation: "claim-job",
      args: writeArgs,
    });
    const insert = vi.fn(async () => "job-1");
    const handler = registeredInvoker(claimDidYouKnowAudioJob);

    await expect(
      handler(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({ first: vi.fn(async () => null) })),
            })),
            insert,
          },
        },
        { ...writeArgs, attestation },
      ),
    ).resolves.toEqual({ claimed: true, attempts: 1 });

    expect(insert).toHaveBeenCalledWith(
      "didYouKnowAudioJobs",
      expect.objectContaining({
        leaseExpiresAt: Date.now() + MAX_DID_YOU_KNOW_AUDIO_JOB_LEASE_MS,
      }),
    );
  });
});
