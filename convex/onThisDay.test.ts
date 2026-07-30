import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";
import { saveOnThisDaySnapshot } from "./onThisDay";

afterEach(() => {
  delete process.env.TTS_QUOTA_BYPASS_SECRET;
  vi.restoreAllMocks();
});

describe("On This Day snapshot publication", () => {
  it("inserts an attested edition without replacing another year", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      feedDate: "2026-07-30",
      monthDay: "07-30",
      data: {
        schemaVersion: 1,
        provider: "wikifeeds-v1",
        categories: { selected: [] },
      },
      generatedAt: 1_779_000_000_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-record",
      args: writeArgs,
    });
    const insert = vi.fn(async () => "snapshot-2026");
    const handler = (
      saveOnThisDaySnapshot as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

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
    ).resolves.toBe("snapshot-2026");
    expect(insert).toHaveBeenCalledWith(
      "onThisDaySnapshots",
      expect.objectContaining(writeArgs),
    );
  });

  it("updates the same feed date idempotently on a cron retry", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      feedDate: "2026-07-30",
      monthDay: "07-30",
      data: {
        schemaVersion: 1,
        provider: "wikifeeds-v1",
        categories: { selected: [{ id: "fresh" }] },
      },
      generatedAt: 1_779_000_000_100,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "on-this-day",
      operation: "save-record",
      args: writeArgs,
    });
    const patch = vi.fn(async () => undefined);
    const insert = vi.fn();
    const handler = (
      saveOnThisDaySnapshot as unknown as {
        _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
      }
    )._handler;

    await expect(
      handler(
        {
          db: {
            query: vi.fn(() => ({
              withIndex: vi.fn(() => ({
                first: vi.fn(async () => ({ _id: "snapshot-2026" })),
              })),
            })),
            patch,
            insert,
          },
        },
        { ...writeArgs, attestation },
      ),
    ).resolves.toBe("snapshot-2026");
    expect(insert).not.toHaveBeenCalled();
    expect(patch).toHaveBeenCalledWith(
      "snapshot-2026",
      expect.objectContaining({
        data: writeArgs.data,
        generatedAt: writeArgs.generatedAt,
      }),
    );
  });
});
