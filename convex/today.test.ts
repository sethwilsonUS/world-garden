import { afterEach, describe, expect, it, vi } from "vitest";
import { saveTodaySnapshot } from "./today";
import { createPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";
import { registeredInvoker } from "./testing/registeredFunctions";

afterEach(() => {
  delete process.env.TTS_QUOTA_BYPASS_SECRET;
  vi.restoreAllMocks();
});

describe("today snapshot publication", () => {
  it("accepts an exactly attested server snapshot", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      feedDate: "2026-07-26",
      data: { featured: { title: "The Shire" }, trending: ["Rabbit"] },
      generatedAt: 1_722_000_000_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "today",
      operation: "save-record",
      args: writeArgs,
    });
    const insert = vi.fn(async () => "snapshot-1");
    const handler = registeredInvoker(saveTodaySnapshot);

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
    ).resolves.toBe("snapshot-1");
    expect(insert).toHaveBeenCalledWith(
      "todaySnapshots",
      expect.objectContaining(writeArgs),
    );
  });

  it("rejects a snapshot changed after it was signed", async () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "publication-secret";
    const writeArgs = {
      feedDate: "2026-07-26",
      data: { featured: { title: "The Shire" } },
      generatedAt: 1_722_000_000_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "today",
      operation: "save-record",
      args: writeArgs,
    });
    const query = vi.fn();
    const handler = registeredInvoker(saveTodaySnapshot);

    await expect(
      handler(
        { db: { query } },
        {
          ...writeArgs,
          data: { featured: { title: "Poisoned replacement" } },
          attestation,
        },
      ),
    ).rejects.toThrow("valid server attestation");
    expect(query).not.toHaveBeenCalled();
  });
});
