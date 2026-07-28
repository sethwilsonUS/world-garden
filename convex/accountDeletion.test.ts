import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import {
  ACCOUNT_DELETION_CLEANUP_ATTENTION_THRESHOLD,
  ACCOUNT_DELETION_PURGE_SWEEP_RETRY_MS,
  ACCOUNT_DELETION_TOMBSTONE_GRACE_MS,
  initiateAccountDeletionForCtx,
  listPendingClerkDeletions,
  listPendingClerkDeletionsForCtx,
  markClerkDeletionForCtx,
  markClerkDeletion,
  purgeAccountDeletionRequestForCtx,
  reconcileClerkDeletionForCtx,
  runAccountDeletionCleanupBatch,
  runAccountDeletionCleanupBatchForCtx,
} from "./accountDeletion";
import {
  ACCOUNT_OWNED_AUDIO_MAX_LATE_ACTION_MS,
  ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
} from "../lib/account-owned-audio-storage";
import {
  createListPendingClerkDeletionsAttestation,
  createMarkClerkDeletionAttestation,
} from "../lib/account-deletion-attestation";
import {
  getArticleAudioExportQuotaKey,
  getPersonalPlaylistOpenAiQuotaKey,
} from "./lib/accountQuotaKeys";

type TestDoc = Record<string, unknown> & { _id: string };

const createCtx = ({
  identity = {
    subject: "user_1",
    tokenIdentifier: "https://clerk.example|user_1",
  },
  tables = {},
}: {
  identity?: { subject: string; tokenIdentifier: string } | null;
  tables?: Record<string, TestDoc[]>;
} = {}) => {
  const stored = new Map(
    Object.entries(tables).map(([tableName, docs]) => [
      tableName,
      docs.map((doc) => ({ ...doc })),
    ]),
  );
  const scheduled: Array<{
    delay: number;
    functionReference: unknown;
    args: Record<string, unknown>;
  }> = [];
  const deletedStorage: string[] = [];
  let nextId = 1;

  const getTable = (tableName: string): TestDoc[] => {
    const existing = stored.get(tableName);
    if (existing) return existing;
    const created: TestDoc[] = [];
    stored.set(tableName, created);
    return created;
  };

  const query = (tableName: string) => {
    const filters: Array<[string, unknown]> = [];
    const filterBuilder = {
      eq: (field: string, value: unknown) => {
        filters.push([field, value]);
        return filterBuilder;
      },
    };
    const filterExpressionBuilder = {
      field: (field: string) => ({ field }),
      eq: (left: { field: string }, value: unknown) => {
        filters.push([left.field, value]);
        return true;
      },
    };
    let direction: "asc" | "desc" = "asc";
    const matches = () =>
      getTable(tableName)
        .filter((doc) =>
          filters.every(([field, value]) => doc[field] === value),
        )
        .sort((left, right) => {
          const difference =
            Number(left.updatedAt ?? 0) - Number(right.updatedAt ?? 0);
          return direction === "asc" ? difference : -difference;
        });
    const chain = {
      withIndex: (
        _indexName: string,
        apply: (builder: typeof filterBuilder) => unknown,
      ) => {
        apply(filterBuilder);
        return chain;
      },
      filter: (apply: (builder: typeof filterExpressionBuilder) => unknown) => {
        apply(filterExpressionBuilder);
        return chain;
      },
      order: (nextDirection: "asc" | "desc") => {
        direction = nextDirection;
        return chain;
      },
      first: async () => matches()[0] ?? null,
      collect: async () => matches(),
      take: async (limit: number) => matches().slice(0, limit),
    };
    return chain;
  };

  const ctx = {
    auth: {
      getUserIdentity: vi.fn().mockResolvedValue(identity),
    },
    db: {
      query,
      get: vi.fn(async (id: string) => {
        for (const docs of stored.values()) {
          const match = docs.find((doc) => doc._id === id);
          if (match) return match;
        }
        return null;
      }),
      insert: vi.fn(
        async (tableName: string, value: Record<string, unknown>) => {
          const id = `${tableName}-${nextId++}`;
          getTable(tableName).push({ _id: id, ...value });
          return id;
        },
      ),
      patch: vi.fn(async (id: string, value: Record<string, unknown>) => {
        for (const [tableName, docs] of stored.entries()) {
          const index = docs.findIndex((doc) => doc._id === id);
          if (index >= 0) {
            docs[index] = { ...docs[index], ...value };
            stored.set(tableName, docs);
            return;
          }
        }
      }),
      delete: vi.fn(async (id: string) => {
        for (const [tableName, docs] of stored.entries()) {
          stored.set(
            tableName,
            docs.filter((doc) => doc._id !== id),
          );
        }
      }),
    },
    storage: {
      delete: vi.fn(async (storageId: string) => {
        deletedStorage.push(storageId);
      }),
    },
    scheduler: {
      runAfter: vi.fn(
        async (
          delay: number,
          functionReference: unknown,
          args: Record<string, unknown>,
        ) => {
          scheduled.push({ delay, functionReference, args });
        },
      ),
    },
  };

  return {
    ctx,
    getTable,
    scheduled,
    deletedStorage,
  };
};

