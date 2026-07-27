// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DataContext,
  type DataContextValue,
  type Section,
} from "@/lib/data-context";
import type { AudioPlaybackState } from "@/lib/article-audio-playback";
import { type PlaybackRate } from "@/hooks/usePlaybackRate";
import { createTestSection } from "@/lib/test-section-narration";
import { ARTICLE_SECTION_NARRATION_VERSION } from "@/lib/section-narration";
import { TableOfContents } from "./TableOfContents";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const idlePlayback: AudioPlaybackState = {
  status: "idle",
  sectionKey: null,
  sectionIdx: null,
  label: null,
  mode: "single",
  slowLoading: false,
};

const sections: Section[] = [
  createTestSection({
    title: "History",
    level: 2,
    content: "A detailed history with enough words for an audio estimate.",
  }),
];

const dataValue = (
  overrides: Partial<DataContextValue> = {},
): DataContextValue => ({
  search: async () => [],
  fetchArticle: async () => {
    throw new Error("not used");
  },
  getSectionLinkCounts: async () => [],
  getCitationCounts: async () => [],
  getSectionLinks: async () => [],
  getSectionCitations: async () => [],
  getArticleImages: async () => [],
  ...overrides,
});

const waitForExpectation = async (assertion: () => void) => {
  await vi.waitFor(
    async () => {
      await act(async () => {
        await Promise.resolve();
      });
      assertion();
    },
    { interval: 1, timeout: 1_000 },
  );
};

const TableHarness = ({
  value,
  wikiPageId = "1",
  initialRate = 1,
  articleSections = sections,
}: {
  value: DataContextValue;
  wikiPageId?: string;
  initialRate?: PlaybackRate;
  articleSections?: Section[];
}) => {
  const [rate, setRate] = useState<PlaybackRate>(initialRate);
  return (
    <DataContext.Provider value={value}>
      <TableOfContents
        identity={{
          wikiPageId,
          revisionId: `revision-${wikiPageId}`,
          title: "Example article",
          language: "en",
          narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
        }}
        summaryText="A summary with enough words to estimate audio duration."
        sections={articleSections}
        sectionDurations={{ summary: 120, "section-0": 60 }}
        playback={idlePlayback}
        onListenSection={() => {}}
        onListenSummary={() => {}}
        onPlayAll={() => {}}
        onStopPlayAll={() => {}}
        playbackRate={rate}
        onPlaybackRateChange={setRate}
      />
    </DataContext.Provider>
  );
};

describe("TableOfContents interactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("cycles and announces playback speed with controlled state", async () => {
    const value = dataValue();
    await act(async () =>
      root.render(<TableHarness value={value} initialRate={3} />),
    );
    const speed = container.querySelector(
      '[aria-label="Playback speed 3x. Activate to change."]',
    ) as HTMLButtonElement;
    expect(speed).not.toBeNull();

    act(() => speed.click());
    await waitForExpectation(() => {
      expect(
        container.querySelector(
          '[aria-label="Playback speed 0.5x. Activate to change."]',
        ),
      ).not.toBeNull();
      expect(container.textContent).toContain("Playback speed 0.5x");
      expect(container.textContent).toContain("4m");
    });
  });

  it("loads details independently and closes stale panels on article change", async () => {
    const value = dataValue({
      getSectionLinkCounts: vi.fn(async ({ identity }) =>
        identity.wikiPageId === "1" ? [{ title: "History", count: 2 }] : [],
      ),
      getCitationCounts: vi.fn(async ({ identity }) =>
        identity.wikiPageId === "1" ? [{ title: "History", count: 1 }] : [],
      ),
      getSectionLinks: vi.fn(async () => [
        { wikiPageId: "linked", title: "Linked article" },
      ]),
      getSectionCitations: vi.fn(async () => [
        { id: "citation", index: 1, text: "A cited source" },
      ]),
    });
    await act(async () =>
      root.render(<TableHarness value={value} wikiPageId="1" />),
    );
    await waitForExpectation(() =>
      expect(
        container.querySelector('[aria-label="2 links · 1 citation"]'),
      ).not.toBeNull(),
    );
    const details = container.querySelector(
      '[aria-label="2 links · 1 citation"]',
    ) as HTMLButtonElement;
    expect(details.getAttribute("aria-expanded")).toBe("false");

    act(() => details.click());
    await waitForExpectation(() => {
      expect(details.getAttribute("aria-expanded")).toBe("true");
      expect(container.textContent).toContain("Linked article");
      expect(container.textContent).toContain("A cited source");
      expect(value.getSectionLinks).toHaveBeenCalledWith({
        identity: {
          wikiPageId: "1",
          revisionId: "revision-1",
          title: "Example article",
          language: "en",
        },
        sectionTitle: "History",
        sectionIndex: "1",
        signal: expect.any(AbortSignal),
      });
    });

    await act(async () =>
      root.render(<TableHarness value={value} wikiPageId="2" />),
    );
    expect(
      container.querySelector('[aria-label="2 links · 1 citation"]'),
    ).toBeNull();
    expect(container.textContent).not.toContain("Linked article");
    expect(container.textContent).not.toContain("A cited source");
  });

  it("opens metadata for the correct one of two identically titled sections", async () => {
    const duplicateSections: Section[] = [
      createTestSection({
        wikiSectionIndex: "3",
        title: "History",
        content: "The first history section.",
      }),
      createTestSection({
        wikiSectionIndex: "8",
        title: "History",
        content: "The second history section.",
      }),
    ];
    const getSectionCitations = vi.fn(async () => [
      { id: "second", index: 2, text: "Second History source" },
    ]);
    const value = dataValue({
      getSectionLinkCounts: async () => [
        { index: "3", title: "History", count: 1 },
        { index: "8", title: "History", count: 2 },
      ],
      getCitationCounts: async () => [
        { index: "3", title: "History", count: 1 },
        { index: "8", title: "History", count: 3 },
      ],
      getSectionLinks: async () => [
        { wikiPageId: "linked-second", title: "Second linked article" },
      ],
      getSectionCitations,
    });

    await act(async () =>
      root.render(
        <TableHarness value={value} articleSections={duplicateSections} />,
      ),
    );
    await waitForExpectation(() => {
      expect(
        container.querySelector('[aria-label="1 link · 1 citation"]'),
      ).not.toBeNull();
      expect(
        container.querySelector('[aria-label="2 links · 3 citations"]'),
      ).not.toBeNull();
    });

    act(() =>
      (
        container.querySelector(
          '[aria-label="2 links · 3 citations"]',
        ) as HTMLButtonElement
      ).click(),
    );

    await waitForExpectation(() =>
      expect(getSectionCitations).toHaveBeenCalledWith({
        identity: {
          wikiPageId: "1",
          revisionId: "revision-1",
          title: "Example article",
          language: "en",
        },
        sectionTitle: "History",
        sectionIndex: "8",
        signal: expect.any(AbortSignal),
      }),
    );
  });
});
