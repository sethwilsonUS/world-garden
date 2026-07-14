// @vitest-environment jsdom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article } from "@/lib/data-context";
import type { TtsAudioUrlResult } from "@/lib/tts-client";
import { getActiveTtsProfile, getTtsMetadata } from "@/lib/tts-profile";
import { useArticleAudioController } from "./useArticleAudioController";

const mocks = vi.hoisted(() => ({
  audioStartup: vi.fn(),
  downloadAll: vi.fn(),
  generateTts: vi.fn(),
  listenSection: vi.fn(),
  mutation: vi.fn(),
  playbackSpeed: vi.fn(),
  playAll: vi.fn(),
  queueExport: vi.fn(),
  query: vi.fn(),
  setPlaybackRate: vi.fn(),
  showBadgeProgressToasts: vi.fn(),
  updateProgress: vi.fn(),
  warmSummary: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mocks.query }),
  useMutation: () => mocks.mutation,
  useQuery: () => undefined,
}));

vi.mock("@/components/ArticleAudioExportProvider", () => ({
  useArticleAudioExports: () => ({
    jobs: [],
    queueExport: mocks.queueExport,
    isStartingArticle: () => false,
  }),
}));

vi.mock("@/components/BadgeProgressToastProvider", () => ({
  useBadgeProgressToasts: () => ({
    showBadgeProgressToasts: mocks.showBadgeProgressToasts,
  }),
}));

vi.mock("@/hooks/useBadgeListenTracking", () => ({
  useBadgeListenTracking: vi.fn(),
}));

vi.mock("@/hooks/useMediaSession", () => ({
  useMediaSession: vi.fn(),
}));

vi.mock("@/hooks/usePlaybackRate", () => ({
  formatRate: (rate: number) => `${rate}x`,
  usePlaybackRate: () => ({ rate: 1, setRate: mocks.setPlaybackRate }),
}));

vi.mock("@/lib/analytics", () => ({
  analytics: {
    audioStartup: mocks.audioStartup,
    downloadAll: mocks.downloadAll,
    listenSection: mocks.listenSection,
    playbackSpeed: mocks.playbackSpeed,
    playAll: mocks.playAll,
  },
}));

vi.mock("@/lib/audio-prefetch", () => ({
  awaitSummaryAudioWithMetadata: vi.fn(() => null),
  getCachedSummaryAudio: vi.fn(() => null),
  preloadAudioUrl: vi.fn(),
  primeSummaryAudio: vi.fn(),
  warmSummaryAudioFromText: mocks.warmSummary,
}));

vi.mock("@/lib/tts-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/tts-client")>();
  return {
    ...original,
    generateTtsAudioUrlWithMetadata: mocks.generateTts,
  };
});

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