const deletionRequest = (overrides: Record<string, unknown> = {}): TestDoc => ({
  _id: "accountDeletionRequests-1",
  viewerTokenIdentifier: "https://clerk.example|user_1",
  clerkUserId: "user_1",
  status: "cleaning",
  phase: "revoke_feeds",
  cleanupAttemptCount: 0,
  clerkDeletionAttemptCount: 0,
  createdAt: 100,
  updatedAt: 100,
  ...overrides,
});

const invokeRegistered = async <TArgs, TResult>(
  registeredFunction: unknown,
  ctx: unknown,
  args: TArgs,
): Promise<TResult> =>
  await (
    registeredFunction as {
      _handler: (handlerCtx: unknown, handlerArgs: TArgs) => Promise<TResult>;
    }
  )._handler(ctx, args);

describe("account deletion lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("authenticates, tombstones, schedules, and idempotently resumes initiation", async () => {
    const { ctx, getTable, scheduled } = createCtx();

    await expect(
      initiateAccountDeletionForCtx(
        ctx as never,
        { clerkUserId: "user_1" },
        1_000,
      ),
    ).resolves.toEqual({
      requestId: "accountDeletionRequests-1",
      status: "cleaning",
      created: true,
    });
    expect(getTable("accountDeletionRequests")).toEqual([
      expect.objectContaining({
        viewerTokenIdentifier: "https://clerk.example|user_1",
        clerkUserId: "user_1",
        status: "cleaning",
        phase: "revoke_feeds",
      }),
    ]);
    expect(scheduled).toHaveLength(1);
    expect(
      getFunctionName(
        scheduled[0]?.functionReference as FunctionReference<
          "mutation",
          "internal"
        >,
      ),
    ).toBe("accountDeletion:runAccountDeletionCleanupBatch");

    await expect(
      initiateAccountDeletionForCtx(
        ctx as never,
        { clerkUserId: "user_1" },
        2_000,
      ),
    ).resolves.toEqual({
      requestId: "accountDeletionRequests-1",
      status: "cleaning",
      created: false,
    });
    expect(getTable("accountDeletionRequests")).toHaveLength(1);
    expect(scheduled).toHaveLength(2);
  });

  it("rejects a Clerk id that does not match the authenticated subject", async () => {
    const { ctx } = createCtx();
    await expect(
      initiateAccountDeletionForCtx(
        ctx as never,
        { clerkUserId: "user_2" },
        1_000,
      ),
    ).rejects.toThrow("Unauthorized");
  });

  it("rejects a Clerk user already linked to another viewer deletion request", async () => {
    const { ctx } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({
            viewerTokenIdentifier: "https://clerk.example|different-viewer",
          }),
        ],
      },
    });

    await expect(
      initiateAccountDeletionForCtx(
        ctx as never,
        { clerkUserId: "user_1" },
        1_000,
      ),
    ).rejects.toThrow("Account deletion identity conflict");
  });

  it("revokes active feed tokens before advancing the cleanup phase", async () => {
    const activeFeed = {
      _id: "feed-1",
      viewerTokenIdentifier: "https://clerk.example|user_1",
      feedToken: "live-secret-token",
      createdAt: 100,
      updatedAt: 100,
    };
    const alreadyRevoked = {
      ...activeFeed,
      _id: "feed-2",
      feedToken: "old-tombstone",
      revokedAt: 200,
      updatedAt: 200,
    };
    const { ctx, getTable, scheduled } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({
            cleanupAttemptCount: 3,
            needsAttentionAt: 500,
            lastError: "previous transient failure",
          }),
        ],
        personalPodcastFeeds: [activeFeed, alreadyRevoked],
      },
    });

    await runAccountDeletionCleanupBatchForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      1_000,
    );

    expect(getTable("personalPodcastFeeds")).toEqual([
      expect.objectContaining({
        _id: "feed-1",
        revokedAt: 1_000,
        updatedAt: 1_000,
      }),
      alreadyRevoked,
    ]);
    expect(getTable("personalPodcastFeeds")[0]?.feedToken).not.toBe(
      "live-secret-token",
    );
    expect(getTable("accountDeletionRequests")[0]).toEqual(
      expect.objectContaining({
        phase: "playlist_episodes",
        cleanupAttemptCount: 0,
        lastCleanupAttemptAt: 1_000,
        needsAttentionAt: undefined,
        lastError: undefined,
      }),
    );
    expect(scheduled).toHaveLength(1);
  });

  it("removes playlist records, every referenced blob, and their ledgers", async () => {
    const viewerTokenIdentifier = "https://clerk.example|user_1";
    const { ctx, getTable, deletedStorage } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({ phase: "playlist_episodes" }),
        ],
        personalPlaylistEpisodes: [
          {
            _id: "episode-1",
            viewerTokenIdentifier,
            storageId: "storage-main",
            audioVariants: [
              { storageId: "storage-variant" },
              { storageId: "storage-main" },
            ],
          },
          {
            _id: "episode-other",
            viewerTokenIdentifier: "https://clerk.example|user_2",
            storageId: "storage-other",
          },
        ],
        accountOwnedStorage: [
          {
            _id: "ledger-main",
            viewerTokenIdentifier,
            storageId: "storage-main",
          },
          {
            _id: "ledger-variant",
            viewerTokenIdentifier,
            storageId: "storage-variant",
          },
        ],
      },
    });

    await runAccountDeletionCleanupBatchForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      1_000,
    );

    expect(new Set(deletedStorage)).toEqual(
      new Set(["storage-main", "storage-variant"]),
    );
    expect(getTable("personalPlaylistEpisodes")).toEqual([
      expect.objectContaining({ _id: "episode-other" }),
    ]);
    expect(getTable("accountOwnedStorage")).toEqual([]);
    expect(getTable("accountDeletionRequests")[0]?.phase).toBe(
      "article_audio_exports",
    );
  });

  it("hands off to Clerk, performs a post-Clerk sweep, and purges after grace", async () => {
    const { ctx, getTable, scheduled } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({ phase: "feeds", cleanupAttemptCount: 8 }),
        ],
      },
    });

    await runAccountDeletionCleanupBatchForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      1_000,
    );
    expect(getTable("accountDeletionRequests")[0]).toEqual(
      expect.objectContaining({
        status: "pending_clerk",
        phase: "pending_clerk",
        cleanupCompletedAt: 1_000,
      }),
    );

    await markClerkDeletionForCtx(
      ctx as never,
      {
        requestId: "accountDeletionRequests-1" as Id<"accountDeletionRequests">,
        clerkUserId: "user_1",
        outcome: "deleted",
      },
      2_000,
    );
    expect(getTable("accountDeletionRequests")[0]).toEqual(
      expect.objectContaining({
        status: "clerk_deleted",
        phase: "revoke_feeds",
        clerkDeletedAt: 2_000,
      }),
    );

    await ctx.db.patch("accountDeletionRequests-1", {
      phase: "feeds",
    });
    await runAccountDeletionCleanupBatchForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      3_000,
    );
    expect(getTable("accountDeletionRequests")[0]).toEqual(
      expect.objectContaining({
        status: "clerk_deleted",
        phase: "grace_period",
        purgeAfter: 3_000 + ACCOUNT_DELETION_TOMBSTONE_GRACE_MS,
      }),
    );
    await ctx.db.insert("accountOwnedStorageSweepState", {
      key: ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
      scannedThrough: 1_000 + ACCOUNT_OWNED_AUDIO_MAX_LATE_ACTION_MS,
      createdAt: 3_000,
      updatedAt: 3_000,
    });

    await purgeAccountDeletionRequestForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      3_000 + ACCOUNT_DELETION_TOMBSTONE_GRACE_MS,
    );
    expect(getTable("accountDeletionRequests")).toEqual([]);
    expect(scheduled.length).toBeGreaterThanOrEqual(2);
  });

  it("reopens cleanup instead of purging when account data reappears", async () => {
    const purgeAfter = 5_000;
    const { ctx, getTable, scheduled } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({
            status: "clerk_deleted",
            phase: "grace_period",
            clerkDeletedAt: 2_000,
            purgeAfter,
          }),
        ],
        bookmarks: [
          {
            _id: "bookmark-late",
            viewerTokenIdentifier: "https://clerk.example|user_1",
          },
        ],
      },
    });

    await purgeAccountDeletionRequestForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      purgeAfter,
    );

    expect(getTable("accountDeletionRequests")[0]).toEqual(
      expect.objectContaining({
        status: "clerk_deleted",
        phase: "revoke_feeds",
        purgeAfter: undefined,
      }),
    );
    expect(scheduled).toHaveLength(1);
  });

  it.each([
    { label: "is missing", scannedThrough: undefined },
    {
      label: "is one millisecond behind",
      scannedThrough: 100 + ACCOUNT_OWNED_AUDIO_MAX_LATE_ACTION_MS - 1,
    },
  ])(
    "retains the deletion tombstone when orphan sweep coverage $label",
    async ({ scannedThrough }) => {
      const purgeAfter = 5_000;
      const { ctx, getTable, scheduled } = createCtx({
        tables: {
          accountDeletionRequests: [
            deletionRequest({
              status: "clerk_deleted",
              phase: "grace_period",
              purgeAfter,
            }),
          ],
          accountOwnedStorageSweepState:
            scannedThrough === undefined
              ? []
              : [
                  {
                    _id: "accountOwnedStorageSweepState-1",
                    key: ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
                    scannedThrough,
                  },
                ],
        },
      });

      await expect(
        purgeAccountDeletionRequestForCtx(
          ctx as never,
          { requestId: "accountDeletionRequests-1" as never },
          purgeAfter,
        ),
      ).resolves.toEqual({ purged: false, cleanupRestarted: false });

      expect(getTable("accountDeletionRequests")).toHaveLength(1);
      expect(scheduled).toEqual([
        expect.objectContaining({
          delay: ACCOUNT_DELETION_PURGE_SWEEP_RETRY_MS,
          args: { requestId: "accountDeletionRequests-1" },
        }),
      ]);
    },
  );

  it.each([
    {
      phase: "bookmarks",
      tableName: "bookmarks",
      ownerField: "viewerTokenIdentifier",
      nextPhase: "listening_progress",
    },
    {
      phase: "listening_progress",
      tableName: "viewerArticleListenProgress",
      ownerField: "viewerTokenIdentifier",
      nextPhase: "badge_credits",
    },
    {
      phase: "badge_credits",
      tableName: "badgeArticleCredits",
      ownerField: "viewerTokenIdentifier",
      nextPhase: "account_quotas",
    },
    {
      phase: "feeds",
      tableName: "personalPodcastFeeds",
      ownerField: "viewerTokenIdentifier",
      nextPhase: "pending_clerk",
    },
  ] as const)(
    "deletes every owned $tableName row while preserving another account",
    async ({ phase, tableName, ownerField, nextPhase }) => {
      const viewerTokenIdentifier = "https://clerk.example|user_1";
      const { ctx, getTable } = createCtx({
        tables: {
          accountDeletionRequests: [deletionRequest({ phase })],
          [tableName]: [
            {
              _id: `${tableName}-own-1`,
              [ownerField]: viewerTokenIdentifier,
            },
            {
              _id: `${tableName}-own-2`,
              [ownerField]: viewerTokenIdentifier,
            },
            {
              _id: `${tableName}-other`,
              [ownerField]: "https://clerk.example|user_2",
            },
          ],
        },
      });

      await runAccountDeletionCleanupBatchForCtx(
        ctx as never,
        { requestId: "accountDeletionRequests-1" as never },
        1_000,
      );

      expect(getTable(tableName)).toEqual([
        expect.objectContaining({ _id: `${tableName}-other` }),
      ]);
      expect(getTable("accountDeletionRequests")[0]?.phase).toBe(nextPhase);
    },
  );

  it("deletes only owner-tagged audio exports and preserves guest Edge and other-user exports", async () => {
    const viewerTokenIdentifier = "https://clerk.example|user_1";
    const { ctx, getTable, deletedStorage } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({ phase: "article_audio_exports" }),
        ],
        articleAudioExports: [
          {
            _id: "export-own",
            ownerTokenIdentifier: viewerTokenIdentifier,
            storageId: "storage-own",
            ttsProvider: "openai",
          },
          {
            _id: "export-other",
            ownerTokenIdentifier: "https://clerk.example|user_2",
            storageId: "storage-other",
            ttsProvider: "openai",
          },
          {
            _id: "export-guest-edge",
            clientId: "guest-client",
            storageId: "storage-guest",
            ttsProvider: "edge",
          },
        ],
        accountOwnedStorage: [
          {
            _id: "ledger-own",
            viewerTokenIdentifier,
            storageId: "storage-own",
          },
        ],
      },
    });

    await runAccountDeletionCleanupBatchForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      1_000,
    );

    expect(deletedStorage).toEqual(["storage-own"]);
    expect(getTable("articleAudioExports").map((doc) => doc._id)).toEqual([
      "export-other",
      "export-guest-edge",
    ]);
    expect(getTable("accountDeletionRequests")[0]?.phase).toBe("owned_storage");
  });

  it("deletes a ledger-only orphan without touching another viewer's blob", async () => {
    const viewerTokenIdentifier = "https://clerk.example|user_1";
    const { ctx, getTable, deletedStorage } = createCtx({
      tables: {
        accountDeletionRequests: [deletionRequest({ phase: "owned_storage" })],
        accountOwnedStorage: [
          {
            _id: "ledger-orphan",
            viewerTokenIdentifier,
            storageId: "storage-orphan",
          },
          {
            _id: "ledger-other",
            viewerTokenIdentifier: "https://clerk.example|user_2",
            storageId: "storage-other",
          },
        ],
      },
    });

    await runAccountDeletionCleanupBatchForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      1_000,
    );

    expect(deletedStorage).toEqual(["storage-orphan"]);
    expect(getTable("accountOwnedStorage")).toEqual([
      expect.objectContaining({ _id: "ledger-other" }),
    ]);
    expect(getTable("accountDeletionRequests")[0]?.phase).toBe("bookmarks");
  });

  it("deletes every duplicate account quota key and preserves unrelated quotas", async () => {
    const viewerTokenIdentifier = "https://clerk.example|user_1";
    const playlistKey = getPersonalPlaylistOpenAiQuotaKey(
      viewerTokenIdentifier,
    );
    const exportKey = getArticleAudioExportQuotaKey(viewerTokenIdentifier);
    const { ctx, getTable } = createCtx({
      tables: {
        accountDeletionRequests: [deletionRequest({ phase: "account_quotas" })],
        routeQuotas: [
          { _id: "quota-playlist-1", key: playlistKey },
          { _id: "quota-playlist-2", key: playlistKey },
          { _id: "quota-export-1", key: exportKey },
          { _id: "quota-export-2", key: exportKey },
          { _id: "quota-unrelated", key: "some-other-quota" },
        ],
      },
    });

    await runAccountDeletionCleanupBatchForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      1_000,
    );

    expect(getTable("routeQuotas")).toEqual([
      expect.objectContaining({ _id: "quota-unrelated" }),
    ]);
    expect(getTable("accountDeletionRequests")[0]?.phase).toBe("feeds");
  });

  it("keeps the phase and reschedules when more than one bounded batch exists", async () => {
    const viewerTokenIdentifier = "https://clerk.example|user_1";
    const bookmarks = Array.from({ length: 26 }, (_, index) => ({
      _id: `bookmark-${index}`,
      viewerTokenIdentifier,
    }));
    const { ctx, getTable, scheduled } = createCtx({
      tables: {
        accountDeletionRequests: [deletionRequest({ phase: "bookmarks" })],
        bookmarks,
      },
    });

    await runAccountDeletionCleanupBatchForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      1_000,
    );
    expect(getTable("bookmarks")).toHaveLength(1);
    expect(getTable("accountDeletionRequests")[0]?.phase).toBe("bookmarks");
    expect(scheduled).toHaveLength(1);

    await runAccountDeletionCleanupBatchForCtx(
      ctx as never,
      { requestId: "accountDeletionRequests-1" as never },
      2_000,
    );
    expect(getTable("bookmarks")).toEqual([]);
    expect(getTable("accountDeletionRequests")[0]?.phase).toBe(
      "listening_progress",
    );
    expect(scheduled).toHaveLength(2);
  });

  it("retains an owning row when storage deletion fails", async () => {
    const viewerTokenIdentifier = "https://clerk.example|user_1";
    const { ctx, getTable } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({ phase: "playlist_episodes" }),
        ],
        personalPlaylistEpisodes: [
          {
            _id: "episode-1",
            viewerTokenIdentifier,
            storageId: "storage-failing",
          },
        ],
      },
    });
    ctx.storage.delete.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(
      runAccountDeletionCleanupBatchForCtx(
        ctx as never,
        { requestId: "accountDeletionRequests-1" as never },
        1_000,
      ),
    ).rejects.toThrow("storage unavailable");
    expect(getTable("personalPlaylistEpisodes")).toEqual([
      expect.objectContaining({ _id: "episode-1" }),
    ]);
  });

  it("refuses a deletion-engine reference to storage ledgered to another viewer", async () => {
    const viewerTokenIdentifier = "https://clerk.example|user_1";
    const { ctx, getTable, deletedStorage } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({ phase: "playlist_episodes" }),
        ],
        personalPlaylistEpisodes: [
          {
            _id: "episode-1",
            viewerTokenIdentifier,
            storageId: "storage-foreign",
          },
        ],
        accountOwnedStorage: [
          {
            _id: "ledger-foreign",
            viewerTokenIdentifier: "https://clerk.example|user_2",
            storageId: "storage-foreign",
          },
        ],
      },
    });

    await expect(
      runAccountDeletionCleanupBatchForCtx(
        ctx as never,
        { requestId: "accountDeletionRequests-1" as never },
        1_000,
      ),
    ).rejects.toThrow("Storage is owned by another account");
    expect(deletedStorage).toEqual([]);
    expect(getTable("personalPlaylistEpisodes")).toEqual([
      expect.objectContaining({ _id: "episode-1" }),
    ]);
    expect(getTable("accountOwnedStorage")).toEqual([
      expect.objectContaining({ _id: "ledger-foreign" }),
    ]);
  });

  it("durably records and reschedules an ordinary cleanup failure", async () => {
    const viewerTokenIdentifier = "https://clerk.example|user_1";
    const { ctx, getTable, scheduled } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({ phase: "playlist_episodes" }),
        ],
        personalPlaylistEpisodes: [
          {
            _id: "episode-1",
            viewerTokenIdentifier,
            storageId: "storage-failing",
          },
        ],
      },
    });
    ctx.storage.delete.mockRejectedValueOnce(new Error("storage unavailable"));

    await invokeRegistered(runAccountDeletionCleanupBatch, ctx, {
      requestId: "accountDeletionRequests-1",
    });

    expect(getTable("personalPlaylistEpisodes")).toEqual([
      expect.objectContaining({ _id: "episode-1" }),
    ]);
    expect(getTable("accountDeletionRequests")[0]).toEqual(
      expect.objectContaining({
        phase: "playlist_episodes",
        cleanupAttemptCount: 1,
        lastError: "storage unavailable",
      }),
    );
    expect(scheduled).toEqual([expect.objectContaining({ delay: 120_000 })]);
    expect(
      getFunctionName(
        scheduled[0]?.functionReference as FunctionReference<
          "mutation",
          "internal"
        >,
      ),
    ).toBe("accountDeletion:runAccountDeletionCleanupBatch");
  });

  it("flags a repeatedly failing cleanup while preserving hourly recovery", async () => {
    const viewerTokenIdentifier = "https://clerk.example|user_1";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx, getTable, scheduled } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({
            phase: "playlist_episodes",
            cleanupAttemptCount:
              ACCOUNT_DELETION_CLEANUP_ATTENTION_THRESHOLD - 1,
          }),
        ],
        personalPlaylistEpisodes: [
          {
            _id: "episode-1",
            viewerTokenIdentifier,
            storageId: "storage-failing",
          },
        ],
      },
    });
    ctx.storage.delete.mockRejectedValue(new Error("storage unavailable"));

    await invokeRegistered(runAccountDeletionCleanupBatch, ctx, {
      requestId: "accountDeletionRequests-1",
    });
    await invokeRegistered(runAccountDeletionCleanupBatch, ctx, {
      requestId: "accountDeletionRequests-1",
    });

    expect(getTable("accountDeletionRequests")[0]).toEqual(
      expect.objectContaining({
        status: "cleaning",
        phase: "playlist_episodes",
        cleanupAttemptCount: ACCOUNT_DELETION_CLEANUP_ATTENTION_THRESHOLD,
        needsAttentionAt: expect.any(Number),
        lastError: "storage unavailable",
      }),
    );
    expect(scheduled).toEqual([
      expect.objectContaining({ delay: 3_600_000 }),
      expect.objectContaining({ delay: 3_600_000 }),
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      "[account-deletion] Cleanup needs operator attention",
      {
        requestId: "accountDeletionRequests-1",
        phase: "playlist_episodes",
        cleanupAttemptCount: ACCOUNT_DELETION_CLEANUP_ATTENTION_THRESHOLD,
      },
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("lists pending Clerk work with attestation and records retry attempts", async () => {
    const secret = "account-deletion-coordinator-secret";
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", secret);
    const { ctx, getTable } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({
            _id: "request-later",
            status: "pending_clerk",
            phase: "pending_clerk",
            cleanupCompletedAt: 200,
            updatedAt: 200,
          }),
          deletionRequest({
            _id: "request-earlier",
            clerkUserId: "user_2",
            viewerTokenIdentifier: "https://clerk.example|user_2",
            status: "pending_clerk",
            phase: "pending_clerk",
            cleanupCompletedAt: 100,
            updatedAt: 100,
          }),
          deletionRequest({ _id: "request-cleaning", status: "cleaning" }),
        ],
      },
    });
    const listAttestation = await createListPendingClerkDeletionsAttestation({
      limit: 25,
    });

    const pending = await invokeRegistered<
      {
        limit: number;
        attestation: Awaited<
          ReturnType<typeof createListPendingClerkDeletionsAttestation>
        >;
      },
      Array<{ requestId: string }>
    >(listPendingClerkDeletions, ctx, {
      limit: 25,
      attestation: listAttestation,
    });
    expect(pending.map((request) => request.requestId)).toEqual([
      "request-earlier",
      "request-later",
    ]);

    const retryIdentity = {
      requestId: "request-earlier",
      clerkUserId: "user_2",
      outcome: "retry" as const,
    };
    const retryAttestation =
      await createMarkClerkDeletionAttestation(retryIdentity);
    await invokeRegistered(markClerkDeletion, ctx, {
      ...retryIdentity,
      attestation: retryAttestation,
    });
    expect(
      getTable("accountDeletionRequests").find(
        (request) => request._id === "request-earlier",
      ),
    ).toEqual(
      expect.objectContaining({
        status: "pending_clerk",
        clerkDeletionAttemptCount: 1,
        lastClerkAttemptAt: expect.any(Number),
      }),
    );

    const beforeTamper = structuredClone(getTable("accountDeletionRequests"));
    await expect(
      invokeRegistered(markClerkDeletion, ctx, {
        ...retryIdentity,
        outcome: "deleted" as const,
        attestation: retryAttestation,
      }),
    ).rejects.toThrow("Invalid account deletion coordinator attestation");
    expect(getTable("accountDeletionRequests")).toEqual(beforeTamper);
  });

  it("bounds pending Clerk deletion query limits", async () => {
    const pendingRequests = Array.from({ length: 105 }, (_, index) =>
      deletionRequest({
        _id: `request-${index}`,
        clerkUserId: `user-${index}`,
        viewerTokenIdentifier: `https://clerk.example|user-${index}`,
        status: "pending_clerk",
        phase: "pending_clerk",
        updatedAt: index,
      }),
    );
    const { ctx } = createCtx({
      tables: { accountDeletionRequests: pendingRequests },
    });

    await expect(
      listPendingClerkDeletionsForCtx(ctx as never, { limit: -5 }),
    ).resolves.toHaveLength(1);
    await expect(
      listPendingClerkDeletionsForCtx(ctx as never, { limit: 2.9 }),
    ).resolves.toHaveLength(2);
    await expect(
      listPendingClerkDeletionsForCtx(ctx as never, { limit: Number.NaN }),
    ).resolves.toHaveLength(100);
    await expect(
      listPendingClerkDeletionsForCtx(ctx as never, {
        limit: Number.POSITIVE_INFINITY,
      }),
    ).resolves.toHaveLength(100);
    await expect(
      listPendingClerkDeletionsForCtx(ctx as never, { limit: 10_000 }),
    ).resolves.toHaveLength(100);
  });

  it("keeps Clerk deletion terminal when a stale retry arrives after success", async () => {
    const { ctx, getTable, scheduled } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({
            status: "pending_clerk",
            phase: "pending_clerk",
            cleanupCompletedAt: 500,
          }),
        ],
      },
    });
    const requestId =
      "accountDeletionRequests-1" as Id<"accountDeletionRequests">;

    await markClerkDeletionForCtx(
      ctx as never,
      { requestId, clerkUserId: "user_1", outcome: "deleted" },
      1_000,
    );
    await markClerkDeletionForCtx(
      ctx as never,
      { requestId, clerkUserId: "user_1", outcome: "retry" },
      2_000,
    );

    expect(getTable("accountDeletionRequests")[0]).toEqual(
      expect.objectContaining({
        status: "clerk_deleted",
        phase: "revoke_feeds",
        clerkDeletedAt: 1_000,
        clerkDeletionAttemptCount: 1,
      }),
    );
    expect(scheduled).toHaveLength(2);
  });

  it("upserts an issuer-derived tombstone for a native Clerk deletion", async () => {
    const { ctx, getTable, scheduled } = createCtx();

    await expect(
      reconcileClerkDeletionForCtx(
        ctx as never,
        { clerkUserId: "user_native", clerkUserExists: false },
        1_000,
        { CLERK_JWT_ISSUER_DOMAIN: "https://clerk.example///" },
      ),
    ).resolves.toEqual({
      reconciled: true,
      created: true,
      status: "clerk_deleted",
      purgeAfter: null,
    });
    expect(getTable("accountDeletionRequests")).toEqual([
      expect.objectContaining({
        viewerTokenIdentifier: "https://clerk.example|user_native",
        clerkUserId: "user_native",
        status: "clerk_deleted",
        phase: "revoke_feeds",
      }),
    ]);
    expect(scheduled).toHaveLength(1);
  });

  it("fails closed when native Clerk deletion reconciliation has no issuer", async () => {
    const { ctx, getTable, scheduled } = createCtx();

    await expect(
      reconcileClerkDeletionForCtx(
        ctx as never,
        { clerkUserId: "user_native", clerkUserExists: false },
        1_000,
        {},
      ),
    ).rejects.toThrow(
      "CLERK_JWT_ISSUER_DOMAIN is required to reconcile Clerk-native account deletion",
    );
    expect(getTable("accountDeletionRequests")).toEqual([]);
    expect(scheduled).toEqual([]);
  });

  it("does not create a tombstone when reconciliation says Clerk still exists", async () => {
    const { ctx, getTable, scheduled } = createCtx();

    await expect(
      reconcileClerkDeletionForCtx(
        ctx as never,
        { clerkUserId: "user_existing", clerkUserExists: true },
        1_000,
        { CLERK_JWT_ISSUER_DOMAIN: "https://clerk.example" },
      ),
    ).resolves.toEqual({
      reconciled: false,
      created: false,
      status: null,
      purgeAfter: null,
    });
    expect(getTable("accountDeletionRequests")).toEqual([]);
    expect(scheduled).toEqual([]);
  });

  it.each([
    { status: "cleaning", phase: "grace_period", purgeAfter: 100 },
    { status: "pending_clerk", phase: "grace_period", purgeAfter: 100 },
    { status: "clerk_deleted", phase: "feeds", purgeAfter: 100 },
  ] as const)(
    "does not purge before cleanup and Clerk deletion are both complete: $status/$phase",
    async ({ status, phase, purgeAfter }) => {
      const { ctx, getTable } = createCtx({
        tables: {
          accountDeletionRequests: [
            deletionRequest({ status, phase, purgeAfter }),
          ],
        },
      });

      await expect(
        purgeAccountDeletionRequestForCtx(
          ctx as never,
          { requestId: "accountDeletionRequests-1" as never },
          1_000,
        ),
      ).resolves.toEqual({ purged: false, cleanupRestarted: false });
      expect(getTable("accountDeletionRequests")).toHaveLength(1);
    },
  );

  it("waits out the full grace period after cleanup and Clerk deletion", async () => {
    const purgeAfter = 10_000;
    const { ctx, getTable, scheduled } = createCtx({
      tables: {
        accountDeletionRequests: [
          deletionRequest({
            status: "clerk_deleted",
            phase: "grace_period",
            clerkDeletedAt: 500,
            cleanupCompletedAt: 1_000,
            purgeAfter,
          }),
        ],
      },
    });

    await expect(
      purgeAccountDeletionRequestForCtx(
        ctx as never,
        { requestId: "accountDeletionRequests-1" as never },
        9_999,
      ),
    ).resolves.toEqual({ purged: false, cleanupRestarted: false });
    expect(getTable("accountDeletionRequests")).toHaveLength(1);
    expect(scheduled).toEqual([expect.objectContaining({ delay: 1 })]);
  });
});
