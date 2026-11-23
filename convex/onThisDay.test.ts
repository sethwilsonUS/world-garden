import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";
import {
  claimRefreshLease,
  getDaySnapshot,
  listRefreshStates,
  markDayCheckedUnchanged,
  recordRefreshFailure,
  saveDaySnapshot,
} from "./onThisDay";
import { registeredInvoker } from "./testing/registeredFunctions";

afterEach(() => {
  delete process.env.TTS_QUOTA_BYPASS_SECRET;
  vi.restoreAllMocks();
});

describe("Convex On This Day storage", () => {
  it("inserts a unique living snapshot and refresh state per monthDay", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      monthDay: "03-05",
      schemaVersion: 2,
      data: {
        schemaVersion: 2,
        provider: "wikipedia-rest-v1",
        monthDay: "03-05",
        categories: { selected: [] },
      },
      contentHash: "hash-a",
      degraded: false,
      checkedAt: 1_780_000_000_000,
      changedAt: 1_780_000_000_000,
      imagesCheckedAt: 1_780_000_000_000,
      lastAttemptAt: 1_780_000_000_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-record",
      args: writeArgs,
    });
    const insert = vi.fn(async (table: string) => `${table}-id`);
    const handler = registeredInvoker(saveDaySnapshot);

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
    ).resolves.toBe("onThisDayDays-id");

    expect(insert).toHaveBeenCalledWith(
      "onThisDayDays",
      expect.objectContaining({
        monthDay: "03-05",
        schemaVersion: 2,
        contentHash: "hash-a",
      }),
    );
    expect(insert).toHaveBeenCalledWith(
      "onThisDayRefreshState",
      expect.objectContaining({
        monthDay: "03-05",
        degraded: false,
        suspiciousStreak: 0,
      }),
    );
  });

  it("overwrites the existing Calendar Day row idempotently on refresh", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      monthDay: "03-05",
      schemaVersion: 2,
      data: {
        schemaVersion: 2,
        provider: "wikipedia-rest-v1",
        monthDay: "03-05",
        categories: { selected: [{ id: "fresh" }] },
      },
      contentHash: "hash-b",
      degraded: false,
      checkedAt: 1_780_000_100_000,
      changedAt: 1_780_000_100_000,
      imagesCheckedAt: 1_780_000_000_000,
      lastAttemptAt: 1_780_000_100_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-record",
      args: writeArgs,
    });
    const patch = vi.fn(async () => undefined);
    const insert = vi.fn();
    const handler = registeredInvoker(saveDaySnapshot);

    await expect(
      handler(
        {
          db: {
            query: vi.fn((table: string) => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () => ({ _id: `${table}-existing` })),
              })),
            })),
            patch,
            insert,
          },
        },
        { ...writeArgs, attestation },
      ),
    ).resolves.toBe("onThisDayDays-existing");

    expect(insert).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "onThisDayDays-existing",
      expect.objectContaining({
        contentHash: "hash-b",
        data: writeArgs.data,
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "onThisDayRefreshState-existing",
      expect.objectContaining({
        checkedAt: writeArgs.checkedAt,
        changedAt: writeArgs.changedAt,
        suspiciousStreak: 0,
      }),
    );
  });

  it("rejects unattested writes", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const handler = registeredInvoker(markDayCheckedUnchanged);

    await expect(
      handler(
        { db: {} },
        {
          monthDay: "03-05",
          schemaVersion: 2,
          checkedAt: 1000,
          imagesCheckedAt: 1000,
          lastAttemptAt: 1000,
          attestation: {
            issuedAt: Date.now(),
            expiresAt: Date.now() + 60_000,
            nonce: "bad",
            signature: "invalid",
          },
        },
      ),
    ).rejects.toThrow("valid server attestation");
  });

  it("patches checkedAt without rewriting snapshot data when unchanged", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      monthDay: "03-05",
      schemaVersion: 2,
      checkedAt: 2_000,
      imagesCheckedAt: 1_500,
      lastAttemptAt: 2_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "finalize-job",
      args: writeArgs,
    });
    const patch = vi.fn(async () => undefined);
    const handler = registeredInvoker(markDayCheckedUnchanged);

    await handler(
      {
        db: {
          query: vi.fn(() => ({
            withIndex: vi.fn(() => ({
              first: vi.fn(async () => ({ _id: "state-1" })),
            })),
          })),
          patch,
        },
      },
      { ...writeArgs, attestation },
    );

    expect(patch).toHaveBeenCalledWith(
      "state-1",
      expect.objectContaining({
        checkedAt: 2_000,
        imagesCheckedAt: 1_500,
        suspiciousStreak: 0,
      }),
    );
  });

  it("increments suspiciousStreak on suspicious failures without touching snapshots", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      monthDay: "03-05",
      lastAttemptAt: 3_000,
      lastError: "Suspicious shrink in events",
      suspicious: true,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "upsert-job",
      args: writeArgs,
    });
    const patch = vi.fn(async () => undefined);
    const handler = registeredInvoker(recordRefreshFailure);

    const result = await handler(
      {
        db: {
          query: vi.fn(() => ({
            withIndex: vi.fn(() => ({
              first: vi.fn(async () => ({
                _id: "state-1",
                suspiciousStreak: 2,
              })),
            })),
          })),
          patch,
        },
      },
      { ...writeArgs, attestation },
    );

    expect(result).toEqual({ id: "state-1", suspiciousStreak: 3 });
    expect(patch).toHaveBeenCalledWith(
      "state-1",
      expect.objectContaining({
        lastError: "Suspicious shrink in events",
        suspiciousStreak: 3,
      }),
    );
  });

  it("enforces exclusive lease semantics in claimRefreshLease", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      monthDay: "03-05",
      now: 10_000,
      ttlMs: 120_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "claim-job",
      args: writeArgs,
    });
    const patch = vi.fn(async () => undefined);
    const handler = registeredInvoker(claimRefreshLease);

    // Active lease blocks second caller.
    await expect(
      handler(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () => ({
                  _id: "state-1",
                  refreshLeaseUntil: 20_000,
                })),
              })),
            })),
            patch,
          },
        },
        { ...writeArgs, attestation },
      ),
    ).resolves.toBe(false);
    expect(patch).not.toHaveBeenCalled();

    // Expired lease can be claimed.
    await expect(
      handler(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () => ({
                  _id: "state-1",
                  refreshLeaseUntil: 5_000,
                })),
              })),
            })),
            patch,
          },
        },
        { ...writeArgs, attestation },
      ),
    ).resolves.toBe(true);
    expect(patch).toHaveBeenCalledWith(
      "state-1",
      expect.objectContaining({ refreshLeaseUntil: 130_000 }),
    );
  });

  it("reads day snapshot paired with its refresh state and lists states", async () => {
    const getHandler = registeredInvoker(getDaySnapshot);
    const day = await getHandler(
      {
        db: {
          query: vi.fn((table: string) => ({
            withIndex: vi.fn(() => ({
              first: vi.fn(async () =>
                table === "onThisDayDays"
                  ? {
                      monthDay: "03-05",
                      schemaVersion: 2,
                      contentHash: "h1",
                      data: { monthDay: "03-05" },
                    }
                  : {
                      monthDay: "03-05",
                      schemaVersion: 2,
                      degraded: false,
                      checkedAt: 10,
                      changedAt: 9,
                      imagesCheckedAt: 8,
                      suspiciousStreak: 0,
                    },
              ),
            })),
          })),
        },
      },
      { monthDay: "03-05" },
    );

    expect(day).toMatchObject({
      monthDay: "03-05",
      contentHash: "h1",
      state: { checkedAt: 10, changedAt: 9 },
    });

    const listHandler = registeredInvoker(listRefreshStates);
    const states = await listHandler(
      {
        db: {
          query: vi.fn(() => ({
            withIndex: vi.fn(() => ({
              collect: vi.fn(async () => [
                {
                  monthDay: "03-05",
                  schemaVersion: 2,
                  degraded: false,
                  checkedAt: 10,
                  changedAt: 9,
                  imagesCheckedAt: 8,
                  suspiciousStreak: 0,
                },
              ]),
            })),
          })),
        },
      },
      {},
    );
    expect(states).toHaveLength(1);
    expect(states[0]?.monthDay).toBe("03-05");
  });
});
