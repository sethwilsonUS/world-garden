import { describe, expect, it } from "vitest";
import {
  PRODUCT_FEEDBACK_CONTACT_RETENTION_MS,
  assertProductFeedbackWriteAuthorized,
  listProductFeedbackForOwnerForCtx,
  scrubExpiredProductFeedbackContactsForCtx,
  shouldContinueProductFeedbackContactCleanup,
  submitProductFeedbackForCtx,
} from "./productFeedback";

const createCtx = () => {
  const inserted: Array<Record<string, unknown>> = [];
  return {
    ctx: {
      db: {
        insert: async (tableName: string, value: Record<string, unknown>) => {
          inserted.push({ tableName, ...value });
          return "productFeedback-1";
        },
      },
    } as never,
    inserted,
  };
};

type StoredFeedback = {
  _id: string;
  _creationTime?: number;
  kind: "accessibility" | "product" | "technical" | "other";
  message: string;
  environment?: string;
  contactEmail?: string;
  researchOptIn: boolean;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  contactExpiresAt?: number;
  articleTitle?: string;
  articleSlug?: string;
  articleRevisionId?: string;
  createdAt: number;
  updatedAt: number;
};

const createOwnerReadCtx = (records: StoredFeedback[]) => ({
  db: {
    query: (tableName: string) => {
      expect(tableName).toBe("productFeedback");
      return {
        withIndex: (
          indexName: string,
          buildRange: (range: {
            lte: (fieldName: string, value: number) => unknown;
          }) => unknown,
        ) => {
          expect(indexName).toBe("by_creation_time");
          let snapshotBefore = Number.POSITIVE_INFINITY;
          buildRange({
            lte: (fieldName, value) => {
              expect(fieldName).toBe("_creationTime");
              snapshotBefore = value;
              return {};
            },
          });
          return {
            order: (direction: string) => {
              expect(direction).toBe("desc");
              return {
                paginate: async (paginationOpts: {
                  cursor: string | null;
                  numItems: number;
                }) => ({
                  page: records
                    .filter(
                      (record) =>
                        (record._creationTime ?? record.createdAt) <=
                        snapshotBefore,
                    )
                    .slice(0, paginationOpts.numItems),
                  isDone: true,
                  continueCursor: "done",
                }),
              };
            },
          };
        },
      };
    },
  },
});

const createCleanupCtx = (records: StoredFeedback[]) => {
  const stored = new Map(records.map((record) => [record._id, { ...record }]));

  return {
    ctx: {
      db: {
        query: (tableName: string) => {
          expect(tableName).toBe("productFeedback");
          return {
            withIndex: (
              indexName: string,
              buildRange: (range: {
                gte: (
                  fieldName: string,
                  lowerBound: number,
                ) => {
                  lte: (fieldName: string, upperBound: number) => unknown;
                };
              }) => unknown,
            ) => {
              expect(indexName).toBe("by_contactExpiresAt");
              let lowerBound = Number.NEGATIVE_INFINITY;
              let upperBound = Number.POSITIVE_INFINITY;
              buildRange({
                gte: (fieldName, value) => {
                  expect(fieldName).toBe("contactExpiresAt");
                  lowerBound = value;
                  return {
                    lte: (upperFieldName, upperValue) => {
                      expect(upperFieldName).toBe("contactExpiresAt");
                      upperBound = upperValue;
                      return {};
                    },
                  };
                },
              });

              return {
                take: async (limit: number) =>
                  [...stored.values()]
                    .filter(
                      (record) =>
                        typeof record.contactExpiresAt === "number" &&
                        record.contactExpiresAt >= lowerBound &&
                        record.contactExpiresAt <= upperBound,
                    )
                    .sort(
                      (left, right) =>
                        left.contactExpiresAt! - right.contactExpiresAt!,
                    )
                    .slice(0, limit),
              };
            },
          };
        },
        patch: async (
          id: string,
          value: Partial<
            Pick<
              StoredFeedback,
              "contactEmail" | "contactExpiresAt" | "researchOptIn"
            >
          >,
        ) => {
          const record = stored.get(id);
          if (!record) {
            throw new Error(`Missing test record ${id}`);
          }
          const updated = { ...record };
          for (const [field, fieldValue] of Object.entries(value)) {
            if (fieldValue === undefined) {
              delete updated[field as keyof StoredFeedback];
            } else {
              Object.assign(updated, { [field]: fieldValue });
            }
          }
          stored.set(id, updated);
        },
      },
    } as never,
    getRecord: (id: string) => stored.get(id),
  };
};

