import { afterEach, describe, expect, it, vi } from "vitest";
import { getFunctionName, type FunctionReference } from "convex/server";
import {
  ACCOUNT_OWNED_AUDIO_ORPHAN_GRACE_MS,
  ACCOUNT_OWNED_AUDIO_STORAGE_CONTENT_TYPE,
  ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
} from "../lib/account-owned-audio-storage";
import {
  ACCOUNT_OWNED_STORAGE_SWEEP_PAGE_SIZE,
  sweepAccountOwnedStorageOrphans,
} from "./accountOwnedStorage";

type StorageDoc = {
  _id: string;
  _creationTime: number;
  contentType?: string;
};

type SweepState = {
  _id: string;
  key: string;
  scannedThrough: number;
  activeCutoff?: number;
  cursor?: string;
  createdAt: number;
  updatedAt: number;
};

type PageResult = {
  page: StorageDoc[];
  isDone: boolean;
  continueCursor: string;
};

const getHandler = <TArgs, TResult>(registeredFunction: unknown) =>
  (
    registeredFunction as {
      _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
    }
  )._handler;

const createCtx = ({
  state = null,
  pageResult,
  ledgerStorageIds = [],
  deleteError,
}: {
  state?: SweepState | null;
  pageResult: PageResult;
  ledgerStorageIds?: string[];
  deleteError?: Error;
}) => {
  const range = {
    lowerField: "",
    lowerValue: Number.NaN,
    upperField: "",
    upperValue: Number.NaN,
  };
  const paginate = vi.fn(async () => pageResult);
  const systemQuery = vi.fn((tableName: string) => {
    if (tableName !== "_storage") {
      throw new Error(`Unexpected system table: ${tableName}`);
    }
    const chain = {
      withIndex: (
        indexName: string,
        build: (query: {
          gt: (field: string, value: number) => unknown;
          lte: (field: string, value: number) => unknown;
        }) => unknown,
      ) => {
        expect(indexName).toBe("by_creation_time");
        const query = {
          gt: (field: string, value: number) => {
            range.lowerField = field;
            range.lowerValue = value;
            return query;
          },
          lte: (field: string, value: number) => {
            range.upperField = field;
            range.upperValue = value;
            return query;
          },
        };
        build(query);
        return chain;
      },
      order: (direction: string) => {
        expect(direction).toBe("asc");
        return chain;
      },
      paginate,
    };
    return chain;
  });

  const ledgerLookups: string[] = [];
  const query = vi.fn((tableName: string) => {
    if (tableName === "accountOwnedStorageSweepState") {
      const chain = {
        withIndex: (
          indexName: string,
          build: (queryBuilder: {
            eq: (field: string, value: string) => unknown;
          }) => unknown,
        ) => {
          expect(indexName).toBe("by_key");
          const queryBuilder = {
            eq: (field: string, value: string) => {
              expect(field).toBe("key");
              expect(value).toBe(ACCOUNT_OWNED_AUDIO_SWEEP_KEY);
              return queryBuilder;
            },
          };
          build(queryBuilder);
          return { first: async () => state };
        },
      };
      return chain;
    }
    if (tableName === "accountOwnedStorage") {
      const chain = {
        withIndex: (
          indexName: string,
          build: (queryBuilder: {
            eq: (field: string, value: string) => unknown;
          }) => unknown,
        ) => {
          expect(indexName).toBe("by_storageId");
          let storageId = "";
          const queryBuilder = {
            eq: (field: string, value: string) => {
              expect(field).toBe("storageId");
              storageId = value;
              ledgerLookups.push(value);
              return queryBuilder;
            },
          };
          build(queryBuilder);
          return {
            first: async () =>
              ledgerStorageIds.includes(storageId)
                ? { _id: `ledger-${storageId}`, storageId }
                : null,
          };
        },
      };
      return chain;
    }
    throw new Error(`Unexpected table: ${tableName}`);
  });

  const storageDelete = vi.fn(async () => {
    if (deleteError) throw deleteError;
  });
  const insert = vi.fn(async () => "sweep-state-new");
  const patch = vi.fn(async () => undefined);
  const runAfter = vi.fn(
    async (
      delay: number,
      functionReference: unknown,
      args: Record<string, unknown>,
    ) => {
      void delay;
      void functionReference;
      void args;
    },
  );
  const ctx = {
    db: {
      system: { query: systemQuery },
      query,
      insert,
      patch,
    },
    storage: { delete: storageDelete },
    scheduler: { runAfter },
  };

  return {
    ctx,
    insert,
    ledgerLookups,
    paginate,
    patch,
    range,
    runAfter,
    storageDelete,
    systemQuery,
  };
};

