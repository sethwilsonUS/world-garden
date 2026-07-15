import { describe, expect, it } from "vitest";
import {
  ARTICLE_CONTEXT_SCHEMA_VERSION,
  MAX_ARTICLE_CONTEXT_BLOCKS,
  MAX_ARTICLE_CONTEXT_MANIFEST_BYTES,
  MAX_REPORTERS_PER_CONTEXT_BLOCK,
  assertArticleContextWriteAuthorized,
  clearArticleContextModerationForCtx,
  getArticleContextCacheForCtx,
  getLatestArticleContextCacheForCtx,
  getArticleContextModerationForCtx,
  listArticleContextReportsForCtx,
  removeArticleContextCacheForCtx,
  setArticleContextModerationForCtx,
  submitArticleContextReportForCtx,
  upsertArticleContextCacheForCtx,
  updateArticleContextReportStatusForCtx,
  validateAndNormalizeManifestJson,
} from "./articleContexts";
import {
  getArticleContextCacheForCtx as getArticleContextCacheForCtxFromCache,
  removeArticleContextCacheForCtx as removeArticleContextCacheForCtxFromCache,
} from "./articleContextCache";
import {
  getArticleContextModerationForCtx as getArticleContextModerationForCtxFromModeration,
} from "./articleContextModeration";
import {
  listArticleContextReportsForCtx as listArticleContextReportsForCtxFromReports,
} from "./articleContextReports";
import {
  validateAndNormalizeManifestJson as validateAndNormalizeManifestJsonFromValidation,
} from "./articleContextValidation";

type TableName =
  | "articleContextCaches"
  | "articleContextReports"
  | "articleContextModerations";

type StoredDoc = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

const createCtx = () => {
  const tables: Record<TableName, StoredDoc[]> = {
    articleContextCaches: [],
    articleContextReports: [],
    articleContextModerations: [],
  };
  let idCounter = 0;

  const selection = (docs: StoredDoc[]) => ({
    unique: async () => {
      if (docs.length > 1) throw new Error("Expected a unique result");
      return docs[0] ?? null;
    },
    first: async () => docs[0] ?? null,
    collect: async () => [...docs],
    order: (direction: "asc" | "desc") => {
      const ordered = [...docs].sort((left, right) =>
        direction === "desc"
          ? right._creationTime - left._creationTime
          : left._creationTime - right._creationTime,
      );
      return {
        take: async (limit: number) => ordered.slice(0, limit),
      };
    },
    take: async (limit: number) => docs.slice(0, limit),
  });

  const db = {
    query: (tableName: TableName) => ({
      withIndex: (
        _indexName: string,
        apply: (builder: {
          eq: (field: string, value: unknown) => unknown;
        }) => unknown,
      ) => {
        const filters: Array<[string, unknown]> = [];
        const builder = {
          eq: (field: string, value: unknown) => {
            filters.push([field, value]);
            return builder;
          },
        };
        apply(builder);
        return selection(
          tables[tableName].filter((doc) =>
            filters.every(([field, value]) => doc[field] === value),
          ),
        );
      },
      order: (direction: "asc" | "desc") =>
        selection(tables[tableName]).order(direction),
    }),
    insert: async (tableName: TableName, value: Record<string, unknown>) => {
      idCounter += 1;
      const id = `${tableName}-${idCounter}`;
      tables[tableName].push({
        _id: id,
        _creationTime: idCounter,
        ...value,
      });
      return id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      for (const table of Object.values(tables)) {
        const index = table.findIndex((doc) => doc._id === id);
        if (index >= 0) {
          table[index] = { ...table[index], ...value };
          return;
        }
      }
      throw new Error(`Missing document ${id}`);
    },
    delete: async (id: string) => {
      for (const tableName of Object.keys(tables) as TableName[]) {
        tables[tableName] = tables[tableName].filter((doc) => doc._id !== id);
      }
    },
    get: async (id: string) =>
      Object.values(tables)
        .flat()
        .find((doc) => doc._id === id) ?? null,
  };

  return {
    ctx: { db } as never,
    tables,
  };
};

