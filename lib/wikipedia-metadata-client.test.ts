import { describe, expect, it, vi } from "vitest";
import type {
  WikipediaParsedPageData,
  WikipediaRevisionIdentity,
} from "./wikipedia-contracts";
import {
  createCoalescedMetadataMethods,
  createRevisionMetadataClient,
  projectCitationCounts,
  projectSectionCitations,
} from "./wikipedia-metadata-client";

const sampleIdentity: WikipediaRevisionIdentity = {
  wikiPageId: "974",
  revisionId: "12345",
  title: "Ada Lovelace",
  language: "en",
};

const sampleMetadata: WikipediaParsedPageData = {
  linkCounts: [
    { index: "__summary__", title: "__summary__", count: 3 },
    { index: "1", title: "Early life", count: 5 },
  ],
  citations: [
    { id: "cite_note-1", index: 1, text: "First source." },
    { id: "cite_note-2", index: 2, text: "Second source." },
  ],
  sectionCitations: [
    {
      index: "__summary__",
      title: "__summary__",
      count: 1,
      citationIds: ["cite_note-1"],
    },
    {
      index: "1",
      title: "Early life",
      count: 1,
      citationIds: ["cite_note-2"],
    },
  ],
  sectionIndexMap: [{ title: "Early life", index: "1" }],
  images: [
    {
      src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada.jpg/330px-Ada.jpg",
      lightboxSrc:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Ada.jpg/1600px-Ada.jpg",
      lightboxWidth: 1600,
      lightboxHeight: 2000,
      alt: "Portrait of Ada Lovelace",
      caption: "Ada Lovelace in 1840",
    },
  ],
};

describe("lib/wikipedia-metadata-client", () => {
  it("coalesces concurrent link counts, citation counts, gallery images, and subsequent section citations into one load", async () => {
    let finishLoad: ((data: WikipediaParsedPageData) => void) | undefined;
    const loadMetadata = vi.fn(
      () =>
        new Promise<WikipediaParsedPageData>((resolve) => {
          finishLoad = resolve;
        }),
    );
    const client = createRevisionMetadataClient(loadMetadata);
    const methods = createCoalescedMetadataMethods(client);

    const linkCountsPromise = methods.getSectionLinkCounts({
      identity: sampleIdentity,
    });
    const citationCountsPromise = methods.getCitationCounts({
      identity: sampleIdentity,
    });
    const imagesPromise = methods.getArticleImages({
      identity: sampleIdentity,
    });

    expect(loadMetadata).toHaveBeenCalledTimes(1);
    expect(loadMetadata).toHaveBeenCalledWith(sampleIdentity);

    finishLoad?.(sampleMetadata);

    await expect(linkCountsPromise).resolves.toEqual(sampleMetadata.linkCounts);
    await expect(citationCountsPromise).resolves.toEqual(
      projectCitationCounts(sampleMetadata),
    );
    await expect(imagesPromise).resolves.toEqual(sampleMetadata.images);

    await expect(
      methods.getSectionCitations({
        identity: sampleIdentity,
        sectionTitle: "Early life",
        sectionIndex: "1",
      }),
    ).resolves.toEqual(
      projectSectionCitations(sampleMetadata, {
        sectionTitle: "Early life",
        sectionIndex: "1",
      }),
    );
    expect(loadMetadata).toHaveBeenCalledTimes(1);
  });

  it("isolates caller cancellation without poisoning sibling consumers or emitting unhandled rejections", async () => {
    let rejectLoad: ((reason: unknown) => void) | undefined;
    const loadMetadata = vi
      .fn<() => Promise<WikipediaParsedPageData>>()
      .mockImplementationOnce(
        () =>
          new Promise<WikipediaParsedPageData>((_resolve, reject) => {
            rejectLoad = reject;
          }),
      )
      .mockResolvedValueOnce(sampleMetadata);

    const client = createRevisionMetadataClient(loadMetadata);
    const controller = new AbortController();
    const reason = new DOMException("Unmounted", "AbortError");

    const pending = client.requestMetadata(sampleIdentity, controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);

    // Underlying failure after sole caller aborted must evict cleanly and not poison retries.
    rejectLoad?.(new Error("transient network error"));
    await Promise.resolve();
    await Promise.resolve();

    await expect(client.requestMetadata(sampleIdentity)).resolves.toEqual(
      sampleMetadata,
    );
    expect(loadMetadata).toHaveBeenCalledTimes(2);
  });

  it("deduplicates canonical identities, evicts oldest cache entries, and handles reset cleanly", async () => {
    const loadMetadata = vi.fn(async () => sampleMetadata);
    const client = createRevisionMetadataClient(loadMetadata, {
      maxEntries: 2,
    });

    await client.requestMetadata({
      wikiPageId: "000974",
      revisionId: "00012345",
      title: "Ada_Lovelace",
      language: "EN",
    });
    await client.requestMetadata(sampleIdentity);
    expect(loadMetadata).toHaveBeenCalledTimes(1);

    const second: WikipediaRevisionIdentity = {
      wikiPageId: "2",
      revisionId: "20",
      title: "Second",
      language: "en",
    };
    const third: WikipediaRevisionIdentity = {
      wikiPageId: "3",
      revisionId: "30",
      title: "Third",
      language: "en",
    };
    await client.requestMetadata(second);
    await client.requestMetadata(third);
    expect(loadMetadata).toHaveBeenCalledTimes(3);

    // Entry 1 (sampleIdentity) was evicted when entry 3 exceeded maxEntries=2.
    await client.requestMetadata(sampleIdentity);
    expect(loadMetadata).toHaveBeenCalledTimes(4);

    client.reset();
    await client.requestMetadata(sampleIdentity);
    expect(loadMetadata).toHaveBeenCalledTimes(5);
  });
});
