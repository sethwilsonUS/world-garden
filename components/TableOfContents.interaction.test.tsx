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
  {
    title: "History",
    level: 2,
    content: "A detailed history with enough words for an audio estimate.",
    audioMode: "full",
    audioReason: "eligible",
  },
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
}: {
  value: DataContextValue;
  wikiPageId?: string;
  initialRate?: PlaybackRate;
}) => {
  const [rate, setRate] = useState<PlaybackRate>(initialRate);
  return (
    <DataContext.Provider value={value}>
      <TableOfContents
        articleTitle="Example article"
        wikiPageId={wikiPageId}
        summaryText="A summary with enough words to estimate audio duration."
        sections={sections}
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
      '[aria-label="Playback speed 3x. Click to change."]',
    ) as HTMLButtonElement;
    expect(speed).not.toBeNull();

    act(() => speed.click());
    await waitForExpectation(() => {
      expect(
        container.querySelector(
          '[aria-label="Playback speed 0.5x. Click to change."]',
        ),
      ).not.toBeNull();
      expect(container.textContent).toContain("Playback speed 0.5x");
      expect(container.textContent).toContain("4m");
    });
  });

  it("loads details independently and closes stale panels on article change", async () => {
    const value = dataValue({
      getSectionLinkCounts: vi.fn(async ({ wikiPageId }) =>
        wikiPageId === "1" ? [{ title: "History", count: 2 }] : [],
      ),
      getCitationCounts: vi.fn(async ({ wikiPageId }) =>
        wikiPageId === "1" ? [{ title: "History", count: 1 }] : [],
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
});
