import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  deleteAccountOwnedStorageForCtx,
  registerAccountOwnedStorageForCtx,
} from "./accountOwnedStorage";

type Ledger = {
  _id: string;
  viewerTokenIdentifier: string;
  storageId: Id<"_storage">;
  kind: "personal_playlist_episode" | "article_audio_export";
  parentId: string;
  createdAt: number;
  updatedAt: number;
};

const createCtx = ({
  deletingViewers = [],
  ledgers = [],
}: {
  deletingViewers?: string[];
  ledgers?: Ledger[];
} = {}) => {
  const storedLedgers = new Map(
    ledgers.map((ledger) => [ledger._id, { ...ledger }]),
  );
  const deletedStorage: string[] = [];
  let nextId = 1;

  const queryBy = (tableName: string, field: string, value: unknown) => {
    if (tableName === "accountDeletionRequests") {
      const matches = deletingViewers.includes(String(value))
        ? [{ _id: "deletion-1", viewerTokenIdentifier: value }]
        : [];
      return {
        first: async () => matches[0] ?? null,
        collect: async () => matches,
      };
    }
    if (tableName === "accountOwnedStorage") {
      const matches = [...storedLedgers.values()].filter(
        (ledger) => ledger[field as keyof Ledger] === value,
      );
      return {
        first: async () => matches[0] ?? null,
        collect: async () => matches,
      };
    }
    throw new Error(`Unexpected table ${tableName}`);
  };

  return {
    ctx: {
      db: {
        query: (tableName: string) => ({
          withIndex: (
            _indexName: string,
            build: (query: {
              eq: (field: string, value: unknown) => unknown;
            }) => unknown,
          ) => {
            let field = "";
            let value: unknown;
            build({
              eq: (nextField, nextValue) => {
                field = nextField;
                value = nextValue;
                return {};
              },
            });
            return queryBy(tableName, field, value);
          },
        }),
        insert: vi.fn(
          async (_tableName: string, value: Omit<Ledger, "_id">) => {
            const id = `ledger-new-${nextId++}`;
            storedLedgers.set(id, { _id: id, ...value });
            return id;
          },
        ),
        patch: vi.fn(async (id: string, value: Partial<Ledger>) => {
          const existing = storedLedgers.get(id);
          if (existing) storedLedgers.set(id, { ...existing, ...value });
        }),
        delete: vi.fn(async (id: string) => {
          storedLedgers.delete(id);
        }),
      },
      storage: {
        delete: vi.fn(async (storageId: string) => {
          deletedStorage.push(storageId);
        }),
      },
    },
    getLedgers: () => [...storedLedgers.values()],
    getDeletedStorage: () => deletedStorage,
  };
};

const registration = {
  viewerTokenIdentifier: "viewer-1",
  storageId: "storage-1" as Id<"_storage">,
  kind: "personal_playlist_episode" as const,
  parentId: "episode-1",
};

