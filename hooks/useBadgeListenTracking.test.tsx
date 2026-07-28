// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBadgeListenTracking } from "./useBadgeListenTracking";
import type { AwardedBadgeProgress, BadgeKey } from "@/lib/badges";
import { createTestSection } from "@/lib/test-section-narration";
import { ARTICLE_SECTION_NARRATION_VERSION } from "@/lib/section-narration";

Object.assign(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: true,
});

type HarnessProps = {
  audio: HTMLAudioElement;
  trackingSectionKey: string | null;
  isPlaying: boolean;
  reportProgress: (args: unknown) => Promise<unknown>;
  articleId?: string;
  wikiPageId?: string;
  slug?: string;
  title?: string;
  durationSeconds?: number;
  enabled?: boolean;
  onBadgesAwarded?: (args: {
    articleTitle: string;
    badges: AwardedBadgeProgress[];
  }) => void;
  resolveAwardedBadges?: (
    awardedBadgeKeys: BadgeKey[],
  ) => Promise<AwardedBadgeProgress[]>;
};

const articleId = "article-1" as never;

const Harness = ({
  audio,
  trackingSectionKey,
  isPlaying,
  reportProgress,
  articleId: harnessArticleId = articleId,
  wikiPageId = "wiki-1",
  slug = "Roman_roads",
  title = "Roman roads",
  durationSeconds = 10,
  enabled,
  onBadgesAwarded,
  resolveAwardedBadges,
}: HarnessProps) => {
  useBadgeListenTracking({
    enabled,
    articleId: harnessArticleId as never,
    wikiPageId,
    revisionId: "revision-1",
    narrationVersion: ARTICLE_SECTION_NARRATION_VERSION,
    slug,
    title,
    summaryText: "One two three four five six seven eight nine ten.",
    sections: [
      createTestSection({
        title: "Roads",
        level: 2,
        content: "One two three four five six seven eight nine ten.",
      }),
      createTestSection({
        title: "Aqueducts",
        level: 2,
        content: "One two three four five six seven eight nine ten.",
      }),
    ],
    sectionDurations: {
      summary: durationSeconds,
      "section-0": durationSeconds,
      "section-1": durationSeconds,
    },
    trackingSectionKey,
    audioDurationSeconds: durationSeconds,
    isPlaying,
    audioRef: { current: audio },
    reportProgress,
    onBadgesAwarded,
    resolveAwardedBadges,
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
  }) as HTMLAudioElement & MutableAudioStub;

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

  it("keeps an exiting section's progress attached to its original article", async () => {
    const audio = createAudioStub();
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="section-0"
          isPlaying
          reportProgress={reportProgress}
          articleId="article-old"
          wikiPageId="wiki-old"
          slug="Old_article"
          title="Old article"
        />,
      );
    });

    await act(async () => {
      audio.currentTime = 1.2;
      vi.advanceTimersByTime(1_000);
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey={null}
          isPlaying
          reportProgress={reportProgress}
          articleId="article-new"
          wikiPageId="wiki-new"
          slug="New_article"
          title="New article"
        />,
      );
      await Promise.resolve();
    });

    expect(reportProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: "article-old",
        wikiPageId: "wiki-old",
        slug: "Old_article",
        title: "Old article",
        sectionKey: "section-0",
        heardRanges: [{ startSecond: 0, endSecond: 2 }],
      }),
    );
    expect(reportProgress).not.toHaveBeenCalledWith(
      expect.objectContaining({
        articleId: "article-new",
      }),
    );
  });

  it("keeps pending ranges separated when section timing metadata changes", async () => {
    const audio = createAudioStub();
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          reportProgress={reportProgress}
          durationSeconds={10}
        />,
      );
    });

    await act(async () => {
      audio.currentTime = 1.2;
      vi.advanceTimersByTime(1_000);
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          reportProgress={reportProgress}
          durationSeconds={20}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      audio.currentTime = 2.2;
      vi.advanceTimersByTime(1_000);
      audio.paused = true;
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying={false}
          reportProgress={reportProgress}
          durationSeconds={20}
        />,
      );
      await Promise.resolve();
    });

    expect(reportProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        totalDurationSeconds: 30,
        sectionDurationSeconds: 10,
        heardRanges: [{ startSecond: 0, endSecond: 2 }],
      }),
    );
    expect(reportProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        totalDurationSeconds: 60,
        sectionDurationSeconds: 20,
        heardRanges: [{ startSecond: 1, endSecond: 3 }],
      }),
    );
  });

  it("starts a fresh attribution cutoff on a continuous section transition", async () => {
    const audio = createAudioStub();
    const reportProgress = vi.fn().mockResolvedValue(undefined);
    const firstSectionStartedAt = 1_780_000_000_000;
    vi.setSystemTime(firstSectionStartedAt);

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
      audio.currentTime = 1.2;
      vi.advanceTimersByTime(1_000);
      audio.currentTime = 0;
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
    const secondSectionStartedAt = Date.now();
    const secondSectionGenerationAt = secondSectionStartedAt - 1;

    await act(async () => {
      audio.currentTime = 1.2;
      vi.advanceTimersByTime(1_000);
      audio.paused = true;
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="section-1"
          isPlaying={false}
          reportProgress={reportProgress}
        />,
      );
      await Promise.resolve();
    });

    expect(reportProgress).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        sectionKey: "section-0",
        listeningSessionStartedAt: firstSectionStartedAt,
        progressStartedAt: firstSectionStartedAt,
      }),
    );
    expect(reportProgress).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        sectionKey: "section-1",
        listeningSessionStartedAt: firstSectionStartedAt,
        progressStartedAt: secondSectionStartedAt,
      }),
    );
    expect(reportProgress.mock.calls[1]?.[0].progressStartedAt).toBeGreaterThan(
      secondSectionGenerationAt,
    );
  });

  it("preserves the original attribution cutoff when a failed report is retried", async () => {
    const audio = createAudioStub();
    const reportProgress = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValue(undefined);
    const originalStartedAt = 1_780_000_000_000;
    vi.setSystemTime(originalStartedAt);

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
      await Promise.resolve();
    });

    vi.setSystemTime(originalStartedAt + 60_000);
    await act(async () => {
      audio.paused = false;
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          reportProgress={reportProgress}
        />,
      );
      await Promise.resolve();
    });
    await act(async () => {
      audio.currentTime = 2.2;
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

    expect(reportProgress.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(reportProgress.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        listeningSessionStartedAt: originalStartedAt,
        progressStartedAt: originalStartedAt,
      }),
    );
    expect(reportProgress.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        heardRanges: [{ startSecond: 0, endSecond: 2 }],
        listeningSessionStartedAt: originalStartedAt,
        progressStartedAt: originalStartedAt,
      }),
    );
    expect(reportProgress.mock.calls[2]?.[0]).toEqual(
      expect.objectContaining({
        heardRanges: [{ startSecond: 1, endSecond: 3 }],
        listeningSessionStartedAt: originalStartedAt + 60_000,
        progressStartedAt: originalStartedAt + 60_000,
      }),
    );
  });

  it("retries a rejected transition flush without relabeling it as the next section", async () => {
    const audio = createAudioStub();
    audio.currentTime = 4;
    let rejectPreviousSection!: (reason: Error) => void;
    const previousSectionReport = new Promise<unknown>((_resolve, reject) => {
      rejectPreviousSection = reject;
    });
    const reportProgress = vi
      .fn()
      .mockImplementationOnce(() => previousSectionReport)
      .mockResolvedValue(undefined);
    const listeningSessionStartedAt = 1_780_000_000_000;
    vi.setSystemTime(listeningSessionStartedAt);

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
      audio.currentTime = 5.2;
      vi.advanceTimersByTime(1_000);
      audio.currentTime = 0;
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
    const nextSectionStartedAt = Date.now();

    await act(async () => {
      audio.currentTime = 1.2;
      vi.advanceTimersByTime(1_000);
      rejectPreviousSection(new Error("network unavailable"));
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      audio.paused = true;
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="section-1"
          isPlaying={false}
          reportProgress={reportProgress}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      await Promise.resolve();
    });

    const reports = reportProgress.mock.calls.map(
      ([report]) =>
        report as {
          sectionKey: string;
          heardRanges: Array<{ startSecond: number; endSecond: number }>;
          listeningSessionStartedAt: number;
          progressStartedAt: number;
        },
    );
    expect(
      reports.filter((report) => report.sectionKey === "section-0"),
    ).toEqual([
      expect.objectContaining({
        heardRanges: [{ startSecond: 4, endSecond: 6 }],
        listeningSessionStartedAt,
        progressStartedAt: listeningSessionStartedAt,
      }),
      expect.objectContaining({
        heardRanges: [{ startSecond: 4, endSecond: 6 }],
        listeningSessionStartedAt,
        progressStartedAt: listeningSessionStartedAt,
      }),
    ]);
    expect(
      reports.filter((report) => report.sectionKey === "section-1"),
    ).toEqual([
      expect.objectContaining({
        heardRanges: [{ startSecond: 0, endSecond: 2 }],
        listeningSessionStartedAt,
        progressStartedAt: nextSectionStartedAt,
      }),
    ]);
  });

  it("keeps one listening session across periodic five-second flushes", async () => {
    const audio = createAudioStub();
    const reportProgress = vi.fn().mockResolvedValue(undefined);
    const listeningSessionStartedAt = 1_780_000_000_000;
    vi.setSystemTime(listeningSessionStartedAt);

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

    for (let second = 1; second <= 10; second += 1) {
      await act(async () => {
        audio.currentTime = second;
        vi.advanceTimersByTime(1_000);
        await Promise.resolve();
      });
    }

    expect(reportProgress.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(
      reportProgress.mock.calls
        .slice(0, 2)
        .map(
          (call) =>
            (call[0] as { listeningSessionStartedAt?: number })
              .listeningSessionStartedAt,
        ),
    ).toEqual([listeningSessionStartedAt, listeningSessionStartedAt]);
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

  it("does not sample or flush progress while tracking is disabled", async () => {
    const audio = createAudioStub();
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          enabled={false}
          reportProgress={reportProgress}
        />,
      );
    });

    await act(async () => {
      audio.currentTime = 1.2;
      vi.advanceTimersByTime(1_000);
      audio.currentTime = 2.1;
      vi.advanceTimersByTime(1_000);
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="section-0"
          isPlaying
          enabled={false}
          reportProgress={reportProgress}
        />,
      );
      window.dispatchEvent(new Event("pagehide"));
      audio.paused = true;
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="section-0"
          isPlaying={false}
          enabled={false}
          reportProgress={reportProgress}
        />,
      );
      root.unmount();
      await Promise.resolve();
    });

    expect(reportProgress).not.toHaveBeenCalled();
  });

  it("drops pending ranges when tracking becomes disabled", async () => {
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
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          enabled={false}
          reportProgress={reportProgress}
        />,
      );
      audio.paused = true;
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying={false}
          enabled={false}
          reportProgress={reportProgress}
        />,
      );
      await Promise.resolve();
    });

    expect(reportProgress).not.toHaveBeenCalled();
  });

  it("reports later playback after tracking is enabled", async () => {
    const audio = createAudioStub();
    const reportProgress = vi.fn().mockResolvedValue(undefined);

    await act(async () => {
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          enabled={false}
          reportProgress={reportProgress}
        />,
      );
    });

    await act(async () => {
      audio.currentTime = 1.2;
      vi.advanceTimersByTime(1_000);
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          enabled
          reportProgress={reportProgress}
        />,
      );
      await Promise.resolve();
    });

    await act(async () => {
      audio.currentTime = 2.1;
      vi.advanceTimersByTime(1_000);
      audio.currentTime = 3.1;
      vi.advanceTimersByTime(1_000);
      audio.paused = true;
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying={false}
          enabled
          reportProgress={reportProgress}
        />,
      );
      await Promise.resolve();
    });

    expect(reportProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        sectionKey: "summary",
        heardRanges: [{ startSecond: 1, endSecond: 4 }],
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

  it("can resolve awarded badges from awarded keys when the mutation omits detailed payloads", async () => {
    const audio = createAudioStub();
    const onBadgesAwarded = vi.fn();
    const resolveAwardedBadges = vi.fn().mockResolvedValue([
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
    ]);
    const reportProgress = vi.fn().mockResolvedValue({
      heardSeconds: 8,
      totalDurationSeconds: 10,
      qualified: true,
      awardedBadgeKeys: ["history"],
      awardedBadges: [],
    });

    await act(async () => {
      root.render(
        <Harness
          audio={audio}
          trackingSectionKey="summary"
          isPlaying
          reportProgress={reportProgress}
          onBadgesAwarded={onBadgesAwarded}
          resolveAwardedBadges={resolveAwardedBadges}
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
          resolveAwardedBadges={resolveAwardedBadges}
        />,
      );
      await Promise.resolve();
    });

    expect(resolveAwardedBadges).toHaveBeenCalledWith(["history"]);
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