describe("product feedback write authorization", () => {
  it("accepts the dedicated shared secret and fails closed otherwise", () => {
    expect(() =>
      assertProductFeedbackWriteAuthorized("feedback-secret", {
        PRODUCT_FEEDBACK_WRITE_SECRET: "feedback-secret",
      }),
    ).not.toThrow();
    expect(() =>
      assertProductFeedbackWriteAuthorized("wrong-secret", {
        PRODUCT_FEEDBACK_WRITE_SECRET: "feedback-secret",
      }),
    ).toThrow("Unauthorized");
    expect(() =>
      assertProductFeedbackWriteAuthorized("feedback-secret", {}),
    ).toThrow("is not configured");
  });
});

describe("submitProductFeedbackForCtx", () => {
  it("stores an anonymous submission with workflow timestamps", async () => {
    const { ctx, inserted } = createCtx();

    await expect(
      submitProductFeedbackForCtx(ctx, {
        kind: "accessibility",
        message: "  The play control needs a clearer name.  ",
        environment: " VoiceOver and Safari ",
        researchOptIn: false,
        now: 10_000,
      }),
    ).resolves.toEqual({ feedbackId: "productFeedback-1" });

    expect(inserted).toEqual([
      {
        tableName: "productFeedback",
        kind: "accessibility",
        message: "The play control needs a clearer name.",
        environment: "VoiceOver and Safari",
        researchOptIn: false,
        status: "open",
        createdAt: 10_000,
        updatedAt: 10_000,
      },
    ]);
    for (const forbiddenField of [
      "viewerTokenIdentifier",
      "clerkUserId",
      "ipAddress",
      "userAgent",
      "query",
      "search",
      "analyticsId",
    ]) {
      expect(inserted[0]).not.toHaveProperty(forbiddenField);
    }
  });

  it("sets a bounded contact-retention date when contact details are supplied", async () => {
    const { ctx, inserted } = createCtx();

    await submitProductFeedbackForCtx(ctx, {
      kind: "product",
      message: "I would be happy to test future changes.",
      contactEmail: "reader@example.com",
      researchOptIn: true,
      now: 20_000,
    });

    expect(inserted[0]).toMatchObject({
      contactEmail: "reader@example.com",
      researchOptIn: true,
      contactExpiresAt: 20_000 + PRODUCT_FEEDBACK_CONTACT_RETENTION_MS,
    });
  });

  it("stores only normalized article identity fields when they are supplied", async () => {
    const { ctx, inserted } = createCtx();

    await submitProductFeedbackForCtx(ctx, {
      kind: "technical",
      message: "The References section would not start.",
      researchOptIn: false,
      articleTitle: "  Saturn  ",
      articleSlug: "  Saturn  ",
      articleRevisionId: "  1357913579  ",
      now: 25_000,
    });

    expect(inserted[0]).toMatchObject({
      articleTitle: "Saturn",
      articleSlug: "Saturn",
      articleRevisionId: "1357913579",
    });
    expect(inserted[0]).not.toHaveProperty("url");
    expect(inserted[0]).not.toHaveProperty("query");
  });

  it("revalidates trusted-API input before persistence", async () => {
    const { ctx, inserted } = createCtx();

    await expect(
      submitProductFeedbackForCtx(ctx, {
        kind: "other",
        message: "I would like to join research.",
        researchOptIn: true,
        now: 30_000,
      }),
    ).rejects.toThrow("Contact email is required");
    expect(inserted).toEqual([]);
  });

  it("rejects incoherent article context before persistence", async () => {
    const { ctx, inserted } = createCtx();

    await expect(
      submitProductFeedbackForCtx(ctx, {
        kind: "technical",
        message: "Article feedback",
        researchOptIn: false,
        articleTitle: "Saturn",
        now: 30_000,
      }),
    ).rejects.toThrow("Article title and slug are required together");
    expect(inserted).toEqual([]);
  });
});