type Controller = ReturnType<typeof useArticleAudioController>;
type ObservedController = Pick<Controller, "actions" | "state"> & {
  audioSrc: string | null;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type TestArticle = Article & { _id?: string };

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const audioResult = (url: string): TtsAudioUrlResult => ({
  url,
  metadata: getTtsMetadata(getActiveTtsProfile()),
});

const article: TestArticle = {
  wikiPageId: "42",
  title: "An Unexpected Journey",
  language: "en",
  revisionId: "4200",
  summary: "A hobbit leaves home for an unexpectedly long adventure.",
  sections: [
    {
      title: "Roast Mutton",
      level: 2,
      content: "Three trolls debate dinner until the sun settles the matter.",
      audioMode: "full",
      audioReason: "eligible",
    },
    {
      title: "Riddles in the Dark",
      level: 2,
      content: "Bilbo and Gollum exchange riddles beside an underground lake.",
      audioMode: "full",
      audioReason: "eligible",
    },
    {
      title: "Table of provisions",
      level: 2,
      content: "Item Amount\nCake 2",
      audioMode: "unavailable",
      audioReason: "table_like",
    },
  ],
};

let latest: ObservedController | null = null;

const captureController = (value: ObservedController) => {
  latest = value;
};

const Harness = ({
  onChange,
  articleValue = article,
}: {
  onChange: (value: ObservedController) => void;
  articleValue?: TestArticle;
}) => {
  const {
    state,
    actions,
    audioElement: { ref: audioRef, src: audioSrc },
  } = useArticleAudioController({
    slug: "An_Unexpected_Journey",
    article: articleValue,
    badgeTrackingEnabled: false,
    updateProgress: mocks.updateProgress,
    shouldFocusPlayAll: false,
  });

  useEffect(() => {
    onChange({ state, actions, audioSrc });
  }, [actions, audioSrc, onChange, state]);

  return <audio ref={audioRef} src={audioSrc ?? undefined} />;
};

const controller = (): ObservedController => {
  if (!latest) throw new Error("Controller has not rendered.");
  return latest;
};

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

describe("useArticleAudioController", () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted: boolean;
  let playSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.mutation.mockResolvedValue(undefined);
    mocks.query.mockResolvedValue({ badges: [] });
    mocks.queueExport.mockResolvedValue({ exportId: "export-1", status: "queued" });
    mocks.warmSummary.mockResolvedValue(null);

    playSpy = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockImplementation(function (this: HTMLMediaElement) {
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
      });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      this.dispatchEvent(new Event("pause"));
    });

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
    await act(async () => {
      root.render(<Harness onChange={captureController} />);
    });
    await waitForExpectation(() => expect(latest).not.toBeNull());
  });

  afterEach(() => {
    if (mounted) {
      act(() => root.unmount());
    }
    latest = null;
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("ignores a stale section completion after a newer request wins", async () => {
    const first = deferred<TtsAudioUrlResult>();
    const second = deferred<TtsAudioUrlResult>();
    mocks.generateTts
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    act(() => {
      controller().actions.listenSection(0);
    });
    await waitForExpectation(() =>
      expect(mocks.generateTts).toHaveBeenCalledTimes(1),
    );
    act(() => {
      controller().actions.listenSection(1);
    });
    await waitForExpectation(() =>
      expect(mocks.generateTts).toHaveBeenCalledTimes(2),
    );

    await act(async () => {
      second.resolve(audioResult("blob:newer"));
    });
    await waitForExpectation(() => {
      expect(controller().state.playback.sectionKey).toBe("section-1");
      expect(controller().audioSrc).toBe("blob:newer");
    });

    await act(async () => {
      first.resolve(audioResult("blob:stale"));
      await first.promise;
    });
    expect(controller().state.playback.sectionKey).toBe("section-1");
    expect(controller().audioSrc).toBe("blob:newer");
  });

  it("shows the slow-loading nudge at eight seconds and clears it on success", async () => {
    const request = deferred<TtsAudioUrlResult>();
    mocks.generateTts.mockReturnValueOnce(request.promise);

    act(() => {
      controller().actions.listenSummary();
    });
    expect(controller().state.playback.slowLoading).toBe(false);

    act(() => vi.advanceTimersByTime(7_999));
    expect(controller().state.playback.slowLoading).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(controller().state.playback.slowLoading).toBe(true);

    await act(async () => {
      request.resolve(audioResult("blob:summary"));
    });
    await waitForExpectation(() => {
      expect(controller().state.playback.slowLoading).toBe(false);
      expect(controller().state.playback.status).toBe("playing");
    });
  });

  it("retains generated audio in a paused state when autoplay is rejected", async () => {
    const request = deferred<TtsAudioUrlResult>();
    mocks.generateTts.mockReturnValueOnce(request.promise);
    playSpy.mockImplementationOnce(() => Promise.reject(new Error("blocked")));

    act(() => {
      controller().actions.listenSummary();
    });
    await waitForExpectation(() =>
      expect(mocks.generateTts).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      request.resolve(audioResult("blob:blocked"));
    });

    await waitForExpectation(() => {
      expect(controller().audioSrc).toBe("blob:blocked");
      expect(controller().state.playback).toMatchObject({
        status: "paused",
        sectionKey: "summary",
        slowLoading: false,
      });
    });
  });

  it("advances Play All through suitable sections and finishes cleanly", async () => {
    mocks.generateTts.mockImplementation(async ({ text }: { text: string }) =>
      audioResult(
        text.includes("hobbit leaves")
          ? "blob:summary"
          : text.includes("Three trolls")
            ? "blob:section-0"
            : "blob:section-1",
      ),
    );

    act(() => {
      controller().actions.playAll();
    });
    await waitForExpectation(() => {
      expect(controller().state.playback).toMatchObject({
        status: "playing",
        mode: "play_all",
        sectionKey: "summary",
      });
    });

    const audio = container.querySelector("audio")!;
    act(() => {
      audio.dispatchEvent(new Event("ended"));
    });
    await waitForExpectation(() =>
      expect(controller().state.playback.sectionKey).toBe("section-0"),
    );

    act(() => {
      audio.dispatchEvent(new Event("ended"));
    });
    await waitForExpectation(() =>
      expect(controller().state.playback.sectionKey).toBe("section-1"),
    );

    act(() => {
      audio.dispatchEvent(new Event("ended"));
    });
    await waitForExpectation(() => {
      expect(controller().state.playback.status).toBe("idle");
      expect(controller().state.finishedPlaying).toBe(true);
    });
    expect(mocks.updateProgress).not.toHaveBeenCalledWith(
      expect.anything(),
      "section-2",
      expect.anything(),
    );
  });

  it("skips a loading Play All item without letting its late result return", async () => {
    const summary = deferred<TtsAudioUrlResult>();
    const firstSection = deferred<TtsAudioUrlResult>();
    mocks.generateTts.mockImplementation(({ text }: { text: string }) =>
      text.includes("hobbit leaves") ? summary.promise : firstSection.promise,
    );

    act(() => {
      controller().actions.playAll();
    });
    expect(controller().state.playback).toMatchObject({
      status: "loading",
      sectionKey: "summary",
      mode: "play_all",
    });

    act(() => {
      controller().actions.skipSection();
    });
    await waitForExpectation(() => {
      expect(controller().state.playback).toMatchObject({
        status: "loading",
        sectionKey: "section-0",
        mode: "play_all",
      });
    });
    await act(async () => {
      firstSection.resolve(audioResult("blob:first-section"));
    });
    await waitForExpectation(() => {
      expect(controller().state.playback.sectionKey).toBe("section-0");
      expect(controller().audioSrc).toBe("blob:first-section");
    });

    await act(async () => {
      summary.resolve(audioResult("blob:late-summary"));
      await summary.promise;
    });
    expect(controller().state.playback.sectionKey).toBe("section-0");
    expect(controller().audioSrc).toBe("blob:first-section");
  });

  it("continues Play All after a section fails", async () => {
    mocks.generateTts.mockImplementation(({ text }: { text: string }) => {
      if (text.includes("Three trolls")) {
        return Promise.reject(new Error("Troll trouble"));
      }
      return Promise.resolve(
        audioResult(
          text.includes("hobbit leaves")
            ? "blob:summary"
            : "blob:section-1",
        ),
      );
    });

    act(() => {
      controller().actions.playAll();
    });
    await waitForExpectation(() =>
      expect(controller().state.playback.sectionKey).toBe("summary"),
    );

    const audio = container.querySelector("audio")!;
    act(() => {
      audio.dispatchEvent(new Event("ended"));
    });

    await waitForExpectation(() => {
      expect(controller().state.error).toBeNull();
      expect(controller().state.playback).toMatchObject({
        status: "playing",
        mode: "play_all",
        sectionKey: "section-1",
      });
      expect(controller().audioSrc).toBe("blob:section-1");
    });
  });

  it("exposes a single-item failure and retries it successfully", async () => {
    const failed = deferred<TtsAudioUrlResult>();
    const retried = deferred<TtsAudioUrlResult>();
    mocks.generateTts
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(retried.promise);

    act(() => {
      controller().actions.listenSection(0);
    });
    await waitForExpectation(() =>
      expect(mocks.generateTts).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      failed.reject(new Error("The road goes ever on"));
    });
    await waitForExpectation(() => {
      expect(controller().state.error).toBe("The road goes ever on");
      expect(controller().state.playback.status).toBe("error");
    });

    act(() => {
      controller().actions.retry();
    });
    await waitForExpectation(() =>
      expect(mocks.generateTts).toHaveBeenCalledTimes(2),
    );
    await act(async () => {
      retried.resolve(audioResult("blob:retried"));
    });
    await waitForExpectation(() => {
      expect(controller().state.error).toBeNull();
      expect(controller().audioSrc).toBe("blob:retried");
      expect(controller().state.playback.status).toBe("playing");
    });
  });

  it("falls back to the summary when saved progress points outside the article", async () => {
    mocks.generateTts.mockResolvedValueOnce(audioResult("blob:summary-fallback"));

    act(() => {
      controller().actions.resume("section-99", 99);
    });
    await waitForExpectation(() =>
      expect(controller().audioSrc).toBe("blob:summary-fallback"),
    );

    expect(mocks.warmSummary).toHaveBeenCalled();
    expect(mocks.updateProgress).toHaveBeenCalledWith(
      "An_Unexpected_Journey",
      "summary",
      null,
    );
    expect(controller().state.playback.sectionKey).toBe("summary");
    expect(controller().audioSrc).toBe("blob:summary-fallback");
  });

  it("stops pending work without letting its late result restart playback", async () => {
    const request = deferred<TtsAudioUrlResult>();
    mocks.generateTts.mockReturnValueOnce(request.promise);

    act(() => {
      controller().actions.listenSection(0);
    });
    await waitForExpectation(() =>
      expect(mocks.generateTts).toHaveBeenCalledTimes(1),
    );
    act(() => controller().actions.stopPlayAll());
    expect(controller().state.playback.status).toBe("idle");
    expect(controller().audioSrc).toBeNull();

    await act(async () => {
      request.resolve(audioResult("blob:too-late"));
      await request.promise;
    });
    expect(controller().state.playback.status).toBe("idle");
    expect(controller().audioSrc).toBeNull();
    expect(mocks.audioStartup).not.toHaveBeenCalled();
  });

  it("invalidates pending work and clears delayed analytics on unmount", async () => {
    const request = deferred<TtsAudioUrlResult>();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.generateTts.mockReturnValueOnce(request.promise);

    act(() => {
      controller().actions.listenSection(0);
      controller().actions.changePlaybackRate(1.25);
    });
    await waitForExpectation(() =>
      expect(mocks.generateTts).toHaveBeenCalledTimes(1),
    );

    act(() => root.unmount());
    mounted = false;
    await act(async () => {
      request.resolve(audioResult("blob:too-late"));
      await request.promise;
      vi.advanceTimersByTime(2_000);
    });

    expect(errorSpy).not.toHaveBeenCalled();
    expect(mocks.audioStartup).not.toHaveBeenCalled();
    expect(mocks.playbackSpeed).not.toHaveBeenCalled();
    expect(playSpy).not.toHaveBeenCalled();
  });

  it("aborts a stalled cache-audio download", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let downloadSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          downloadSignal = init?.signal ?? undefined;
          downloadSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    mocks.generateTts.mockResolvedValueOnce(audioResult("blob:cache-download"));

    await act(async () => {
      root.render(
        <Harness
          onChange={captureController}
          articleValue={{ ...article, _id: "article-42" }}
        />,
      );
    });
    act(() => controller().actions.listenSummary());
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(downloadSignal?.aborted).toBe(false);
    act(() => vi.advanceTimersByTime(5_000));
    await waitForExpectation(() => expect(downloadSignal?.aborted).toBe(true));
    await waitForExpectation(() => expect(warnSpy).toHaveBeenCalledTimes(1));
  });

  it("aborts a stalled cache-audio upload", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let uploadSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        blob: async () => new Blob(["audio"], { type: "audio/mpeg" }),
      } as Response)
      .mockImplementationOnce(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            uploadSignal = init?.signal ?? undefined;
            uploadSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      );
    vi.stubGlobal("fetch", fetchMock);
    mocks.mutation.mockResolvedValueOnce("https://upload.example/audio");
    mocks.generateTts.mockResolvedValueOnce(audioResult("blob:cache-upload"));

    await act(async () => {
      root.render(
        <Harness
          onChange={captureController}
          articleValue={{ ...article, _id: "article-42" }}
        />,
      );
    });
    act(() => controller().actions.listenSummary());
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    act(() => vi.advanceTimersByTime(5_000));
    await waitForExpectation(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(uploadSignal?.aborted).toBe(false);

    act(() => vi.advanceTimersByTime(10_000));
    await waitForExpectation(() => expect(uploadSignal?.aborted).toBe(true));
    await waitForExpectation(() => expect(warnSpy).toHaveBeenCalledTimes(1));
  });
});
