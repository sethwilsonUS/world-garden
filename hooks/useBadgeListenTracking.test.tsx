// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBadgeListenTracking } from "./useBadgeListenTracking";
import type { AwardedBadgeProgress } from "@/lib/badges";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

type HarnessProps = {
  audio: HTMLAudioElement;
  trackingSectionKey: string | null;
  isPlaying: boolean;
  reportProgress: (args: unknown) => Promise<unknown>;
  onBadgesAwarded?: (args: {
    articleTitle: string;
    badges: AwardedBadgeProgress[];
  }) => void;
};

const articleId = "article-1" as never;

const Harness = ({
  audio,
  trackingSectionKey,
  isPlaying,
  reportProgress,
  onBadgesAwarded,
}: HarnessProps) => {
  useBadgeListenTracking({
    articleId,
    wikiPageId: "wiki-1",
    slug: "Roman_roads",
    title: "Roman roads",
    summaryText: "One two three four five six seven eight nine ten.",
    sections: [
      {
        title: "Roads",
        level: 2,
        content: "One two three four five six seven eight nine ten.",
        audioMode: "full",
        audioReason: "eligible",
      },
      {
        title: "Aqueducts",
        level: 2,
        content: "One two three four five six seven eight nine ten.",
        audioMode: "full",
        audioReason: "eligible",
      },
    ],
    sectionDurations: {
      summary: 10,
      "section-0": 10,
      "section-1": 10,
    },
    trackingSectionKey,
    audioDurationSeconds: 10,
    isPlaying,
    audioRef: { current: audio },
    reportProgress,
    onBadgesAwarded,
  });

  return null;
};

type MutableAudioStub = {
  currentTime: number;
  paused: boolean;
  playbackRate: number;
};

const createAudioStub = (): HTMLAudioElement & MutableAudioStub =>
  ({
    currentTime: 0,
    paused: false,
    playbackRate: 1,
  } as HTMLAudioElement & MutableAudioStub);

describe("useBadgeListenTracking", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  it("flushes heard ranges when playback pauses", async () => {
    const audio = createAudioStub();
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          reportProgress={reportProgress}
        />,
      );
    });

    await act(async () => {
      audio.currentTime = 1.2;
      vi.advanceTimersByTime(1_000);
      audio.currentTime = 2.1;
      vi.advanceTimersByTime(1_000);
      audio.paused = true;
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying={false}
          reportProgress={reportProgress}
        />,
      );
      await Promise.resolve();
    });

    expect(reportProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionKey: "summary",
        heardRanges: [{ startSecond: 0, endSecond: 3 }],
      }),
    );
  });

  it("flushes the previous section when the active section changes", async () => {
    const audio = createAudioStub();
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="section-0"
          isPlaying
          reportProgress={reportProgress}
        />,
      );
    });

    await act(async () => {
      audio.currentTime = 1.4;
      vi.advanceTimersByTime(1_000);
      audio.currentTime = 0.1;
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="section-1"
          isPlaying
          reportProgress={reportProgress}
        />,
      );
      await Promise.resolve();
    });

    expect(reportProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionKey: "section-0",
        heardRanges: [{ startSecond: 0, endSecond: 2 }],
      }),
    );
  });

  it("does not credit seek jumps and still flushes on page hide", async () => {
    const audio = createAudioStub();
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          reportProgress={reportProgress}
        />,
      );
    });

    await act(async () => {
      audio.currentTime = 1.1;
      vi.advanceTimersByTime(1_000);
      audio.currentTime = 8.2;
      vi.advanceTimersByTime(1_000);
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    expect(reportProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionKey: "summary",
        heardRanges: [{ startSecond: 0, endSecond: 2 }],
      }),
    );
  });

  it("flushes pending progress on unmount", async () => {
    const audio = createAudioStub();
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          reportProgress={reportProgress}
        />,
      );
    });

    await act(async () => {
      audio.currentTime = 1.3;
      vi.advanceTimersByTime(1_000);
      root.unmount();
      await Promise.resolve();
    });

    expect(reportProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionKey: "summary",
      }),
    );
  });

  it("surfaces awarded badge payloads to the caller after a credited listen", async () => {
    const audio = createAudioStub();
    const onBadgesAwarded = vi.fn();
    const reportProgress = vi.fn().mockResolvedValue({
      heardSeconds: 8,
      totalDurationSeconds: 10,
      qualified: true,
      awardedBadgeKeys: ["history"],
      awardedBadges: [
        {
          key: "history",
          label: "History",
          description: "Stories of empires.",
          glyph: "quill-scroll",
          exp: 1,
          creditedArticleCount: 1,
          level: 0,
          expIntoLevel: 1,
          expForNextLevel: 5,
          nextLevelTarget: 5,
          previousLevel: 0,
          leveledUp: false,
          gainedExp: 1,
        },
      ],
    });

    await act(async () => {
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          reportProgress={reportProgress}
          onBadgesAwarded={onBadgesAwarded}
        />,
      );
    });

    await act(async () => {
      audio.currentTime = 1.2;
      vi.advanceTimersByTime(1_000);
      audio.currentTime = 2.1;
      vi.advanceTimersByTime(1_000);
      audio.paused = true;
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying={false}
          reportProgress={reportProgress}
          onBadgesAwarded={onBadgesAwarded}
        />,
      );
      await Promise.resolve();
    });

    expect(onBadgesAwarded).toHaveBeenCalledWith({
      articleTitle: "Roman roads",
      badges: [
        expect.objectContaining({
          key: "history",
          gainedExp: 1,
        }),
      ],
    });
  });
});