describe("listProductFeedbackForOwnerForCtx", () => {
  it("projects owner fields while suppressing expired and unrequested contact email", async () => {
    const active: StoredFeedback = {
      _id: "active-feedback",
      _creationTime: 9_000,
      kind: "accessibility",
      message: "The focus moved unexpectedly.",
      environment: "VoiceOver and Safari",
      contactEmail: "active@example.com",
      researchOptIn: true,
      status: "open",
      contactExpiresAt: 10_001,
      articleTitle: "Moria",
      articleSlug: "Moria",
      articleRevisionId: "123",
      createdAt: 9_000,
      updatedAt: 9_500,
    };
    const expired: StoredFeedback = {
      ...active,
      _id: "expired-feedback",
      _creationTime: 8_000,
      contactEmail: "expired@example.com",
      contactExpiresAt: 10_000,
      createdAt: 8_000,
      updatedAt: 8_500,
    };

    const result = await listProductFeedbackForOwnerForCtx(
      createOwnerReadCtx([active, expired]) as never,
      {
        paginationOpts: { cursor: null, numItems: 1000 },
        reportRunId: "projection-test",
        snapshotBefore: 10_000,
        includeContact: false,
        now: 10_000,
      },
    );

    expect(result.page).toEqual([
      {
        id: "active-feedback",
        kind: "accessibility",
        message: "The focus moved unexpectedly.",
        environment: "VoiceOver and Safari",
        researchOptIn: true,
        status: "open",
        contactAvailable: true,
        contactExpiresAt: 10_001,
        articleTitle: "Moria",
        articleSlug: "Moria",
        articleRevisionId: "123",
        createdAt: 9_000,
        updatedAt: 9_500,
      },
      {
        id: "expired-feedback",
        kind: "accessibility",
        message: "The focus moved unexpectedly.",
        environment: "VoiceOver and Safari",
        researchOptIn: false,
        status: "open",
        contactAvailable: false,
        articleTitle: "Moria",
        articleSlug: "Moria",
        articleRevisionId: "123",
        createdAt: 8_000,
        updatedAt: 8_500,
      },
    ]);
    expect(result.page).not.toContainEqual(
      expect.objectContaining({ contactEmail: expect.any(String) }),
    );

    const contactResult = await listProductFeedbackForOwnerForCtx(
      createOwnerReadCtx([active, expired]) as never,
      {
        paginationOpts: { cursor: null, numItems: 100 },
        reportRunId: "contact-test",
        snapshotBefore: 10_000,
        includeContact: true,
        now: 10_000,
      },
    );
    expect(contactResult.page[0]).toMatchObject({
      id: "active-feedback",
      contactEmail: "active@example.com",
      contactAvailable: true,
    });
    expect(contactResult.page[1]).not.toHaveProperty("contactEmail");
  });

  it("chooses a server-time snapshot for the first page", async () => {
    const record: StoredFeedback = {
      _id: "visible-feedback",
      _creationTime: 9_000,
      kind: "product",
      message: "Visible at the snapshot.",
      researchOptIn: false,
      status: "open",
      createdAt: 9_000,
      updatedAt: 9_000,
    };

    const result = await listProductFeedbackForOwnerForCtx(
      createOwnerReadCtx([record]) as never,
      {
        paginationOpts: { cursor: null, numItems: 100 },
        reportRunId: "snapshot-test",
        includeContact: false,
        now: 10_000,
      } as never,
    );

    expect(result.snapshotBefore).toBe(10_000);
    expect(result.page).toHaveLength(1);
  });

  it("uses the status index and clamps owner page reads", async () => {
    let paginationOpts: Record<string, unknown> | undefined;
    const ctx = {
      db: {
        query: () => ({
          withIndex: (
            indexName: string,
            buildRange: (range: {
              eq: (
                fieldName: string,
                value: string,
              ) => {
                lte: (fieldName: string, value: number) => unknown;
              };
            }) => unknown,
          ) => {
            expect(indexName).toBe("by_status");
            buildRange({
              eq: (fieldName, value) => {
                expect(fieldName).toBe("status");
                expect(value).toBe("resolved");
                return {
                  lte: (creationField, snapshotBefore) => {
                    expect(creationField).toBe("_creationTime");
                    expect(snapshotBefore).toBe(20_000);
                    return {};
                  },
                };
              },
            });
            return {
              order: () => ({
                paginate: async (options: Record<string, unknown>) => {
                  paginationOpts = options;
                  return { page: [], isDone: true, continueCursor: "done" };
                },
              }),
            };
          },
        }),
      },
    };

    await listProductFeedbackForOwnerForCtx(ctx as never, {
      paginationOpts: { cursor: null, numItems: 10_000 },
      reportRunId: "status-test",
      status: "resolved",
      snapshotBefore: 20_000,
      includeContact: false,
      now: 20_000,
    });

    expect(paginationOpts).toEqual({
      cursor: null,
      numItems: 100,
      maximumRowsRead: 100,
    });
  });
});

