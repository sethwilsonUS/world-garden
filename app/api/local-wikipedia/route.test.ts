import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  WikipediaParsedPageData,
  WikipediaRevisionIdentity,
} from "@/lib/wikipedia-contracts";

const {
  searchWikipedia,
  fetchArticleByTitle,
  fetchArticleBadgeKeys,
  fetchParsedPageData,
  fetchSectionLinksByIndex,
} = vi.hoisted(() => ({
  searchWikipedia: vi.fn(),
  fetchArticleByTitle: vi.fn(),
  fetchArticleBadgeKeys: vi.fn(),
  fetchParsedPageData: vi.fn(),
  fetchSectionLinksByIndex: vi.fn(),
}));

vi.mock("@/convex/lib/wikipedia", () => ({
  searchWikipedia,
  fetchArticleByTitle,
  fetchArticleBadgeKeys,
  fetchParsedPageData,
  fetchSectionLinksByIndex,
}));

import { POST } from "./route";

const emptyParsedData = (
  sectionIndexMap: WikipediaParsedPageData["sectionIndexMap"] = [],
): WikipediaParsedPageData => ({
  linkCounts: [],
  citations: [],
  sectionCitations: [],
  sectionIndexMap,
  images: [],
});

const identity = (
  wikiPageId: string,
  revisionId: string,
): WikipediaRevisionIdentity => ({
  wikiPageId,
  revisionId,
  title: `Article ${wikiPageId}`,
  language: "en",
});

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/local-wikipedia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/local-wikipedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
    vi.stubEnv("LOCAL_MODE", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("is unavailable when local mode is disabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "false");
    const response = await post({ operation: "search", term: "Landor" });

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(searchWikipedia).not.toHaveBeenCalled();
  });

  it("rejects incomplete or mutable article identities", async () => {
    const response = await post({
      operation: "metadata",
      identity: {
        wikiPageId: "42",
        title: "Missing revision",
        language: "en",
      },
    });

    expect(response.status).toBe(400);
    expect(fetchParsedPageData).not.toHaveBeenCalled();
  });

  it("keeps parsed metadata cached by both page and revision", async () => {
    fetchParsedPageData.mockImplementation(async () => emptyParsedData());
    const firstRevision = identity("4101", "501");
    const nextRevision = identity("4101", "502");

    const first = await post({
      operation: "metadata",
      identity: firstRevision,
    });
    const repeated = await post({
      operation: "metadata",
      identity: firstRevision,
    });
    const changed = await post({
      operation: "metadata",
      identity: nextRevision,
    });

    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(changed.status).toBe(200);
    expect(fetchParsedPageData).toHaveBeenCalledTimes(2);
    expect(fetchParsedPageData).toHaveBeenNthCalledWith(1, firstRevision);
    expect(fetchParsedPageData).toHaveBeenNthCalledWith(2, nextRevision);
  });

  it("does not let a failed parse poison the revision cache", async () => {
    const articleIdentity = identity("4151", "551");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchParsedPageData
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce(emptyParsedData());

    const failed = await post({
      operation: "metadata",
      identity: articleIdentity,
    });
    const retried = await post({
      operation: "metadata",
      identity: articleIdentity,
    });

    expect(failed.status).toBe(502);
    expect(retried.status).toBe(200);
    expect(fetchParsedPageData).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("uses a caller-supplied MediaWiki section index without title matching", async () => {
    const articleIdentity = identity("4171", "571");
    fetchSectionLinksByIndex.mockResolvedValue([
      { wikiPageId: "98", title: "Indexed article" },
    ]);

    const response = await post({
      operation: "section-links",
      identity: articleIdentity,
      sectionTitle: "A duplicate heading",
      sectionIndex: "12",
    });

    expect(response.status).toBe(200);
    expect(fetchParsedPageData).not.toHaveBeenCalled();
    expect(fetchSectionLinksByIndex).toHaveBeenCalledWith(
      articleIdentity,
      "12",
    );
  });

  it("resolves section links from revision-matched section metadata", async () => {
    const articleIdentity = identity("4201", "601");
    fetchParsedPageData.mockResolvedValue(
      emptyParsedData([{ title: "Early life", index: "7" }]),
    );
    fetchSectionLinksByIndex.mockResolvedValue([
      { wikiPageId: "99", title: "Linked article" },
    ]);

    const response = await post({
      operation: "section-links",
      identity: articleIdentity,
      sectionTitle: "  EARLY   LIFE ",
    });
    const repeated = await post({
      operation: "section-links",
      identity: articleIdentity,
      sectionTitle: "Early life",
    });

    expect(response.status).toBe(200);
    expect(repeated.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: [{ wikiPageId: "99", title: "Linked article" }],
    });
    expect(fetchParsedPageData).toHaveBeenCalledWith(articleIdentity);
    expect(fetchSectionLinksByIndex).toHaveBeenCalledWith(articleIdentity, "7");
    expect(fetchSectionLinksByIndex).toHaveBeenCalledTimes(1);
  });

  it("keeps search and article retrieval behind the server boundary", async () => {
    searchWikipedia.mockResolvedValue([
      {
        wikiPageId: "4401",
        title: "Walter Savage Landor",
        description: "English writer",
        url: "https://en.wikipedia.org/wiki/Walter_Savage_Landor",
      },
    ]);
    fetchArticleByTitle.mockResolvedValue({
      ...identity("4401", "701"),
      narrationVersion: 4,
      summary: "English writer.",
      sections: [],
      contentText: "server-only legacy source",
    });
    fetchArticleBadgeKeys.mockResolvedValue(["biography"]);

    const searchResponse = await post({ operation: "search", term: "Landor" });
    const articleResponse = await post({
      operation: "article",
      slug: "Walter_Savage_Landor",
    });

    expect(searchResponse.status).toBe(200);
    expect(searchWikipedia).toHaveBeenCalledWith("Landor");
    expect(fetchArticleByTitle).toHaveBeenCalledWith("Walter Savage Landor");
    const articlePayload = await articleResponse.json();
    expect(articlePayload.data).toMatchObject({
      wikiPageId: "4401",
      revisionId: "701",
      badgeKeys: ["biography"],
    });
    expect(articlePayload.data).not.toHaveProperty("contentText");
  });
});
