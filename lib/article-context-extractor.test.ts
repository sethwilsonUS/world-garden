import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaWikiDocument } from "./mediawiki-document";

const loadMediaWikiDocument = vi.hoisted(() => vi.fn());

vi.mock("./mediawiki-document", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mediawiki-document")>();
  return { ...actual, loadMediaWikiDocument };
});

import {
  ArticleContextInputError,
  ArticleContextUpstreamError,
  fetchArticleContextManifest,
  normalizeArticleContextRequest,
  parseContextDateRange,
  sanitizeContextCaption,
  sanitizeContextText,
} from "./article-context-extractor";
import { MediaWikiSourceError } from "./mediawiki-document";

const request = {
  wikiPageId: "123",
  title: "Example article",
  revisionId: "456",
  language: "en",
} as const;

const emptyDocument = (): MediaWikiDocument => ({
  schemaVersion: 1,
  identity: request,
  sourceFormat: "parsoid",
  sourceHash: "source-hash",
  documentHash: "document-hash",
  citations: [],
  issues: [],
  sections: [
    {
      key: "__summary__",
      title: "Summary",
      level: 0,
      sourceOrder: 0,
      role: "body",
      fidelity: "complete",
      plaintextContent: "An example.",
      fallback: { text: "An example.", source: "dom-text" },
      links: [],
      citationIds: [],
      blocks: [],
    },
  ],
});

describe("article context extractor boundary", () => {
  beforeEach(() => {
    loadMediaWikiDocument.mockReset();
    loadMediaWikiDocument.mockResolvedValue(emptyDocument());
  });

  it("normalizes the public revision identity and rejects unsupported input", () => {
    expect(
      normalizeArticleContextRequest({
        ...request,
        wikiPageId: " 000123 ",
        revisionId: " 000456 ",
        title: " Example article ",
      }),
    ).toEqual(request);
    try {
      normalizeArticleContextRequest({ ...request, wikiPageId: "1 OR 1=1" });
      throw new Error("Expected invalid page identity to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ArticleContextInputError);
      expect(error).toMatchObject({
        name: "ArticleContextInputError",
        message: "wikiPageId must be a positive numeric ID",
      });
    }
    expect(() =>
      normalizeArticleContextRequest({ ...request, language: "fr" }),
    ).toThrow(ArticleContextInputError);
  });

  it("retains the compact scalar/date/caption helpers", () => {
    expect(sanitizeContextText("  Drive-Thru \n Records  ")).toBe(
      "Drive-Thru Records",
    );
    expect(sanitizeContextText("<script>alert(1)</script>")).toBe(
      "script alert(1) /script",
    );
    expect(sanitizeContextCaption("→ Alpha ↔ Beta")).toBe("Alpha and Beta");
    expect(parseContextDateRange("July 20, 1969")).toMatchObject({
      start: { iso: "1969-07-20", precision: "day" },
    });
    expect(
      parseContextDateRange("29/02/2023", { numericFormat: "dmy" }),
    ).toBeNull();
  });

  it("loads only the revision-pinned semantic document", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const controller = new AbortController();
    const manifest = await fetchArticleContextManifest(request, {
      fetchImpl,
      signal: controller.signal,
      now: () => new Date("2026-07-25T12:00:00.000Z"),
    });

    expect(loadMediaWikiDocument).toHaveBeenCalledOnce();
    expect(loadMediaWikiDocument).toHaveBeenCalledWith(request, {
      fetchImpl,
      signal: controller.signal,
    });
    expect(manifest).toMatchObject({
      schemaVersion: 3,
      wikiPageId: "123",
      revisionId: "456",
      sourceHash: "document-hash",
      generatedAt: "2026-07-25T12:00:00.000Z",
      blocks: [],
    });
  });

  it("maps semantic source failures onto the existing route error contract", async () => {
    loadMediaWikiDocument.mockRejectedValueOnce(
      new MediaWikiSourceError({
        code: "identity-mismatch",
        message: "Wikipedia returned a different revision",
        statusCode: 409,
      }),
    );

    await expect(fetchArticleContextManifest(request)).rejects.toMatchObject({
      constructor: ArticleContextUpstreamError,
      message: "Wikipedia returned a different revision",
      statusCode: 409,
    });
  });
});
