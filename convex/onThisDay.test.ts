import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";
import {
  claimRefreshLease,
  getDaySnapshot,
  getLegacySnapshotForMonthDay,
  insertDaySnapshotIfMissing,
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
  it("inserts a unique living snapshot when leaseToken matches", async () => {
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
      leaseToken: "lease-1",
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-record",
      args: writeArgs,
    });
    const insert = vi.fn(async (table: string) => `${table}-id`);
    const patch = vi.fn(async () => undefined);
    const handler = registeredInvoker(saveDaySnapshot);

    await expect(
      handler(
        {
          db: {
            query: vi.fn((table: string) => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () =>
                  table === "onThisDayRefreshState"
                    ? { _id: "state-1", refreshLeaseToken: "lease-1" }
                    : null,
                ),
              })),
            })),
            insert,
            patch,
          },
        },
        { ...writeArgs, attestation },
      ),
    ).resolves.toEqual({
      applied: true,
      superseded: false,
      id: "onThisDayDays-id",
    });

    expect(insert).toHaveBeenCalledWith(
      "onThisDayDays",
      expect.objectContaining({
        monthDay: "03-05",
        schemaVersion: 2,
        contentHash: "hash-a",
      }),
    );
    expect(patch).toHaveBeenCalledWith(
      "state-1",
      expect.objectContaining({
        degraded: false,
        suspiciousStreak: 0,
        refreshLeaseToken: undefined,
        refreshLeaseUntil: undefined,
      }),
    );
  });

  it("rejects stale saveDaySnapshot, markDayCheckedUnchanged, and recordRefreshFailure from superseded leases", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const patch = vi.fn();
    const insert = vi.fn();
    const dbWithOtherOwner = {
      query: vi.fn((table: string) => ({
        withIndex: vi.fn(() => ({
          first: vi.fn(async () =>
            table === "onThisDayRefreshState"
              ? {
                  _id: "state-1",
                  refreshLeaseToken: "worker-b-token",
                  suspiciousStreak: 1,
                }
              : { _id: "day-1" },
          ),
        })),
      })),
      patch,
      insert,
    };

    const saveArgs = {
      monthDay: "03-05",
      schemaVersion: 2,
      data: { monthDay: "03-05" },
      contentHash: "hash-stale",
      degraded: false,
      checkedAt: 1000,
      changedAt: 1000,
      imagesCheckedAt: 1000,
      lastAttemptAt: 1000,
      leaseToken: "worker-a-stale-token",
    };
    const saveAtt = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-record",
      args: saveArgs,
    });
    await expect(
      registeredInvoker(saveDaySnapshot)(
        { db: dbWithOtherOwner },
        { ...saveArgs, attestation: saveAtt },
      ),
    ).resolves.toEqual({ applied: false, superseded: true });

    const touchArgs = {
      monthDay: "03-05",
      schemaVersion: 2,
      checkedAt: 1000,
      imagesCheckedAt: 1000,
      lastAttemptAt: 1000,
      leaseToken: "worker-a-stale-token",
    };
    const touchAtt = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "finalize-job",
      args: touchArgs,
    });
    await expect(
      registeredInvoker(markDayCheckedUnchanged)(
        { db: dbWithOtherOwner },
        { ...touchArgs, attestation: touchAtt },
      ),
    ).resolves.toEqual({ applied: false, superseded: true });

    const failArgs = {
      monthDay: "03-05",
      lastAttemptAt: 1000,
      lastError: "Late error",
      suspicious: true,
      leaseToken: "worker-a-stale-token",
    };
    const failAtt = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "upsert-job",
      args: failArgs,
    });
    await expect(
      registeredInvoker(recordRefreshFailure)(
        { db: dbWithOtherOwner },
        { ...failArgs, attestation: failAtt },
      ),
    ).resolves.toEqual({
      applied: false,
      superseded: true,
      suspiciousStreak: 1,
    });

    expect(patch).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects degraded saveDaySnapshot when a full snapshot already exists, while allowing degraded save if missing or already degraded", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const handler = registeredInvoker(saveDaySnapshot);
    const writeArgs = {
      monthDay: "11-23",
      schemaVersion: 2,
      data: { monthDay: "11-23", provider: "featured-fallback" },
      contentHash: "degraded-hash",
      degraded: true,
      checkedAt: 5000,
      changedAt: 5000,
      imagesCheckedAt: 0,
      lastAttemptAt: 5000,
      leaseToken: "lease-1",
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-record",
      args: writeArgs,
    });

    // Full snapshot already stored (e.g. concurrent cold insert) -> rejected, releases lease only.
    const patchFull = vi.fn(async () => undefined);
    await expect(
      handler(
        {
          db: {
            query: vi.fn((table: string) => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () =>
                  table === "onThisDayDays"
                    ? {
                        _id: "day-full",
                        data: { provider: "wikipedia-rest-v1" },
                      }
                    : {
                        _id: "state-1",
                        degraded: false,
                        refreshLeaseToken: "lease-1",
                      },
                ),
              })),
            })),
            patch: patchFull,
            insert: vi.fn(),
          },
        },
        { ...writeArgs, attestation },
      ),
    ).resolves.toEqual({ applied: false, superseded: true });
    expect(patchFull).toHaveBeenCalledTimes(1);
    expect(patchFull).toHaveBeenCalledWith(
      "state-1",
      expect.objectContaining({
        refreshLeaseToken: undefined,
        refreshLeaseUntil: undefined,
      }),
    );

    // Already degraded -> allowed to update.
    const patchDegraded = vi.fn(async () => undefined);
    await expect(
      handler(
        {
          db: {
            query: vi.fn((table: string) => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () =>
                  table === "onThisDayDays"
                    ? {
                        _id: "day-degraded",
                        data: { provider: "featured-fallback" },
                      }
                    : {
                        _id: "state-1",
                        degraded: true,
                        refreshLeaseToken: "lease-1",
                      },
                ),
              })),
            })),
            patch: patchDegraded,
            insert: vi.fn(),
          },
        },
        { ...writeArgs, attestation },
      ),
    ).resolves.toEqual({
      applied: true,
      superseded: false,
      id: "day-degraded",
    });
  });

  it("insertDaySnapshotIfMissing inserts only when missing and returns existing data otherwise", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      monthDay: "03-05",
      schemaVersion: 2,
      data: { monthDay: "03-05", provider: "featured-fallback" },
      contentHash: "cold-hash",
      degraded: true,
      checkedAt: 2000,
      changedAt: 2000,
      imagesCheckedAt: 0,
      lastAttemptAt: 2000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-record",
      args: writeArgs,
    });
    const handler = registeredInvoker(insertDaySnapshotIfMissing);

    // Already published -> returns existing without overwriting.
    const insertExisting = vi.fn();
    const patchExisting = vi.fn();
    const resExisting = await handler(
      {
        db: {
          query: vi.fn((table: string) => ({
            withIndex: vi.fn(() => ({
              first: vi.fn(async () =>
                table === "onThisDayDays"
                  ? {
                      monthDay: "03-05",
                      schemaVersion: 2,
                      contentHash: "full-hash",
                      data: { monthDay: "03-05", provider: "wikipedia-rest-v1" },
                    }
                  : {
                      monthDay: "03-05",
                      schemaVersion: 2,
                      degraded: false,
                      checkedAt: 1900,
                      changedAt: 1900,
                      imagesCheckedAt: 1900,
                      suspiciousStreak: 0,
                    },
              ),
            })),
          })),
          insert: insertExisting,
          patch: patchExisting,
        },
      },
      { ...writeArgs, attestation },
    );

    expect(resExisting).toMatchObject({
      inserted: false,
      existing: { contentHash: "full-hash" },
    });
    expect(insertExisting).not.toHaveBeenCalled();
    expect(patchExisting).not.toHaveBeenCalled();

    // Missing -> inserts day and state.
    const insertMissing = vi.fn(async () => "new-id");
    const resMissing = await handler(
      {
        db: {
          query: vi.fn(() => ({
            withIndex: vi.fn(() => ({ first: vi.fn(async () => null) })),
          })),
          insert: insertMissing,
        },
      },
      { ...writeArgs, attestation },
    );
    expect(resMissing).toEqual({ inserted: true });
    expect(insertMissing).toHaveBeenCalledTimes(2);
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
          leaseToken: "lease-1",
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

  it("enforces exclusive lease and atomic retry cooldown in claimRefreshLease", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const handler = registeredInvoker(claimRefreshLease);

    // Inside retry cooldown -> rejected atomically even if lease is expired.
    const cooldownArgs = {
      monthDay: "03-05",
      now: 100_000,
      ttlMs: 120_000,
      leaseToken: "tok-1",
      minRetryIntervalMs: 60_000,
    };
    const cooldownAtt = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "claim-job",
      args: cooldownArgs,
    });
    const patchCooldown = vi.fn();
    await expect(
      handler(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () => ({
                  _id: "state-1",
                  refreshLeaseUntil: 50_000,
                  lastAttemptAt: 70_000,
                })),
              })),
            })),
            patch: patchCooldown,
          },
        },
        { ...cooldownArgs, attestation: cooldownAtt },
      ),
    ).resolves.toBe(false);
    expect(patchCooldown).not.toHaveBeenCalled();

    // Outside cooldown and expired lease -> claims with token.
    const claimArgs = {
      monthDay: "03-05",
      now: 200_000,
      ttlMs: 120_000,
      leaseToken: "tok-2",
      minRetryIntervalMs: 60_000,
    };
    const claimAtt = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "claim-job",
      args: claimArgs,
    });
    const patchClaim = vi.fn(async () => undefined);
    await expect(
      handler(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () => ({
                  _id: "state-1",
                  refreshLeaseUntil: 50_000,
                  lastAttemptAt: 70_000,
                })),
              })),
            })),
            patch: patchClaim,
          },
        },
        { ...claimArgs, attestation: claimAtt },
      ),
    ).resolves.toBe(true);
    expect(patchClaim).toHaveBeenCalledWith(
      "state-1",
      expect.objectContaining({
        refreshLeaseUntil: 320_000,
        refreshLeaseToken: "tok-2",
      }),
    );
  });

  it("reads day snapshot, lists refresh states, and reads legacy fallback rows", async () => {
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

    const legacyHandler = registeredInvoker(getLegacySnapshotForMonthDay);
    const legacy = await legacyHandler(
      {
        db: {
          query: vi.fn(() => ({
            withIndex: vi.fn(() => ({
              order: vi.fn(() => ({
                first: vi.fn(async () => ({
                  feedDate: "2026-03-05",
                  monthDay: "03-05",
                  generatedAt: 500,
                })),
              })),
            })),
          })),
        },
      },
      { monthDay: "03-05" },
    );
    expect(legacy).toMatchObject({ monthDay: "03-05", generatedAt: 500 });
  });
});
