import { describe, expect, it } from "vitest";
import { createServerAttestation } from "../lib/server-attestation";
import {
  getRouteQuotaAttestationPayload,
  ROUTE_QUOTA_ATTESTATION_SCOPE,
} from "../lib/route-quota-attestation";
import {
  assertRouteQuotaAttestation,
  cleanupExpiredRouteQuotasForCtx,
  getRouteQuotaAttestationSecret,
  shouldContinueRouteQuotaCleanup,
} from "./rateLimits";

type StoredRouteQuota = {
  _id: string;
  key: string;
  count: number;
  windowStart: number;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
};

const createCleanupCtx = (records: StoredRouteQuota[]) => {
  const stored = new Map(records.map((record) => [record._id, { ...record }]));

  return {
    ctx: {
      db: {
        query: (tableName: string) => {
          expect(tableName).toBe("routeQuotas");
          return {
            withIndex: (
              indexName: string,
              buildRange: (range: {
                lte: (fieldName: string, upperBound: number) => unknown;
              }) => unknown,
            ) => {
              expect(indexName).toBe("by_expiresAt");
              let upperBound = Number.POSITIVE_INFINITY;
              buildRange({
                lte: (fieldName, value) => {
                  expect(fieldName).toBe("expiresAt");
                  upperBound = value;
                  return {};
                },
              });

              return {
                take: async (limit: number) =>
                  [...stored.values()]
                    .filter((record) => record.expiresAt <= upperBound)
                    .sort((left, right) => left.expiresAt - right.expiresAt)
                    .slice(0, limit),
              };
            },
          };
        },
        delete: async (id: string) => {
          stored.delete(id);
        },
      },
    } as never,
    getRecords: () => [...stored.values()],
  };
};

describe("route quota attestation boundary", () => {
  const parameters = {
    key: "route-quota:tts-openai-public-daily:client-hash",
    limit: 800,
    windowMs: 86_400_000,
  };
  const secret = "shared-test-secret";

  const sign = async () =>
    await createServerAttestation({
      scope: ROUTE_QUOTA_ATTESTATION_SCOPE,
      payload: getRouteQuotaAttestationPayload(parameters),
      secret,
      now: 1_000,
      nonce: "route-quota-test",
    });

  it("accepts a fresh attestation bound to every quota parameter", async () => {
    await expect(
      assertRouteQuotaAttestation(parameters, await sign(), secret, 1_001),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["key", "route-quota:attacker:rotated"],
    ["limit", 80_000],
    ["windowMs", 1],
  ] as const)("rejects a caller-tampered %s", async (field, value) => {
    await expect(
      assertRouteQuotaAttestation(
        { ...parameters, [field]: value },
        await sign(),
        secret,
        1_001,
      ),
    ).rejects.toThrow("Invalid or expired route quota attestation.");
  });

  it("rejects missing secrets and expired attestations", async () => {
    const attestation = await sign();

    await expect(
      assertRouteQuotaAttestation(parameters, attestation, undefined, 1_001),
    ).rejects.toThrow("Invalid or expired route quota attestation.");
    await expect(
      assertRouteQuotaAttestation(parameters, attestation, secret, 61_001),
    ).rejects.toThrow("Invalid or expired route quota attestation.");
  });

  it("rejects invalid quota bounds before touching storage", async () => {
    await expect(
      assertRouteQuotaAttestation(
        { ...parameters, limit: 0 },
        await sign(),
        secret,
        1_001,
      ),
    ).rejects.toThrow("Invalid route quota parameters.");
  });

  it("uses the dedicated feedback secret only for feedback quota keys", () => {
    const environment = {
      PRODUCT_FEEDBACK_WRITE_SECRET: "feedback-secret",
      TTS_QUOTA_BYPASS_SECRET: "tts-secret",
    };

    expect(
      getRouteQuotaAttestationSecret(
        "route-quota:product-feedback:opaque-key",
        environment,
      ),
    ).toBe("feedback-secret");
    expect(
      getRouteQuotaAttestationSecret(
        "route-quota:tts-openai-public-daily:opaque-key",
        environment,
      ),
    ).toBe("tts-secret");
  });
});

describe("cleanupExpiredRouteQuotasForCtx", () => {
  const quota = (id: string, expiresAt: number): StoredRouteQuota => ({
    _id: id,
    key: `route-quota:product-feedback:${id}`,
    count: 1,
    windowStart: 1_000,
    expiresAt,
    createdAt: 1_000,
    updatedAt: 1_000,
  });

  it("deletes expired quota records while preserving active windows", async () => {
    const { ctx, getRecords } = createCleanupCtx([
      quota("expired", 9_999),
      quota("boundary", 10_000),
      quota("active", 10_001),
    ]);

    await expect(
      cleanupExpiredRouteQuotasForCtx(ctx, {
        now: 10_000,
        limit: 100,
      }),
    ).resolves.toEqual({ deleted: 2 });

    expect(getRecords()).toEqual([quota("active", 10_001)]);
  });

  it("bounds each cleanup pass and removes the oldest expirations first", async () => {
    const { ctx, getRecords } = createCleanupCtx([
      quota("oldest", 1_000),
      quota("middle", 2_000),
      quota("newest", 3_000),
    ]);

    await expect(
      cleanupExpiredRouteQuotasForCtx(ctx, {
        now: 10_000,
        limit: 2,
      }),
    ).resolves.toEqual({ deleted: 2 });

    expect(getRecords()).toEqual([quota("newest", 3_000)]);
  });

  it("continues only when a cleanup batch may have left a backlog", () => {
    expect(shouldContinueRouteQuotaCleanup({ deleted: 500, limit: 500 })).toBe(
      true,
    );
    expect(shouldContinueRouteQuotaCleanup({ deleted: 499, limit: 500 })).toBe(
      false,
    );
  });
});