const cacheKey = {
  wikiPageId: "736",
  revisionId: "123456789",
  extractorVersion: "2.0.0",
  sourceHash: "sha256:abc123",
};

const manifestJson = (
  key = cacheKey,
  blocks: Array<Record<string, unknown>> = [
    {
      id: "map-lead-1",
      kind: "map",
      title: "Example map",
      caption: "One place is shown.",
      longDescription: "The map identifies one place.",
      provenance: {
        sourceHash: key.sourceHash,
        extractorVersion: key.extractorVersion,
      },
    },
  ],
  extra: Record<string, unknown> = {},
) =>
  JSON.stringify({
    schemaVersion: ARTICLE_CONTEXT_SCHEMA_VERSION,
    wikiPageId: key.wikiPageId,
    revisionId: key.revisionId,
    extractorVersion: key.extractorVersion,
    sourceHash: key.sourceHash,
    blocks,
    ...extra,
  });

describe("article context service facade", () => {
  it("reexports the focused persistence helpers without wrapping them", () => {
    expect(getArticleContextCacheForCtx).toBe(
      getArticleContextCacheForCtxFromCache,
    );
    expect(removeArticleContextCacheForCtx).toBe(
      removeArticleContextCacheForCtxFromCache,
    );
    expect(getArticleContextModerationForCtx).toBe(
      getArticleContextModerationForCtxFromModeration,
    );
    expect(listArticleContextReportsForCtx).toBe(
      listArticleContextReportsForCtxFromReports,
    );
    expect(validateAndNormalizeManifestJson).toBe(
      validateAndNormalizeManifestJsonFromValidation,
    );
  });
});

describe("article context write authorization", () => {
  it("accepts a dedicated secret and falls back to the existing cron secret", () => {
    expect(() =>
      assertArticleContextWriteAuthorized("context-secret", {
        ARTICLE_CONTEXT_WRITE_SECRET: "context-secret",
      }),
    ).not.toThrow();
    expect(() =>
      assertArticleContextWriteAuthorized("cron-secret", {
        CRON_SECRET: "cron-secret",
      }),
    ).not.toThrow();
  });

  it("fails closed unless the local escape hatch is explicitly enabled", () => {
    expect(() =>
      assertArticleContextWriteAuthorized("wrong", {
        ARTICLE_CONTEXT_WRITE_SECRET: "right",
      }),
    ).toThrow("Unauthorized");
    expect(() => assertArticleContextWriteAuthorized("", {})).toThrow(
      "is not configured",
    );
    expect(() =>
      assertArticleContextWriteAuthorized("", {
        ARTICLE_CONTEXT_ALLOW_INSECURE_LOCAL_WRITES: "1",
      }),
    ).not.toThrow();
  });
});

