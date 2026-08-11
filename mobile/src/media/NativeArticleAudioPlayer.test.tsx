import type { WikipediaArticle } from "@curio-garden/domain";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AppState, StyleSheet, View } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import type {
  BackgroundAudioPlaylist,
  BackgroundAudioPlaylistStatus,
  BackgroundAudioRuntime,
  BackgroundAudioTrackChange,
} from "./ExpoBackgroundAudioRuntime";
import {
  NativeArticleAudioAccessContextProvider,
  type NativeArticleAudioAccess,
} from "./NativeArticleAudioAccessContext";
import type {
  NativeArticleAudioEphemeralLease,
  NativeArticleAudioEphemeralStore,
} from "./NativeArticleAudioEphemeralStore";
import {
  MAX_NATIVE_ARTICLE_PLAYLIST_AUDIO_BYTES,
  MAX_NATIVE_ARTICLE_PLAYLIST_TRACKS,
  NativeArticleAudioPlayer,
} from "./NativeArticleAudioPlayer";

const accountEpoch = Symbol("account-a");
const appStateCurrentStateDescriptor = Object.getOwnPropertyDescriptor(
  AppState,
  "currentState",
);

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function article(): WikipediaArticle {
  return {
    language: "en",
    narrationVersion: 2,
    revisionId: "1234",
    sections: [
      {
        content: "Pumpkins originated in the Americas.",
        level: 2,
        title: "Origins",
        wikiSectionIndex: "1",
      },
      {
        content: "",
        level: 2,
        title: "Cultivation",
        wikiSectionIndex: "2",
      },
      {
        content: "Seeds are planted after frost.",
        level: 3,
        title: "Planting",
        wikiSectionIndex: "3",
      },
      {
        content: "",
        level: 2,
        title: "Empty appendix",
        wikiSectionIndex: "4",
      },
    ],
    summary: "A pumpkin is a cultivated winter squash.",
    title: "Pumpkin",
    wikiPageId: "736",
  };
}

function readyResponse(declaredLength = 1): Response {
  return new Response(new Uint8Array([1]), {
    headers: {
      "content-length": String(declaredLength),
      "content-type": "audio/mpeg",
    },
    status: 200,
  });
}

function collectTestIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectTestIds);
  if (typeof value !== "object" || value === null) return [];
  const node = value as {
    children?: unknown;
    props?: Readonly<{ testID?: unknown }>;
  };
  const own = typeof node.props?.testID === "string" ? [node.props.testID] : [];
  return [...own, ...collectTestIds(node.children)];
}

function harness({ leaseByteLength = 1 }: { leaseByteLength?: number } = {}) {
  let statusListener!: (status: BackgroundAudioPlaylistStatus) => void;
  let trackListener!: (change: BackgroundAudioTrackChange) => void;
  let status: BackgroundAudioPlaylistStatus = {
    currentIndex: 0,
    currentTime: 0,
    didJustFinish: false,
    duration: 30,
    ended: false,
    error: null,
    isBuffering: false,
    isLoaded: true,
    playbackRate: 1,
    playing: true,
    trackCount: 4,
  };
  const playlist: BackgroundAudioPlaylist = {
    getStatus: jest.fn(() => status),
    next: jest.fn(),
    pause: jest.fn(),
    play: jest.fn().mockResolvedValue(undefined),
    previous: jest.fn(),
    release: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
    skipTo: jest.fn(),
  };
  const runtime: BackgroundAudioRuntime = {
    configureBackgroundMode: jest.fn().mockResolvedValue(undefined),
    createPlayer: jest.fn(),
    createPlaylist: jest.fn((_sources, onStatus, onTrackChanged) => {
      statusListener = onStatus;
      trackListener = onTrackChanged;
      return playlist;
    }),
  };
  const leases: NativeArticleAudioEphemeralLease[] = [];
  const store: NativeArticleAudioEphemeralStore = {
    prepare: jest.fn().mockResolvedValue({ status: "ready" }),
    stage: jest.fn().mockImplementation(async () => {
      const lease: NativeArticleAudioEphemeralLease = {
        byteLength: leaseByteLength,
        release: jest.fn().mockResolvedValue(undefined),
        uri: `file:///private-cache/audio-${leases.length}.mp3`,
      };
      leases.push(lease);
      return { lease, status: "ready" };
    }),
  };
  const responseReleases: jest.Mock[] = [];
  const requestSection = jest.fn().mockImplementation(async () => {
    const release = jest.fn();
    responseReleases.push(release);
    return {
      accountEpoch,
      release,
      response: readyResponse(leaseByteLength),
      status: "ready",
    };
  });
  const access: NativeArticleAudioAccess = { accountEpoch, requestSection };

  return {
    access,
    emitStatus(overrides: Partial<BackgroundAudioPlaylistStatus>) {
      status = { ...status, ...overrides };
      statusListener(status);
    },
    emitTrack(change: BackgroundAudioTrackChange) {
      status = { ...status, currentIndex: change.currentIndex };
      trackListener(change);
    },
    leases,
    loadRuntime: jest.fn().mockResolvedValue(runtime),
    playlist,
    requestSection,
    responseReleases,
    runtime,
    setStatus(overrides: Partial<BackgroundAudioPlaylistStatus>) {
      status = { ...status, ...overrides };
    },
    store,
  };
}

