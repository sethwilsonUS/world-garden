import { afterEach, describe, expect, it, vi } from "vitest";
import { createPublicAudioWriteAttestation } from "../lib/public-audio-write-attestation";
import { getTtsMetadata, getTtsProfile } from "../lib/tts-profile";
import {
  claimFeaturedEpisodeJob,
  finalizeFeaturedEpisodeJob,
  generateUploadUrl,
  MAX_FEATURED_EPISODE_JOB_LEASE_MS,
  saveFeaturedEpisode,
  savePodcastShowAsset,
  upsertFeaturedEpisodeJob,
} from "./podcast";

const getHandler = (registeredFunction: unknown) =>
  (
    registeredFunction as {
      _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
    }
  )._handler;

const edgeMetadata = getTtsMetadata(getTtsProfile("edge"));

const createContext = (
  existing:
    | Record<string, unknown>
    | null
    | Array<Record<string, unknown> | null> = null,
) => {
  const existingRecords = Array.isArray(existing) ? [...existing] : [existing];
  const first = vi.fn(async () => existingRecords.shift() ?? null);
  const insert = vi.fn(async () => "inserted-id");
  const patch = vi.fn(async () => undefined);
  const generateUploadUrl = vi.fn(async () => "upload-url");
  const query = vi.fn(() => ({
    withIndex: vi.fn(() => ({ first })),
  }));

  return {
    ctx: {
      db: { query, insert, patch },
      storage: { generateUploadUrl },
    },
    first,
    generateUploadUrl,
    insert,
    patch,
    query,
  };
};