describe("scrubExpiredProductFeedbackContactsForCtx", () => {
  it("removes expired contact details while preserving the feedback record", async () => {
    const expired: StoredFeedback = {
      _id: "expired-feedback",
      kind: "accessibility",
      message: "The player needs a clearer stop control.",
      environment: "VoiceOver and Safari",
      contactEmail: "reader@example.com",
      researchOptIn: true,
      status: "reviewing",
      contactExpiresAt: 9_999,
      createdAt: 1_000,
      updatedAt: 5_000,
    };
    const future: StoredFeedback = {
      ...expired,
      _id: "future-feedback",
      message: "Please keep this contact method for now.",
      contactExpiresAt: 10_001,
    };
    const anonymous: StoredFeedback = {
      _id: "anonymous-feedback",
      kind: "technical",
      message: "No contact details were supplied.",
      researchOptIn: false,
      status: "open",
      createdAt: 2_000,
      updatedAt: 2_000,
    };
    const { ctx, getRecord } = createCleanupCtx([expired, future, anonymous]);

    await expect(
      scrubExpiredProductFeedbackContactsForCtx(ctx, {
        now: 10_000,
        limit: 100,
      }),
    ).resolves.toEqual({ scrubbed: 1 });

    expect(getRecord("expired-feedback")).toEqual({
      _id: "expired-feedback",
      kind: "accessibility",
      message: "The player needs a clearer stop control.",
      environment: "VoiceOver and Safari",
      researchOptIn: false,
      status: "reviewing",
      createdAt: 1_000,
      updatedAt: 5_000,
    });
    expect(getRecord("future-feedback")).toEqual(future);
    expect(getRecord("anonymous-feedback")).toEqual(anonymous);
  });

  it("limits each cleanup pass to the requested batch size", async () => {
    const records = [1, 2, 3].map<StoredFeedback>((suffix) => ({
      _id: `expired-feedback-${suffix}`,
      kind: "product",
      message: `Feedback ${suffix} remains stored.`,
      contactEmail: `reader-${suffix}@example.com`,
      researchOptIn: true,
      status: "open",
      contactExpiresAt: suffix,
      createdAt: suffix,
      updatedAt: suffix,
    }));
    const { ctx, getRecord } = createCleanupCtx(records);

    await expect(
      scrubExpiredProductFeedbackContactsForCtx(ctx, {
        now: 10_000,
        limit: 2,
      }),
    ).resolves.toEqual({ scrubbed: 2 });

    expect(getRecord("expired-feedback-1")?.contactEmail).toBeUndefined();
    expect(getRecord("expired-feedback-2")?.contactEmail).toBeUndefined();
    expect(getRecord("expired-feedback-3")?.contactEmail).toBe(
      "reader-3@example.com",
    );
    expect(getRecord("expired-feedback-3")?.message).toBe(
      "Feedback 3 remains stored.",
    );
  });

  it("continues only when a cleanup batch may have left a backlog", () => {
    expect(
      shouldContinueProductFeedbackContactCleanup({
        scrubbed: 100,
        limit: 100,
      }),
    ).toBe(true);
    expect(
      shouldContinueProductFeedbackContactCleanup({
        scrubbed: 99,
        limit: 100,
      }),
    ).toBe(false);
  });
});
