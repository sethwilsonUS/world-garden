import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETION_IN_PROGRESS,
  assertViewerAccountActiveForCtx,
  isViewerAccountDeletionActiveForCtx,
} from "./accountDeletionState";

const createCtx = (deletingViewers: string[]) => ({
  db: {
    query: (tableName: string) => {
      expect(tableName).toBe("accountDeletionRequests");
      return {
        withIndex: (
          indexName: string,
          build: (query: {
            eq: (field: string, value: string) => unknown;
          }) => unknown,
        ) => {
          expect(indexName).toBe("by_viewerTokenIdentifier");
          let viewerTokenIdentifier = "";
          build({
            eq: (field, value) => {
              expect(field).toBe("viewerTokenIdentifier");
              viewerTokenIdentifier = value;
              return {};
            },
          });
          return {
            first: async () =>
              deletingViewers.includes(viewerTokenIdentifier)
                ? { _id: "deletion-1", viewerTokenIdentifier }
                : null,
          };
        },
      };
    },
  },
});

describe("account deletion write barrier", () => {
  it("reports an account as active when no durable deletion request exists", async () => {
    const ctx = createCtx([]);

    await expect(
      isViewerAccountDeletionActiveForCtx(ctx as never, "viewer-1"),
    ).resolves.toBe(false);
    await expect(
      assertViewerAccountActiveForCtx(ctx as never, "viewer-1"),
    ).resolves.toBeUndefined();
  });

  it("blocks writes for every deletion status until the tombstone is purged", async () => {
    const ctx = createCtx(["viewer-1"]);

    await expect(
      isViewerAccountDeletionActiveForCtx(ctx as never, "viewer-1"),
    ).resolves.toBe(true);
    await expect(
      assertViewerAccountActiveForCtx(ctx as never, "viewer-1"),
    ).rejects.toThrow(ACCOUNT_DELETION_IN_PROGRESS);
  });
});