const writeCases = [
  {
    name: "job claim",
    registeredFunction: claimFeaturedEpisodeJob,
    operation: "claim-job" as const,
    args: {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner: "worker-1",
      leaseMs: 30_000,
    },
    tamperedArgs: {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner: "worker-2",
      leaseMs: 30_000,
    },
    existing: null,
    expected: { claimed: true, attempts: 1 },
  },
  {
    name: "upload URL",
    registeredFunction: generateUploadUrl,
    operation: "generate-upload-url" as const,
    args: {},
    existing: null,
    expected: "upload-url",
  },
  {
    name: "show artwork",
    registeredFunction: savePodcastShowAsset,
    operation: "save-show-asset" as const,
    args: {
      slug: "featured" as const,
      storageId: "storage-1",
      mimeType: "image/png",
      version: 1,
    },
    tamperedArgs: {
      slug: "featured" as const,
      storageId: "storage-1",
      mimeType: "image/png",
      version: 2,
    },
    existing: null,
    expected: "inserted-id",
  },
  {
    name: "episode save",
    registeredFunction: saveFeaturedEpisode,
    operation: "save-record" as const,
    args: {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner: "worker-1",
      wikiPageId: "123",
      slug: "featured-article",
      title: "Featured article",
      narrationHash: "narration-hash",
      storageId: "storage-1",
      ...edgeMetadata,
      status: "ready" as const,
      publishedAt: 1_774_700_800_000,
    },
    tamperedArgs: {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner: "worker-1",
      wikiPageId: "123",
      slug: "featured-article",
      title: "Poisoned title",
      narrationHash: "narration-hash",
      storageId: "storage-1",
      ...edgeMetadata,
      status: "ready" as const,
      publishedAt: 1_774_700_800_000,
    },
    existing: [
      {
        _id: "job-1",
        status: "running",
        leaseOwner: "worker-1",
        leaseExpiresAt: Number.MAX_SAFE_INTEGER,
      },
      null,
    ],
    expected: "inserted-id",
  },
  {
    name: "job upsert",
    registeredFunction: upsertFeaturedEpisodeJob,
    operation: "upsert-job" as const,
    args: {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      status: "pending" as const,
      attempts: 0,
    },
    tamperedArgs: {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      status: "pending" as const,
      attempts: 10_000,
    },
    existing: null,
    expected: "inserted-id",
  },
  {
    name: "job finalization",
    registeredFunction: finalizeFeaturedEpisodeJob,
    operation: "finalize-job" as const,
    args: {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner: "worker-1",
      status: "ready" as const,
    },
    tamperedArgs: {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner: "worker-1",
      status: "failed" as const,
    },
    existing: {
      _id: "job-1",
      status: "running",
      leaseOwner: "worker-1",
      leaseExpiresAt: Number.MAX_SAFE_INTEGER,
    },
    expected: { updated: true },
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("Featured podcast publication writes", () => {
  it.each(writeCases)(
    "accepts a matching attestation for $name",
    async ({ registeredFunction, operation, args, existing, expected }) => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const attestation = await createPublicAudioWriteAttestation({
        pipeline: "featured",
        operation,
        args,
      });
      const { ctx } = createContext(existing);

      await expect(
        getHandler(registeredFunction)(ctx, { ...args, attestation }),
      ).resolves.toEqual(expected);
    },
  );

  it.each(writeCases.filter((entry) => entry.tamperedArgs))(
    "rejects changed arguments for $name before touching storage",
    async ({ registeredFunction, operation, args, tamperedArgs, existing }) => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const attestation = await createPublicAudioWriteAttestation({
        pipeline: "featured",
        operation,
        args,
      });
      const { ctx, generateUploadUrl, insert, patch, query } =
        createContext(existing);

      await expect(
        getHandler(registeredFunction)(ctx, {
          ...tamperedArgs,
          attestation,
        }),
      ).rejects.toThrow("A valid server attestation is required");
      expect(query).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
      expect(generateUploadUrl).not.toHaveBeenCalled();
    },
  );

  it("rejects an upload attestation issued for another operation", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "featured",
      operation: "claim-job",
      args: {},
    });
    const { ctx, generateUploadUrl: generateUploadUrlMock } = createContext();

    await expect(
      getHandler(generateUploadUrl)(ctx, { attestation }),
    ).rejects.toThrow("A valid server attestation is required");
    expect(generateUploadUrlMock).not.toHaveBeenCalled();
  });

  it.each([
    ["provider", "openai"],
    ["model", "gpt-4o-mini-tts"],
    ["voiceId", "alloy"],
    ["promptVersion", "curio-warm-narrator-v1"],
  ] as const)(
    "rejects a signed ready episode with spoofed $field metadata",
    async (field, spoofedValue) => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const args = {
        featuredDate: "2026-07-26",
        articleId: "article-1",
        owner: "worker-1",
        wikiPageId: "123",
        slug: "featured-article",
        title: "Featured article",
        narrationHash: "narration-hash",
        ...edgeMetadata,
        [field]: spoofedValue,
        status: "ready" as const,
        publishedAt: 1_774_700_800_000,
      };
      const attestation = await createPublicAudioWriteAttestation({
        pipeline: "featured",
        operation: "save-record",
        args,
      });
      const { ctx, insert, patch, query } = createContext();

      await expect(
        getHandler(saveFeaturedEpisode)(ctx, { ...args, attestation }),
      ).rejects.toThrow("Public audio must use the current Edge TTS profile");
      expect(query).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it("rejects incomplete Edge metadata for a signed failed row", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const args = {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner: "worker-1",
      wikiPageId: "123",
      slug: "featured-article",
      title: "Featured article",
      narrationHash: "narration-hash",
      ttsNormVersion: edgeMetadata.ttsNormVersion,
      status: "failed" as const,
      publishedAt: 1_774_700_800_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "featured",
      operation: "save-record",
      args,
    });
    const { ctx, insert, patch, query } = createContext();

    await expect(
      getHandler(saveFeaturedEpisode)(ctx, { ...args, attestation }),
    ).rejects.toThrow("Public audio must use the current Edge TTS profile");
    expect(query).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects a signed ready episode without stored audio", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const args = {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner: "worker-1",
      wikiPageId: "123",
      slug: "featured-article",
      title: "Featured article",
      narrationHash: "narration-hash",
      ...edgeMetadata,
      status: "ready" as const,
      publishedAt: 1_774_700_800_000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "featured",
      operation: "save-record",
      args,
    });
    const { ctx, insert, patch, query } = createContext();

    await expect(
      getHandler(saveFeaturedEpisode)(ctx, { ...args, attestation }),
    ).rejects.toThrow("requires stored audio");
    expect(query).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([
    [
      "reclaimed",
      {
        _id: "job-1",
        status: "running",
        leaseOwner: "worker-2",
        leaseExpiresAt: Number.MAX_SAFE_INTEGER,
      },
    ],
    [
      "expired",
      {
        _id: "job-1",
        status: "running",
        leaseOwner: "worker-1",
        leaseExpiresAt: Date.now() - 1,
      },
    ],
    [
      "finished",
      {
        _id: "job-1",
        status: "ready",
        leaseOwner: "worker-1",
        leaseExpiresAt: Number.MAX_SAFE_INTEGER,
      },
    ],
  ] as const)(
    "rejects an exact Edge save from a $label lease before episode writes",
    async (_label, job) => {
      vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
      const args = {
        featuredDate: "2026-07-26",
        articleId: "article-1",
        owner: "worker-1",
        wikiPageId: "123",
        slug: "featured-article",
        title: "Featured article",
        narrationHash: "narration-hash",
        storageId: "storage-1",
        ...edgeMetadata,
        status: "ready" as const,
        publishedAt: 1_774_700_800_000,
      };
      const attestation = await createPublicAudioWriteAttestation({
        pipeline: "featured",
        operation: "save-record",
        args,
      });
      const { ctx, first, insert, patch } = createContext(job);

      await expect(
        getHandler(saveFeaturedEpisode)(ctx, { ...args, attestation }),
      ).rejects.toThrow("Featured podcast publication lease is no longer active");
      expect(first).toHaveBeenCalledOnce();
      expect(insert).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it("does not finalize an expired matching lease", async () => {
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const args = {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner: "worker-1",
      status: "failed" as const,
      lastError: "generation failed",
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "featured",
      operation: "finalize-job",
      args,
    });
    const { ctx, patch } = createContext({
      _id: "job-1",
      status: "running",
      leaseOwner: "worker-1",
      leaseExpiresAt: Date.now() - 1,
    });

    await expect(
      getHandler(finalizeFeaturedEpisodeJob)(ctx, { ...args, attestation }),
    ).resolves.toEqual({ updated: false });
    expect(patch).not.toHaveBeenCalled();
  });

  it("caps even a validly signed caller lease", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00Z"));
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "publication-secret");
    const args = {
      featuredDate: "2026-07-26",
      articleId: "article-1",
      owner: "worker-1",
      leaseMs: 365 * 24 * 60 * 60 * 1000,
    };
    const attestation = await createPublicAudioWriteAttestation({
      pipeline: "featured",
      operation: "claim-job",
      args,
    });
    const { ctx, insert } = createContext();

    await expect(
      getHandler(claimFeaturedEpisodeJob)(ctx, { ...args, attestation }),
    ).resolves.toEqual({ claimed: true, attempts: 1 });
    expect(insert).toHaveBeenCalledWith(
      "featuredPodcastJobs",
      expect.objectContaining({
        leaseExpiresAt: Date.now() + MAX_FEATURED_EPISODE_JOB_LEASE_MS,
      }),
    );
  });
});