describe("article context cache validation", () => {
  it("normalizes valid manifest JSON and derives trusted metadata", () => {
    const result = validateAndNormalizeManifestJson(
      JSON.stringify(JSON.parse(manifestJson()), null, 2),
      cacheKey,
    );

    expect(result.blockCount).toBe(1);
    expect(result.schemaVersion).toBe(ARTICLE_CONTEXT_SCHEMA_VERSION);
    expect(result.byteLength).toBeLessThan(manifestJson().length + 1);
    expect(JSON.parse(result.manifestJson)).toMatchObject({
      wikiPageId: cacheKey.wikiPageId,
      sourceHash: cacheKey.sourceHash,
    });
  });

  it("rejects malformed, mismatched, duplicate, oversized, and overfull payloads", () => {
    expect(() => validateAndNormalizeManifestJson("nope", cacheKey)).toThrow(
      "valid JSON",
    );
    expect(() =>
      validateAndNormalizeManifestJson(
        manifestJson(cacheKey, [], { schemaVersion: 1 }),
        cacheKey,
      ),
    ).toThrow("schemaVersion");
    expect(() =>
      validateAndNormalizeManifestJson(
        manifestJson({ ...cacheKey, revisionId: "different" }),
        cacheKey,
      ),
    ).toThrow("revisionId");

    const duplicate = {
      id: "same-id",
      kind: "timeline",
      title: "Duplicate timeline",
      caption: "Three events are shown.",
      longDescription: "The timeline contains three events.",
      provenance: {
        sourceHash: cacheKey.sourceHash,
        extractorVersion: cacheKey.extractorVersion,
      },
    };
    expect(() =>
      validateAndNormalizeManifestJson(
        manifestJson(cacheKey, [duplicate, duplicate]),
        cacheKey,
      ),
    ).toThrow("Duplicate context block id");

    const tooMany = Array.from(
      { length: MAX_ARTICLE_CONTEXT_BLOCKS + 1 },
      (_, index) => ({
        ...duplicate,
        id: `timeline-${index}`,
      }),
    );
    expect(() =>
      validateAndNormalizeManifestJson(
        manifestJson(cacheKey, tooMany),
        cacheKey,
      ),
    ).toThrow("more than");

    expect(() =>
      validateAndNormalizeManifestJson(
        manifestJson(cacheKey, [], {
          padding: "x".repeat(MAX_ARTICLE_CONTEXT_MANIFEST_BYTES),
        }),
        cacheKey,
      ),
    ).toThrow("may not exceed");
  });

  it("rejects legacy audio-copy fields from schema-v2 cache writes", () => {
    const parsed = JSON.parse(manifestJson()) as {
      blocks: Array<Record<string, unknown>>;
    };
    parsed.blocks[0].spokenSummary = "Legacy narration";

    expect(() =>
      validateAndNormalizeManifestJson(JSON.stringify(parsed), cacheKey),
    ).toThrow("legacy audio copy");
  });
});

describe("article context cache persistence", () => {
  it("upserts an exact revision/hash key and reads it back", async () => {
    const { ctx, tables } = createCtx();
    const first = await upsertArticleContextCacheForCtx(ctx, {
      ...cacheKey,
      manifestJson: manifestJson(),
      now: 100,
    });
    const second = await upsertArticleContextCacheForCtx(ctx, {
      ...cacheKey,
      manifestJson: manifestJson(cacheKey, []),
      now: 200,
    });
    const cached = await getArticleContextCacheForCtx(ctx, cacheKey);

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, cacheId: first.cacheId });
    expect(cached).toMatchObject({ blockCount: 0, updatedAt: 200 });
    expect(tables.articleContextCaches).toHaveLength(1);
  });

  it("retains only a small number of source variants per revision", async () => {
    const { ctx, tables } = createCtx();
    for (let index = 0; index < 6; index += 1) {
      const key = { ...cacheKey, sourceHash: `sha256:variant${index}` };
      await upsertArticleContextCacheForCtx(ctx, {
        ...key,
        manifestJson: manifestJson(key),
        now: index + 1,
      });
    }

    expect(tables.articleContextCaches).toHaveLength(4);
    expect(tables.articleContextCaches.map((doc) => doc.sourceHash)).toEqual([
      "sha256:variant2",
      "sha256:variant3",
      "sha256:variant4",
      "sha256:variant5",
    ]);
    await expect(
      getLatestArticleContextCacheForCtx(ctx, {
        wikiPageId: cacheKey.wikiPageId,
        revisionId: cacheKey.revisionId,
        extractorVersion: cacheKey.extractorVersion,
      }),
    ).resolves.toMatchObject({ sourceHash: "sha256:variant5" });
  });

  it("removes only the exact cache variant and reports whether it existed", async () => {
    const { ctx, tables } = createCtx();
    const otherKey = { ...cacheKey, sourceHash: "sha256:other" };
    await upsertArticleContextCacheForCtx(ctx, {
      ...cacheKey,
      manifestJson: manifestJson(),
      now: 100,
    });
    await upsertArticleContextCacheForCtx(ctx, {
      ...otherKey,
      manifestJson: manifestJson(otherKey),
      now: 200,
    });

    await expect(removeArticleContextCacheForCtx(ctx, cacheKey)).resolves.toBe(
      true,
    );
    await expect(getArticleContextCacheForCtx(ctx, cacheKey)).resolves.toBeNull();
    await expect(
      getArticleContextCacheForCtx(ctx, otherKey),
    ).resolves.toMatchObject({ sourceHash: otherKey.sourceHash });
    await expect(removeArticleContextCacheForCtx(ctx, cacheKey)).resolves.toBe(
      false,
    );
    expect(tables.articleContextCaches).toHaveLength(1);
  });
});