describe("account-owned storage ledger", () => {
  it("registers a newly attached account-owned blob", async () => {
    const { ctx, getLedgers, getDeletedStorage } = createCtx();

    await expect(
      registerAccountOwnedStorageForCtx(ctx as never, registration, 1_000),
    ).resolves.toEqual({ registered: true });

    expect(getDeletedStorage()).toEqual([]);
    expect(getLedgers()).toEqual([
      expect.objectContaining({
        viewerTokenIdentifier: "viewer-1",
        storageId: "storage-1",
        parentId: "episode-1",
        createdAt: 1_000,
        updatedAt: 1_000,
      }),
    ]);
  });

  it("is idempotent for the same viewer and refreshes parent metadata", async () => {
    const existing: Ledger = {
      _id: "ledger-1",
      ...registration,
      parentId: "old-parent",
      createdAt: 500,
      updatedAt: 500,
    };
    const { ctx, getLedgers } = createCtx({ ledgers: [existing] });

    await expect(
      registerAccountOwnedStorageForCtx(ctx as never, registration, 1_000),
    ).resolves.toEqual({ registered: true });
    expect(getLedgers()).toEqual([
      { ...existing, parentId: "episode-1", updatedAt: 1_000 },
    ]);
  });

  it("fails closed when a storage id is already owned by another viewer", async () => {
    const { ctx, getDeletedStorage } = createCtx({
      ledgers: [
        {
          _id: "ledger-other",
          ...registration,
          viewerTokenIdentifier: "viewer-2",
          createdAt: 500,
          updatedAt: 500,
        },
      ],
    });

    await expect(
      registerAccountOwnedStorageForCtx(ctx as never, registration, 1_000),
    ).rejects.toThrow("Storage is already owned by another account");
    expect(getDeletedStorage()).toEqual([]);
  });

  it("deletes a late upload instead of registering it for a deleting account", async () => {
    const { ctx, getLedgers, getDeletedStorage } = createCtx({
      deletingViewers: ["viewer-1"],
      ledgers: [
        {
          _id: "ledger-late-upload",
          ...registration,
          createdAt: 500,
          updatedAt: 500,
        },
      ],
    });

    await expect(
      registerAccountOwnedStorageForCtx(ctx as never, registration, 1_000),
    ).resolves.toEqual({ registered: false });
    expect(getDeletedStorage()).toEqual(["storage-1"]);
    expect(getLedgers()).toEqual([]);
  });

  it("refuses to delete ledgered storage without an expected owner", async () => {
    const ledger = (id: string): Ledger => ({
      _id: id,
      ...registration,
      createdAt: 500,
      updatedAt: 500,
    });
    const { ctx, getLedgers, getDeletedStorage } = createCtx({
      ledgers: [ledger("ledger-1"), ledger("ledger-2")],
    });

    await expect(
      deleteAccountOwnedStorageForCtx(
        ctx as never,
        "storage-1" as Id<"_storage">,
      ),
    ).rejects.toThrow("Storage ownership could not be verified");

    expect(getDeletedStorage()).toEqual([]);
    expect(getLedgers()).toHaveLength(2);
  });

  it("refuses to delete storage when any ledger belongs to another viewer", async () => {
    const { ctx, getLedgers, getDeletedStorage } = createCtx({
      ledgers: [
        {
          _id: "ledger-foreign",
          ...registration,
          viewerTokenIdentifier: "viewer-2",
          createdAt: 500,
          updatedAt: 500,
        },
      ],
    });

    await expect(
      deleteAccountOwnedStorageForCtx(
        ctx as never,
        registration.storageId,
        "viewer-1",
      ),
    ).rejects.toThrow("Storage is owned by another account");
    expect(getDeletedStorage()).toEqual([]);
    expect(getLedgers()).toHaveLength(1);
  });

  it("deletes storage and duplicate ledgers when every ledger has the expected owner", async () => {
    const ledger = (id: string): Ledger => ({
      _id: id,
      ...registration,
      createdAt: 500,
      updatedAt: 500,
    });
    const { ctx, getLedgers, getDeletedStorage } = createCtx({
      ledgers: [ledger("ledger-1"), ledger("ledger-2")],
    });

    await expect(
      deleteAccountOwnedStorageForCtx(
        ctx as never,
        registration.storageId,
        "viewer-1",
      ),
    ).resolves.toEqual({ deleted: true });
    expect(getDeletedStorage()).toEqual(["storage-1"]);
    expect(getLedgers()).toEqual([]);
  });

  it("deletes a fresh unowned blob without requiring an expected owner", async () => {
    const { ctx, getLedgers, getDeletedStorage } = createCtx();

    await expect(
      deleteAccountOwnedStorageForCtx(ctx as never, registration.storageId),
    ).resolves.toEqual({ deleted: true });
    expect(getDeletedStorage()).toEqual(["storage-1"]);
    expect(getLedgers()).toEqual([]);
  });
});