describe("account-owned storage orphan sweep", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes only old, exactly marked, unledgered storage", async () => {
    const now = 20_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const cutoff = now - ACCOUNT_OWNED_AUDIO_ORPHAN_GRACE_MS;
    const state: SweepState = {
      _id: "sweep-state-1",
      key: ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
      scannedThrough: 5_000,
      createdAt: 1_000,
      updatedAt: 1_000,
    };
    const orphan = {
      _id: "storage-orphan",
      _creationTime: 6_000,
      contentType: ACCOUNT_OWNED_AUDIO_STORAGE_CONTENT_TYPE,
    };
    const ledgered = {
      _id: "storage-ledgered",
      _creationTime: 7_000,
      contentType: ACCOUNT_OWNED_AUDIO_STORAGE_CONTENT_TYPE,
    };
    const ordinary = {
      _id: "storage-ordinary",
      _creationTime: 8_000,
      contentType: "audio/mpeg",
    };
    const almostMarked = {
      _id: "storage-almost-marked",
      _creationTime: 9_000,
      contentType: `${ACCOUNT_OWNED_AUDIO_STORAGE_CONTENT_TYPE}; version=1`,
    };
    const harness = createCtx({
      state,
      pageResult: {
        page: [orphan, ledgered, ordinary, almostMarked],
        isDone: true,
        continueCursor: "done-cursor",
      },
      ledgerStorageIds: [ledgered._id],
    });

    await expect(
      getHandler<{ continuation: boolean }, Record<string, unknown>>(
        sweepAccountOwnedStorageOrphans,
      )(harness.ctx, { continuation: false }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "complete",
        scanned: 4,
        marked: 2,
        deleted: 1,
        preserved: 1,
        scannedThrough: cutoff,
      }),
    );

    expect(harness.range).toEqual({
      lowerField: "_creationTime",
      lowerValue: state.scannedThrough,
      upperField: "_creationTime",
      upperValue: cutoff,
    });
    expect(harness.paginate).toHaveBeenCalledWith({
      cursor: null,
      numItems: ACCOUNT_OWNED_STORAGE_SWEEP_PAGE_SIZE,
      maximumRowsRead: ACCOUNT_OWNED_STORAGE_SWEEP_PAGE_SIZE,
    });
    expect(harness.ledgerLookups).toEqual([orphan._id, ledgered._id]);
    expect(harness.storageDelete).toHaveBeenCalledTimes(1);
    expect(harness.storageDelete).toHaveBeenCalledWith(orphan._id);
    expect(harness.patch).toHaveBeenCalledWith(state._id, {
      scannedThrough: cutoff,
      activeCutoff: undefined,
      cursor: undefined,
      updatedAt: now,
    });
    expect(harness.runAfter).not.toHaveBeenCalled();
  });

  it("persists a fixed cutoff and cursor before scheduling a bounded continuation", async () => {
    const now = 30_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const cutoff = now - ACCOUNT_OWNED_AUDIO_ORPHAN_GRACE_MS;
    const harness = createCtx({
      pageResult: {
        page: [],
        isDone: false,
        continueCursor: "next-page",
      },
    });

    await expect(
      getHandler<{ continuation: boolean }, Record<string, unknown>>(
        sweepAccountOwnedStorageOrphans,
      )(harness.ctx, { continuation: false }),
    ).resolves.toEqual(
      expect.objectContaining({ status: "continued", scannedThrough: 0 }),
    );

    expect(harness.insert).toHaveBeenCalledWith(
      "accountOwnedStorageSweepState",
      {
        key: ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
        scannedThrough: 0,
        activeCutoff: cutoff,
        cursor: "next-page",
        createdAt: now,
        updatedAt: now,
      },
    );
    expect(harness.runAfter).toHaveBeenCalledTimes(1);
    const [delay, functionReference, args] =
      harness.runAfter.mock.calls[0] ?? [];
    expect(delay).toBe(0);
    expect(
      getFunctionName(
        functionReference as FunctionReference<"mutation", "internal">,
      ),
    ).toBe("accountOwnedStorage:sweepAccountOwnedStorageOrphans");
    expect(args).toEqual({ continuation: true });
  });

  it("resumes an active fixed range even when invoked by cron", async () => {
    const now = 40_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const state: SweepState = {
      _id: "sweep-state-1",
      key: ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
      scannedThrough: 10_000,
      activeCutoff: 20_000,
      cursor: "active-cursor",
      createdAt: 1_000,
      updatedAt: 2_000,
    };
    const harness = createCtx({
      state,
      pageResult: { page: [], isDone: true, continueCursor: "done" },
    });

    await getHandler<{ continuation: boolean }, Record<string, unknown>>(
      sweepAccountOwnedStorageOrphans,
    )(harness.ctx, { continuation: false });

    expect(harness.range.upperValue).toBe(state.activeCutoff);
    expect(harness.paginate).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: state.cursor }),
    );
    expect(harness.patch).toHaveBeenCalledWith(state._id, {
      scannedThrough: state.activeCutoff,
      activeCutoff: undefined,
      cursor: undefined,
      updatedAt: now,
    });
  });

  it("ignores a stale continuation after its range has completed", async () => {
    const state: SweepState = {
      _id: "sweep-state-1",
      key: ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
      scannedThrough: 10_000,
      createdAt: 1_000,
      updatedAt: 2_000,
    };
    const harness = createCtx({
      state,
      pageResult: { page: [], isDone: true, continueCursor: "done" },
    });

    await expect(
      getHandler<{ continuation: boolean }, Record<string, unknown>>(
        sweepAccountOwnedStorageOrphans,
      )(harness.ctx, { continuation: true }),
    ).resolves.toEqual(
      expect.objectContaining({ status: "stale", scannedThrough: 10_000 }),
    );

    expect(harness.systemQuery).not.toHaveBeenCalled();
    expect(harness.patch).not.toHaveBeenCalled();
    expect(harness.insert).not.toHaveBeenCalled();
    expect(harness.runAfter).not.toHaveBeenCalled();
  });

  it("does not advance or schedule when deleting an orphan fails", async () => {
    const now = 20_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const state: SweepState = {
      _id: "sweep-state-1",
      key: ACCOUNT_OWNED_AUDIO_SWEEP_KEY,
      scannedThrough: 5_000,
      createdAt: 1_000,
      updatedAt: 1_000,
    };
    const harness = createCtx({
      state,
      pageResult: {
        page: [
          {
            _id: "storage-orphan",
            _creationTime: 6_000,
            contentType: ACCOUNT_OWNED_AUDIO_STORAGE_CONTENT_TYPE,
          },
        ],
        isDone: false,
        continueCursor: "next-page",
      },
      deleteError: new Error("storage unavailable"),
    });

    await expect(
      getHandler<{ continuation: boolean }, Record<string, unknown>>(
        sweepAccountOwnedStorageOrphans,
      )(harness.ctx, { continuation: false }),
    ).rejects.toThrow("storage unavailable");

    expect(harness.patch).not.toHaveBeenCalled();
    expect(harness.insert).not.toHaveBeenCalled();
    expect(harness.runAfter).not.toHaveBeenCalled();
  });
});