function renderPlayer(
  setup: ReturnType<typeof harness>,
  articleOverride: WikipediaArticle = article(),
  summaryDisclosure?: ReactNode,
) {
  const props = {
    active: true,
    article: articleOverride,
    ephemeralStore: setup.store,
    loadRuntime: setup.loadRuntime,
    slug: "Pumpkin",
    summaryDisclosure,
  };
  const tree = (
    access: NativeArticleAudioAccess,
    playerProps: typeof props = props,
  ) => (
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <NativeArticleAudioAccessContextProvider value={access}>
        <NativeArticleAudioPlayer {...playerProps} />
      </NativeArticleAudioAccessContextProvider>
    </GardenThemeProvider>
  );
  const view = render(tree(setup.access));
  return {
    ...view,
    rerenderAccess: (access: NativeArticleAudioAccess) =>
      view.rerender(tree(access)),
    rerenderProps: (next: Partial<typeof props>) =>
      view.rerender(tree(setup.access, { ...props, ...next })),
  };
}

describe("NativeArticleAudioPlayer", () => {
  let appStateListener: ((state: string) => void) | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(AppState, "currentState", {
      configurable: true,
      value: "active",
    });
    appStateListener = undefined;
    jest.spyOn(AppState, "addEventListener").mockImplementation(((
      _event: string,
      listener: (state: string) => void,
    ) => {
      appStateListener = listener;
      return { remove: jest.fn() };
    }) as typeof AppState.addEventListener);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (appStateCurrentStateDescriptor) {
      Object.defineProperty(
        AppState,
        "currentState",
        appStateCurrentStateDescriptor,
      );
    }
  });

  it("mirrors the current article-audio hierarchy with operable and honest section rows", () => {
    const setup = harness();
    renderPlayer(setup);

    expect(
      screen.getByRole("header", { name: "Explore this article" }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Listen to summary of Pumpkin" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Listen to Origins in Pumpkin" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Listen to Planting in Pumpkin" }),
    ).toBeEnabled();
    expect(screen.getByText("Chapter transition")).toBeOnTheScreen();
    expect(screen.getByText("No source text")).toBeOnTheScreen();
    expect(screen.getByTestId("article-audio-disclosure")).toHaveTextContent(
      "Audio is generated with synthetic speech.",
    );
  });

  it("gives duplicate section titles stable, distinct screen-reader names", async () => {
    const setup = harness();
    renderPlayer(setup, {
      ...article(),
      sections: [
        {
          content: "The earliest history.",
          level: 2,
          title: "History",
          wikiSectionIndex: "1",
        },
        {
          content: "The later history.",
          level: 2,
          title: "history",
          wikiSectionIndex: "2",
        },
      ],
      summary: undefined,
    });

    const first = screen.getByRole("button", {
      name: "Listen to History in Pumpkin. Audio item 1 of 2",
    });
    expect(
      screen.getByRole("button", {
        name: "Listen to history in Pumpkin. Audio item 2 of 2",
      }),
    ).toBeEnabled();

    fireEvent.press(first);
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", {
        name: "Playing History in Pumpkin. Audio item 1 of 2. Pause audio",
      }),
    ).toBeEnabled();
    act(() =>
      setup.emitStatus({ didJustFinish: true, ended: true, playing: false }),
    );
    expect(
      screen.getByRole("button", {
        name: "Replay History in Pumpkin. Audio item 1 of 2",
      }),
    ).toBeEnabled();
  });

  it("places the mobile summary disclosure before the audio item rows", () => {
    const setup = harness();
    const view = renderPlayer(
      setup,
      article(),
      <View testID="test-summary-disclosure">Full text summary</View>,
    );

    const player = screen.getByTestId("article-audio-player");
    expect(screen.getByTestId("test-summary-disclosure")).toBeOnTheScreen();
    expect(player).toBeOnTheScreen();
    const testIds = collectTestIds(view.toJSON());
    const disclosureIndex = testIds.indexOf("test-summary-disclosure");
    const rowsIndex = testIds.indexOf("article-audio-item-summary");
    expect(disclosureIndex).toBeGreaterThanOrEqual(0);
    expect(rowsIndex).toBeGreaterThan(disclosureIndex);
  });

  it("routes summary-only revisions to the lightweight player before disclosure", () => {
    const setup = harness();
    const view = renderPlayer(
      setup,
      { ...article(), sections: [] },
      <View testID="test-summary-disclosure">Full text summary</View>,
    );
    const testIds = collectTestIds(view.toJSON());

    expect(
      screen.getByTestId("article-summary-audio-player"),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("article-audio-player")).toBeNull();
    expect(testIds.indexOf("article-summary-audio-player")).toBeLessThan(
      testIds.indexOf("test-summary-disclosure"),
    );
  });

  it("renders no audio surface for revisions without narration source text", () => {
    const setup = harness();
    renderPlayer(
      setup,
      { ...article(), sections: [], summary: " " },
      <View testID="test-summary-disclosure">Full text summary</View>,
    );

    expect(screen.queryByTestId("article-audio-player")).toBeNull();
    expect(screen.queryByTestId("article-summary-audio-player")).toBeNull();
    expect(screen.queryByTestId("test-summary-disclosure")).toBeNull();
  });

  it("prepares the fixed local queue in canonical order and starts Play All", async () => {
    const setup = harness();
    renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );

    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));
    expect(
      setup.requestSection.mock.calls.map(([request]) => request.sectionKey),
    ).toEqual(["summary", "section-0", "section-1", "section-2"]);
    expect(setup.runtime.createPlaylist).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          metadata: expect.objectContaining({ title: "Summary — Pumpkin" }),
          uri: "file:///private-cache/audio-0.mp3",
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({ title: "Origins — Pumpkin" }),
          uri: "file:///private-cache/audio-1.mp3",
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            title: "Cultivation — Pumpkin",
          }),
          uri: "file:///private-cache/audio-2.mp3",
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({ title: "Planting — Pumpkin" }),
          uri: "file:///private-cache/audio-3.mp3",
        }),
      ],
      expect.any(Function),
      expect.any(Function),
    );
    expect(
      screen.getByRole("button", { name: "Pause playing all audio" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", {
        name: "Playing summary of Pumpkin. Pause audio",
      }),
    ).toBeEnabled();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Playing Summary. Audio item 1 of 4.",
    );
    expect(setup.responseReleases).toHaveLength(4);
    for (const release of setup.responseReleases) {
      expect(release).toHaveBeenCalledTimes(1);
    }
  });

  it("describes the current Play All action in its accessibility hint", async () => {
    const setup = harness();
    const pending =
      deferred<
        Awaited<ReturnType<NativeArticleAudioAccess["requestSection"]>>
      >();
    setup.requestSection.mockReturnValueOnce(pending.promise);
    renderPlayer(setup);

    expect(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    ).toHaveProp(
      "accessibilityHint",
      "Starts the complete article audio queue. Playback can continue in the background with lock-screen controls for Pumpkin.",
    );
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.requestSection).toHaveBeenCalledTimes(1));

    expect(
      screen.getByRole("button", { name: "Cancel preparing Play All" }),
    ).toHaveProp(
      "accessibilityHint",
      "Stops preparing the complete article audio queue.",
    );

    pending.resolve({
      accountEpoch,
      release: jest.fn(),
      response: readyResponse(),
      status: "ready",
    });
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));
    const pause = screen.getByRole("button", {
      name: "Pause playing all audio",
    });
    expect(pause).toHaveProp(
      "accessibilityHint",
      "Pauses the complete article audio queue.",
    );

    fireEvent.press(pause);
    const resume = screen.getByRole("button", {
      name: "Resume playing all audio",
    });
    expect(resume).toHaveProp(
      "accessibilityHint",
      "Resumes the complete article audio queue. Playback can continue in the background with lock-screen controls for Pumpkin.",
    );

    fireEvent.press(resume);
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(2));
    act(() =>
      setup.emitStatus({
        currentIndex: 3,
        didJustFinish: false,
        ended: true,
        playing: false,
      }),
    );
    expect(screen.getByRole("button", { name: "Replay all audio" })).toHaveProp(
      "accessibilityHint",
      "Restarts the complete article audio queue. Playback can continue in the background with lock-screen controls for Pumpkin.",
    );
  });

  it("exposes bounded previous and next actions and announces the current item", async () => {
    const setup = harness();
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));

    expect(
      screen.getByRole("button", { name: "Previous audio item — unavailable" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Next audio item" }),
    ).toBeEnabled();

    act(() => setup.emitTrack({ currentIndex: 1, previousIndex: 0 }));

    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Playing Origins. Audio item 2 of 4.",
    );
    expect(
      screen.getByRole("button", { name: "Previous audio item" }),
    ).toBeEnabled();
    fireEvent.press(
      screen.getByRole("button", { name: "Previous audio item" }),
    );
    expect(setup.playlist.previous).toHaveBeenCalledTimes(1);
    const next = screen.getByRole("button", { name: "Next audio item" });
    fireEvent.press(next);
    expect(setup.playlist.next).toHaveBeenCalledTimes(1);
    fireEvent(next, "focus");

    act(() => setup.emitTrack({ currentIndex: 3, previousIndex: 1 }));
    const unavailableNext = screen.getByRole("button", {
      name: "Next audio item — unavailable",
    });
    expect(unavailableNext).toBeDisabled();
    expect(unavailableNext).toHaveProp("focusable", true);
    expect(StyleSheet.flatten(unavailableNext.props.style)).toMatchObject({
      outlineOffset: 2,
      outlineStyle: "solid",
      outlineWidth: 3,
    });

    act(() =>
      setup.emitStatus({ didJustFinish: true, ended: true, playing: false }),
    );
    expect(
      screen.getByRole("button", { name: "Previous audio item" }),
    ).toBeEnabled();
    fireEvent.press(
      screen.getByRole("button", { name: "Previous audio item" }),
    );
    expect(setup.playlist.previous).toHaveBeenCalledTimes(2);
    act(() => setup.emitTrack({ currentIndex: 2, previousIndex: 3 }));
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Paused Cultivation. Audio item 3 of 4.",
    );
    act(() =>
      setup.emitStatus({
        currentIndex: 2,
        didJustFinish: false,
        ended: false,
        isLoaded: true,
        playing: false,
      }),
    );
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Paused Cultivation. Audio item 3 of 4.",
    );
  });

  it("plays one requested section without staging the rest of the article", async () => {
    const setup = harness();
    renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Listen to Origins in Pumpkin" }),
    );

    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));
    expect(setup.requestSection).toHaveBeenCalledTimes(1);
    expect(setup.requestSection.mock.calls[0]?.[0].sectionKey).toBe(
      "section-0",
    );
    expect(setup.runtime.createPlaylist).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          metadata: expect.objectContaining({ title: "Origins — Pumpkin" }),
        }),
      ],
      expect.any(Function),
      expect.any(Function),
    );
    expect(
      screen.getByRole("button", {
        name: "Playing Origins in Pumpkin. Pause audio",
      }),
    ).toBeEnabled();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Playing Origins.",
    );
    expect(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    ).toBeEnabled();
  });

  it("replays only the selected final item after Play All finishes", async () => {
    const setup = harness();
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));
    act(() =>
      setup.emitStatus({
        currentIndex: 3,
        didJustFinish: true,
        ended: true,
        playing: false,
      }),
    );

    fireEvent.press(
      screen.getByRole("button", { name: "Replay Planting in Pumpkin" }),
    );

    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(2));
    expect(setup.requestSection).toHaveBeenCalledTimes(5);
    expect(setup.requestSection).toHaveBeenLastCalledWith(
      expect.objectContaining({ sectionKey: "section-2" }),
    );
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Playing Planting.",
    );
    expect(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    ).toBeEnabled();
  });

  it("fails safely when native Replay All cannot return to the first item", async () => {
    const setup = harness();
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));
    act(() =>
      setup.emitStatus({
        currentIndex: 3,
        didJustFinish: true,
        ended: true,
        playing: false,
      }),
    );
    (setup.playlist.skipTo as jest.Mock).mockImplementationOnce(() => {
      throw new Error("private bridge failure");
    });

    fireEvent.press(screen.getByRole("button", { name: "Replay all audio" }));

    await waitFor(() =>
      expect(setup.playlist.release).toHaveBeenCalledTimes(1),
    );
    expect(setup.playlist.play).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Could not play the article audio. Please try again.",
    );
    expect(screen.queryByText(/private bridge failure/iu)).toBeNull();
  });

  it("releases the native queue before every temporary file when stopped", async () => {
    const setup = harness();
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));

    fireEvent.press(screen.getByRole("button", { name: "Stop article audio" }));

    await waitFor(() =>
      expect(setup.playlist.release).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => {
      for (const lease of setup.leases) {
        expect(lease.release).toHaveBeenCalledTimes(1);
      }
    });
    expect(
      (setup.playlist.release as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (setup.leases[0]?.release as jest.Mock).mock.invocationCallOrder[0] ?? 0,
    );
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Article audio stopped.",
    );
  });

  it("fails closed at the total temporary-audio cap and releases every staged lease", async () => {
    const perTrackBytes = 16 * 1024 * 1024;
    const setup = harness({ leaseByteLength: perTrackBytes });
    const oversized: WikipediaArticle = {
      ...article(),
      sections: Array.from({ length: 17 }, (_, index) => ({
        content: `Readable section ${index + 1}`,
        level: 2,
        title: `Section ${index + 1}`,
        wikiSectionIndex: String(index + 1),
      })),
      summary: undefined,
    };
    renderPlayer(setup, oversized);

    fireEvent.press(
      screen.getByRole("button", { name: "Play all 17 audio items" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
        /This article's Play All audio is too large to prepare safely\./u,
      ),
    );
    expect(setup.leases).toHaveLength(
      Math.floor(MAX_NATIVE_ARTICLE_PLAYLIST_AUDIO_BYTES / perTrackBytes),
    );
    await waitFor(() => {
      for (const lease of setup.leases) {
        expect(lease.release).toHaveBeenCalledTimes(1);
      }
    });
    expect(setup.loadRuntime).not.toHaveBeenCalled();
  });

  it("releases an over-budget lease when staged bytes exceed the declared aggregate", async () => {
    const perTrackBytes = 15 * 1024 * 1024;
    const setup = harness({ leaseByteLength: perTrackBytes });
    setup.requestSection.mockImplementation(async () => ({
      accountEpoch,
      release: jest.fn(),
      response: readyResponse(1),
      status: "ready",
    }));
    renderPlayer(setup, {
      ...article(),
      sections: Array.from({ length: 18 }, (_, index) => ({
        content: `Readable section ${index + 1}`,
        level: 2,
        title: `Section ${index + 1}`,
        wikiSectionIndex: String(index + 1),
      })),
      summary: undefined,
    });

    fireEvent.press(
      screen.getByRole("button", { name: "Play all 18 audio items" }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
        /This article's Play All audio is too large to prepare safely\./u,
      ),
    );
    expect(setup.leases).toHaveLength(18);
    await waitFor(() => {
      for (const lease of setup.leases) {
        expect(lease.release).toHaveBeenCalledTimes(1);
      }
    });
    expect(
      (setup.leases[17]?.release as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (setup.leases[0]?.release as jest.Mock).mock.invocationCallOrder[0] ?? 0,
    );
    expect(setup.loadRuntime).not.toHaveBeenCalled();
  });

  it("disables only Play All when an article exceeds the fixed track cap", () => {
    const setup = harness();
    const manySections: WikipediaArticle = {
      ...article(),
      sections: Array.from(
        { length: MAX_NATIVE_ARTICLE_PLAYLIST_TRACKS + 1 },
        (_, index) => ({
          content: `Readable section ${index + 1}`,
          level: 2,
          title: `Section ${index + 1}`,
          wikiSectionIndex: String(index + 1),
        }),
      ),
      summary: undefined,
    };
    renderPlayer(setup, manySections);

    const playAll = screen.getByRole("button", {
      name: `Play all ${MAX_NATIVE_ARTICLE_PLAYLIST_TRACKS + 1} audio items — unavailable`,
    });
    expect(playAll).toBeDisabled();
    expect(playAll.props.accessibilityHint).toBeUndefined();
    expect(
      screen.getByRole("button", { name: "Listen to Section 1 in Pumpkin" }),
    ).toBeEnabled();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      new RegExp(
        `Play All supports up to ${MAX_NATIVE_ARTICLE_PLAYLIST_TRACKS} audio items\\.`,
        "u",
      ),
    );
  });

  it("labels a revision with only empty headings as unavailable instead of ready", () => {
    const setup = harness();
    renderPlayer(setup, {
      ...article(),
      sections: [
        {
          content: "",
          level: 2,
          title: "Empty appendix",
          wikiSectionIndex: "1",
        },
      ],
      summary: undefined,
    });

    expect(
      screen.getByRole("button", {
        name: "No audio available — unavailable",
      }),
    ).toBeDisabled();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "No article audio is available for this revision.",
    );
  });

  it("cancels foreground-only preparation on background and releases a late response", async () => {
    const setup = harness();
    const pending =
      deferred<
        Awaited<ReturnType<NativeArticleAudioAccess["requestSection"]>>
      >();
    const lateRelease = jest.fn();
    setup.requestSection.mockReturnValueOnce(pending.promise);
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.requestSection).toHaveBeenCalledTimes(1));
    const signal = setup.requestSection.mock.calls[0]?.[0].signal;

    act(() => appStateListener?.("background"));

    expect(signal?.aborted).toBe(true);
    expect(setup.loadRuntime).not.toHaveBeenCalled();
    expect(screen.getByTestId("article-audio-control")).toBeDisabled();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Article audio preparation cancelled when the app left the foreground.",
    );

    await act(async () => {
      pending.resolve({
        accountEpoch,
        release: lateRelease,
        response: readyResponse(),
        status: "ready",
      });
      await pending.promise;
    });
    expect(lateRelease).toHaveBeenCalledTimes(1);
    expect(setup.store.stage).not.toHaveBeenCalled();
  });

  it("cancels a later Play All preparation row instead of starting that item", async () => {
    const setup = harness();
    const pending =
      deferred<
        Awaited<ReturnType<NativeArticleAudioAccess["requestSection"]>>
      >();
    setup.requestSection
      .mockResolvedValueOnce({
        accountEpoch,
        release: jest.fn(),
        response: readyResponse(),
        status: "ready",
      })
      .mockReturnValueOnce(pending.promise);
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.requestSection).toHaveBeenCalledTimes(2));
    const signal = setup.requestSection.mock.calls[1]?.[0].signal;

    fireEvent.press(
      screen.getByRole("button", {
        name: "Cancel preparing Origins in Pumpkin",
      }),
    );

    expect(signal?.aborted).toBe(true);
    expect(setup.requestSection).toHaveBeenCalledTimes(2);
    expect(setup.runtime.createPlaylist).not.toHaveBeenCalled();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Article audio preparation cancelled.",
    );
  });

  it("cancels startup when the app backgrounds before native playback begins", async () => {
    const setup = harness();
    const pendingPlay = deferred<void>();
    (setup.playlist.play as jest.Mock).mockReturnValueOnce(pendingPlay.promise);
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));

    act(() => appStateListener?.("background"));

    await waitFor(() =>
      expect(setup.playlist.release).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => {
      for (const lease of setup.leases) {
        expect(lease.release).toHaveBeenCalledTimes(1);
      }
    });
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Article audio preparation cancelled when the app left the foreground.",
    );

    await act(async () => {
      pendingPlay.resolve();
      await pendingPlay.promise;
    });
    expect(
      screen.queryByRole("button", { name: "Pause playing all audio" }),
    ).toBeNull();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Article audio preparation cancelled when the app left the foreground.",
    );
  });

  it("keeps ready playback alive in the background and reconciles missed native status", async () => {
    const setup = harness();
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));

    act(() => appStateListener?.("background"));
    expect(setup.playlist.release).not.toHaveBeenCalled();
    for (const lease of setup.leases) {
      expect(lease.release).not.toHaveBeenCalled();
    }

    setup.setStatus({
      currentIndex: 2,
      currentTime: 12,
      duration: 40,
      playing: false,
    });
    act(() => appStateListener?.("active"));

    expect(setup.playlist.getStatus).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Resume playing all audio" }),
    ).toBeEnabled();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Paused Cultivation. Audio item 3 of 4.",
    );
  });

  it("reconciles a paused track change from the foreground snapshot", async () => {
    const setup = harness();
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));
    fireEvent.press(
      screen.getByRole("button", { name: "Pause playing all audio" }),
    );

    act(() => appStateListener?.("background"));
    setup.setStatus({
      currentIndex: 1,
      currentTime: 8,
      ended: false,
      isBuffering: false,
      isLoaded: true,
      playing: false,
    });
    act(() => appStateListener?.("active"));

    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Paused Origins. Audio item 2 of 4.",
    );
    expect(
      screen.getByRole("button", {
        name: "Paused Origins in Pumpkin. Resume audio",
      }),
    ).toBeEnabled();
  });

  it("uses only the durable native terminal state to finish the queue", async () => {
    const setup = harness();
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));

    act(() =>
      setup.emitStatus({
        currentIndex: 1,
        didJustFinish: true,
        ended: false,
        playing: true,
      }),
    );
    expect(
      screen.getByRole("button", { name: "Pause playing all audio" }),
    ).toBeEnabled();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Playing Origins. Audio item 2 of 4.",
    );

    act(() =>
      setup.emitStatus({
        currentIndex: 3,
        currentTime: 29.8,
        didJustFinish: false,
        duration: 30,
        ended: false,
        playing: false,
      }),
    );
    fireEvent.press(
      screen.getByRole("button", { name: "Resume playing all audio" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(2));

    act(() => appStateListener?.("background"));
    setup.setStatus({
      currentIndex: 3,
      currentTime: 0,
      didJustFinish: false,
      duration: 0,
      ended: true,
      isLoaded: false,
      playing: false,
    });
    act(() => appStateListener?.("active"));

    expect(setup.playlist.getStatus).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Replay all audio" }),
    ).toBeEnabled();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Finished playing all article audio.",
    );
  });

  it("tears down the queue on account change before deleting its leased files", async () => {
    const setup = harness();
    const view = renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));

    view.rerenderAccess({
      accountEpoch: Symbol("account-b"),
      requestSection: setup.requestSection,
    });

    await waitFor(() =>
      expect(setup.playlist.release).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => {
      for (const lease of setup.leases) {
        expect(lease.release).toHaveBeenCalledTimes(1);
      }
    });
    expect(
      (setup.playlist.release as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (setup.leases[0]?.release as jest.Mock).mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    ).toBeEnabled();
  });

  it("releases ready route audio before its leases when the route deactivates", async () => {
    const setup = harness();
    const view = renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));

    view.rerenderProps({ active: false });

    await waitFor(() =>
      expect(setup.playlist.release).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => {
      for (const lease of setup.leases) {
        expect(lease.release).toHaveBeenCalledTimes(1);
      }
    });
    expect(
      (setup.playlist.release as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (setup.leases[0]?.release as jest.Mock).mock.invocationCallOrder[0] ?? 0,
    );
    act(() =>
      setup.emitStatus({ currentIndex: 2, ended: false, playing: true }),
    );
    expect(
      screen.queryByRole("button", { name: "Pause playing all audio" }),
    ).toBeNull();
  });

  it("bounds a stalled queue request with one preparation deadline", async () => {
    jest.useFakeTimers();
    const setup = harness();
    setup.requestSection.mockImplementation(() => new Promise(() => undefined));
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.requestSection).toHaveBeenCalledTimes(1));
    const signal = setup.requestSection.mock.calls[0]?.[0].signal;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
    });

    expect(signal?.aborted).toBe(true);
    expect(setup.loadRuntime).not.toHaveBeenCalled();
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Article audio took too long to prepare. Please try again.",
    );
  });

  it("sanitizes native playlist errors and releases the queue before its files", async () => {
    const setup = harness();
    renderPlayer(setup);
    fireEvent.press(
      screen.getByRole("button", { name: "Play all 4 audio items" }),
    );
    await waitFor(() => expect(setup.playlist.play).toHaveBeenCalledTimes(1));

    act(() =>
      setup.emitStatus({
        error: "decoder failed at /private/cache/secret-audio.mp3",
        playing: false,
      }),
    );

    await waitFor(() =>
      expect(setup.playlist.release).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => {
      for (const lease of setup.leases) {
        expect(lease.release).toHaveBeenCalledTimes(1);
      }
    });
    expect(screen.getByTestId("article-audio-status")).toHaveTextContent(
      "Could not play the article audio. Please try again.",
    );
    expect(screen.queryByText(/decoder|private\/cache/iu)).toBeNull();
  });
});