describe("article context reports and moderation", () => {
  const blockKey = {
    wikiPageId: cacheKey.wikiPageId,
    revisionId: cacheKey.revisionId,
    blockId: "map-lead-1",
    sourceHash: cacheKey.sourceHash,
  };

  it("deduplicates repeat reports from the same opaque reporter key", async () => {
    const { ctx, tables } = createCtx();
    const first = await submitArticleContextReportForCtx(ctx, {
      ...blockKey,
      reporterKey: "reporter-hash-1",
      reason: "accessibility",
      details: "The keyboard order is confusing.",
      now: 100,
    });
    const second = await submitArticleContextReportForCtx(ctx, {
      ...blockKey,
      reporterKey: "reporter-hash-1",
      reason: "broken",
      now: 200,
    });

    expect(first.created).toBe(true);
    expect(second).toMatchObject({ created: false, reportId: first.reportId });
    expect(tables.articleContextReports).toHaveLength(1);
    expect(tables.articleContextReports[0]).toMatchObject({
      reason: "broken",
      occurrences: 2,
      status: "open",
      updatedAt: 200,
    });
  });

  it("requires useful detail for the catch-all report reason", async () => {
    const { ctx } = createCtx();
    await expect(
      submitArticleContextReportForCtx(ctx, {
        ...blockKey,
        reporterKey: "reporter-hash-1",
        reason: "other",
      }),
    ).rejects.toThrow("require details");
  });

  it("does not let resolved or dismissed reports consume active intake capacity", async () => {
    const { ctx, tables } = createCtx();
    for (let index = 0; index < MAX_REPORTERS_PER_CONTEXT_BLOCK; index += 1) {
      const { reportId } = await submitArticleContextReportForCtx(ctx, {
        ...blockKey,
        reporterKey: `closed-reporter-${index}`,
        reason: "broken",
        now: index,
      });
      await updateArticleContextReportStatusForCtx(ctx, {
        reportId,
        status: index % 2 === 0 ? "resolved" : "dismissed",
        now: index + 1,
      });
    }

    await expect(
      submitArticleContextReportForCtx(ctx, {
        ...blockKey,
        reporterKey: "new-active-reporter",
        reason: "accessibility",
      }),
    ).resolves.toMatchObject({ created: true });
    expect(tables.articleContextReports).toHaveLength(
      MAX_REPORTERS_PER_CONTEXT_BLOCK + 1,
    );
  });

  it("continues to cap the combined open and reviewing report queue", async () => {
    const { ctx } = createCtx();
    const closed = await submitArticleContextReportForCtx(ctx, {
      ...blockKey,
      reporterKey: "reporter-to-reopen",
      reason: "broken",
      now: 0,
    });
    await updateArticleContextReportStatusForCtx(ctx, {
      reportId: closed.reportId,
      status: "resolved",
      now: 1,
    });

    for (let index = 0; index < MAX_REPORTERS_PER_CONTEXT_BLOCK; index += 1) {
      const { reportId } = await submitArticleContextReportForCtx(ctx, {
        ...blockKey,
        reporterKey: `active-reporter-${index}`,
        reason: "inaccurate",
        now: index,
      });
      if (index % 2 === 1) {
        await updateArticleContextReportStatusForCtx(ctx, {
          reportId,
          status: "reviewing",
          now: index + 1,
        });
      }
    }

    await expect(
      submitArticleContextReportForCtx(ctx, {
        ...blockKey,
        reporterKey: "over-limit-reporter",
        reason: "broken",
      }),
    ).rejects.toThrow("report intake limit");
    await expect(
      submitArticleContextReportForCtx(ctx, {
        ...blockKey,
        reporterKey: "reporter-to-reopen",
        reason: "accessibility",
      }),
    ).rejects.toThrow("report intake limit");
  });

  it("lists reports newest-first with status filtering and bounded limits", async () => {
    const { ctx } = createCtx();
    await submitArticleContextReportForCtx(ctx, {
      ...blockKey,
      reporterKey: "reporter-1",
      reason: "broken",
      now: 100,
    });
    const second = await submitArticleContextReportForCtx(ctx, {
      ...blockKey,
      reporterKey: "reporter-2",
      reason: "misleading",
      now: 200,
    });
    await updateArticleContextReportStatusForCtx(ctx, {
      reportId: second.reportId,
      status: "resolved",
      now: 250,
    });
    await submitArticleContextReportForCtx(ctx, {
      ...blockKey,
      reporterKey: "reporter-3",
      reason: "accessibility",
      now: 300,
    });

    await expect(
      listArticleContextReportsForCtx(ctx, { status: "open", limit: 1 }),
    ).resolves.toEqual([
      expect.objectContaining({ reporterKey: "reporter-3", status: "open" }),
    ]);
    await expect(
      listArticleContextReportsForCtx(ctx, { limit: 2 }),
    ).resolves.toEqual([
      expect.objectContaining({ reporterKey: "reporter-3" }),
      expect.objectContaining({ reporterKey: "reporter-2" }),
    ]);
  });

  it("supports owner suppression, bounded text overrides, and clearing", async () => {
    const { ctx } = createCtx();
    await setArticleContextModerationForCtx(ctx, {
      ...blockKey,
      mode: "suppress",
      note: "Source data needs review.",
      now: 100,
    });
    expect(await getArticleContextModerationForCtx(ctx, blockKey)).toMatchObject(
      { mode: "suppress", updatedAt: 100 },
    );

    await setArticleContextModerationForCtx(ctx, {
      ...blockKey,
      mode: "override",
      override: {
        caption: "A corrected visual caption.",
      },
      now: 200,
    });
    expect(await getArticleContextModerationForCtx(ctx, blockKey)).toEqual({
      mode: "override",
      override: {
        title: undefined,
        caption: "A corrected visual caption.",
        longDescription: undefined,
      },
      updatedAt: 200,
    });

    await clearArticleContextModerationForCtx(ctx, { ...blockKey, now: 300 });
    expect(await getArticleContextModerationForCtx(ctx, blockKey)).toBeNull();
  });

  it("maps legacy stored takeaway overrides to caption and ignores spokenSummary", async () => {
    const { ctx, tables } = createCtx();
    tables.articleContextModerations.push({
      _id: "articleContextModerations-legacy",
      _creationTime: 1,
      ...blockKey,
      mode: "override",
      status: "active",
      override: {
        takeaway: "Legacy owner caption.",
        spokenSummary: "Legacy narration must stay retired.",
      },
      createdAt: 100,
      updatedAt: 200,
    });

    await expect(
      getArticleContextModerationForCtx(ctx, blockKey),
    ).resolves.toEqual({
      mode: "override",
      override: {
        title: undefined,
        caption: "Legacy owner caption.",
        longDescription: undefined,
      },
      updatedAt: 200,
    });
  });

  it("does not accept legacy audio fields in new moderation writes", async () => {
    const { ctx } = createCtx();

    await expect(
      setArticleContextModerationForCtx(ctx, {
        ...blockKey,
        mode: "override",
        override: {
          spokenSummary: "A retired field.",
        } as never,
      }),
    ).rejects.toThrow("at least one replacement text field");
  });

  it("does not permit a suppression record to smuggle in override content", async () => {
    const { ctx } = createCtx();
    await expect(
      setArticleContextModerationForCtx(ctx, {
        ...blockKey,
        mode: "suppress",
        override: { title: "Surprise" },
      }),
    ).rejects.toThrow("cannot include");
  });
});
