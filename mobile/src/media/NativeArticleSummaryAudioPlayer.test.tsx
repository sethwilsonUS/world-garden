import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { StrictMode } from "react";
import { AppState, Platform } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import type {
  BackgroundAudioPlaybackStatus,
  BackgroundAudioPlayer,
  BackgroundAudioRuntime,
} from "./ExpoBackgroundAudioRuntime";
import {
  NativeArticleAudioAccessContextProvider,
  type NativeArticleAudioAccess,
} from "./NativeArticleAudioAccessContext";
import type {
  NativeArticleAudioEphemeralLease,
  NativeArticleAudioEphemeralStore,
} from "./NativeArticleAudioEphemeralStore";
import { NativeArticleSummaryAudioPlayer } from "./NativeArticleSummaryAudioPlayer";

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

function readyResponse(): Response {
  return new Response(new Uint8Array([1]), {
    headers: { "content-length": "1", "content-type": "audio/mpeg" },
    status: 200,
  });
}

function harness() {
  const lease: NativeArticleAudioEphemeralLease = {
    release: jest.fn().mockResolvedValue(undefined),
    uri: "file:///private-cache/random-id.mp3",
  };
  const store: NativeArticleAudioEphemeralStore = {
    prepare: jest.fn().mockResolvedValue({ status: "ready" }),
    stage: jest.fn().mockResolvedValue({ lease, status: "ready" }),
  };
  let statusListener!: (status: BackgroundAudioPlaybackStatus) => void;
  let statusSnapshot: BackgroundAudioPlaybackStatus = {
    currentTime: 0,
    didJustFinish: false,
    duration: 90,
    error: null,
    isBuffering: false,
    isLoaded: true,
    playing: true,
  };
  const player: BackgroundAudioPlayer = {
    getStatus: jest.fn(() => statusSnapshot),
    pause: jest.fn(),
    play: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    seekTo: jest.fn().mockResolvedValue(undefined),
  };
  const runtime: BackgroundAudioRuntime = {
    configureBackgroundMode: jest.fn().mockResolvedValue(undefined),
    createPlaylist: jest.fn(),
    createPlayer: jest.fn((_uri, listener) => {
      statusListener = listener;
      return player;
    }),
  };
  const loadRuntime = jest.fn().mockResolvedValue(runtime);
  const requestSection = jest.fn();
  const responseRelease = jest.fn();
  const access: NativeArticleAudioAccess = {
    accountEpoch,
    requestSection,
  };

  return {
    access,
    emitStatus: (overrides: Partial<BackgroundAudioPlaybackStatus>) => {
      statusSnapshot = {
        ...statusSnapshot,
        playing: false,
        ...overrides,
      };
      statusListener(statusSnapshot);
    },
    lease,
    loadRuntime,
    player,
    requestSection,
    responseRelease,
    runtime,
    setStatusSnapshot: (overrides: Partial<BackgroundAudioPlaybackStatus>) => {
      statusSnapshot = { ...statusSnapshot, ...overrides };
    },
    store,
  };
}

function renderPlayer(
  setup: ReturnType<typeof harness>,
  overrides: Partial<
    React.ComponentProps<typeof NativeArticleSummaryAudioPlayer>
  > = {},
  { strict = false }: { readonly strict?: boolean } = {},
) {
  const props = {
    active: true,
    articleTitle: "Pumpkin",
    ephemeralStore: setup.store,
    loadRuntime: setup.loadRuntime,
    narrationVersion: 2,
    revisionId: "1234",
    slug: "Pumpkin",
    ...overrides,
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
        <NativeArticleSummaryAudioPlayer {...playerProps} />
      </NativeArticleAudioAccessContextProvider>
    </GardenThemeProvider>
  );
  const view = render(
    strict ? <StrictMode>{tree(setup.access)}</StrictMode> : tree(setup.access),
  );

  return {
    ...view,
    props,
    rerenderAccess: (access: NativeArticleAudioAccess) =>
      view.rerender(
        strict ? <StrictMode>{tree(access)}</StrictMode> : tree(access),
      ),
    rerenderProps: (
      next: Partial<
        React.ComponentProps<typeof NativeArticleSummaryAudioPlayer>
      >,
    ) => {
      const nextProps = { ...props, ...next };
      view.rerender(
        strict ? (
          <StrictMode>{tree(setup.access, nextProps)}</StrictMode>
        ) : (
          tree(setup.access, nextProps)
        ),
      );
    },
  };
}

async function beginPlayback(setup: ReturnType<typeof harness>) {
  setup.requestSection.mockResolvedValue({
    accountEpoch,
    release: setup.responseRelease,
    response: readyResponse(),
    status: "ready",
  });

  fireEvent.press(
    screen.getByRole("button", { name: "Play full summary audio" }),
  );

  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Pause full summary audio" }),
    ).toBeOnTheScreen();
  });
}

describe("NativeArticleSummaryAudioPlayer", () => {
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

  it("waits for a user action, requests the canonical full summary, and begins local playback", async () => {
    const setup = harness();
    const responseRequest =
      deferred<
        Awaited<ReturnType<NativeArticleAudioAccess["requestSection"]>>
      >();
    setup.requestSection.mockReturnValue(responseRequest.promise);
    renderPlayer(setup);

    expect(setup.requestSection).not.toHaveBeenCalled();
    expect(setup.loadRuntime).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Play full summary audio" }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("summary-audio-control")).toHaveProp(
      "accessibilityHint",
      "Continues in the background and provides lock-screen controls for Pumpkin.",
    );
    expect(screen.getByTestId("summary-audio-time")).toHaveTextContent(
      "Duration available after audio loads.",
    );
    expect(screen.getByTestId("summary-audio-time")).toHaveProp(
      "accessibilityLabel",
      "Audio duration is available after audio loads.",
    );
    expect(screen.getByTestId("summary-audio-disclosure")).toHaveTextContent(
      "Audio is generated with synthetic speech.",
    );
    expect(screen.getByTestId("summary-audio-disclosure")).not.toHaveProp(
      "accessibilityLiveRegion",
      "polite",
    );
    expect(screen.getByTestId("article-summary-audio-player")).toHaveStyle({
      backgroundColor: "#e5e2db",
      borderColor: "#7a8273",
      borderWidth: 2,
    });

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );

    expect(
      screen.getByRole("button", { name: "Cancel preparing summary audio" }),
    ).toBeOnTheScreen();
    await waitFor(() => {
      expect(setup.requestSection).toHaveBeenCalledWith({
        narrationVersion: 2,
        provider: "openai",
        revisionId: "1234",
        sectionKey: "summary",
        signal: expect.any(AbortSignal),
        slug: "Pumpkin",
      });
    });
    expect(setup.loadRuntime).not.toHaveBeenCalled();

    await act(async () => {
      responseRequest.resolve({
        accountEpoch,
        release: setup.responseRelease,
        response: readyResponse(),
        status: "ready",
      });
      await responseRequest.promise;
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Pause full summary audio" }),
      ).toBeOnTheScreen();
    });
    expect(setup.store.prepare).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(setup.store.stage).toHaveBeenCalledWith(
      expect.any(Response),
      expect.any(AbortSignal),
    );
    expect(setup.runtime.createPlayer).toHaveBeenCalledWith(
      {
        metadata: {
          albumTitle: "Curio Garden",
          artist: "Wikipedia",
          title: "Summary — Pumpkin",
        },
        uri: "file:///private-cache/random-id.mp3",
      },
      expect.any(Function),
    );
    expect(setup.player.play).toHaveBeenCalledTimes(1);
    expect(setup.responseRelease).toHaveBeenCalledTimes(1);
    expect(
      (setup.store.stage as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(setup.loadRuntime.mock.invocationCallOrder[0] ?? 0);
    expect(screen.getByTestId("summary-audio-status")).toHaveTextContent(
      "Playing the full summary.",
    );
  });

  it("keeps one operable control through pause, resume, finish, and replay", async () => {
    const setup = harness();
    renderPlayer(setup);
    await beginPlayback(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Pause full summary audio" }),
    );
    expect(setup.player.pause).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Resume full summary audio" }),
    ).toBeOnTheScreen();

    fireEvent.press(
      screen.getByRole("button", { name: "Resume full summary audio" }),
    );
    expect(setup.player.play).toHaveBeenCalledTimes(2);

    act(() => setup.emitStatus({ currentTime: 90, didJustFinish: true }));
    expect(
      screen.getByRole("button", { name: "Replay full summary audio" }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("summary-audio-time")).toHaveTextContent(
      "1:30 of 1:30",
    );
    expect(screen.getByTestId("summary-audio-time")).toHaveProp(
      "accessibilityLabel",
      "Elapsed time 1 minute, 30 seconds. Total duration 1 minute, 30 seconds.",
    );
    expect(screen.getByTestId("summary-audio-time")).not.toHaveProp(
      "accessibilityLiveRegion",
      "polite",
    );

    fireEvent.press(
      screen.getByRole("button", { name: "Replay full summary audio" }),
    );
    await waitFor(() => {
      expect(setup.player.seekTo).toHaveBeenCalledWith(0);
      expect(setup.player.play).toHaveBeenCalledTimes(3);
    });
  });

  it("preserves status progress received while resume activation is pending", async () => {
    const resumed = deferred<void>();
    const setup = harness();
    renderPlayer(setup);
    await beginPlayback(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Pause full summary audio" }),
    );
    (setup.player.play as jest.Mock).mockReturnValueOnce(resumed.promise);
    fireEvent.press(
      screen.getByRole("button", { name: "Resume full summary audio" }),
    );

    act(() => setup.emitStatus({ currentTime: 42, playing: true }));
    expect(screen.getByTestId("summary-audio-time")).toHaveTextContent(
      "0:42 of 1:30",
    );

    await act(async () => {
      resumed.resolve();
      await resumed.promise;
    });

    expect(screen.getByTestId("summary-audio-time")).toHaveTextContent(
      "0:42 of 1:30",
    );
  });

  it("keeps preparation cancellable and ignores a late response", async () => {
    const setup = harness();
    const request =
      deferred<
        Awaited<ReturnType<NativeArticleAudioAccess["requestSection"]>>
      >();
    setup.requestSection.mockReturnValue(request.promise);
    renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );
    await waitFor(() => expect(setup.requestSection).toHaveBeenCalled());
    const signal = setup.requestSection.mock.calls[0]?.[0].signal;

    fireEvent.press(
      screen.getByRole("button", {
        name: "Cancel preparing summary audio",
      }),
    );
    expect(signal?.aborted).toBe(true);
    expect(
      screen.getByRole("button", { name: "Play full summary audio" }),
    ).toBeOnTheScreen();

    await act(async () => {
      request.resolve({
        accountEpoch,
        release: setup.responseRelease,
        response: readyResponse(),
        status: "ready",
      });
      await request.promise;
    });
    expect(setup.store.stage).not.toHaveBeenCalled();
    expect(setup.player.play).not.toHaveBeenCalled();
    expect(setup.responseRelease).toHaveBeenCalledTimes(1);
  });

  it("survives StrictMode effect replay and still reports playback", async () => {
    const setup = harness();
    renderPlayer(setup, {}, { strict: true });

    await beginPlayback(setup);

    expect(
      screen.getByRole("button", { name: "Pause full summary audio" }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("summary-audio-status")).toHaveTextContent(
      "Playing the full summary.",
    );
  });

  it("fails closed on unknown launch state and accepts a user retry after foreground activation", async () => {
    const currentStateDescriptor = Object.getOwnPropertyDescriptor(
      AppState,
      "currentState",
    );
    Object.defineProperty(AppState, "currentState", {
      configurable: true,
      value: null,
    });
    try {
      const setup = harness();
      renderPlayer(setup);

      expect(screen.getByTestId("summary-audio-control")).toBeDisabled();
      expect(setup.requestSection).not.toHaveBeenCalled();

      act(() => appStateListener?.("active"));
      expect(
        screen.getByRole("button", { name: "Play full summary audio" }),
      ).toBeEnabled();

      await beginPlayback(setup);
      expect(setup.requestSection).toHaveBeenCalledTimes(1);
    } finally {
      if (currentStateDescriptor) {
        Object.defineProperty(AppState, "currentState", currentStateDescriptor);
      }
    }
  });

  it("reconciles AppState after subscribing when the first active event was missed", () => {
    Object.defineProperty(AppState, "currentState", {
      configurable: true,
      value: null,
    });
    (AppState.addEventListener as jest.Mock).mockImplementation(
      (_event: string, listener: (state: string) => void) => {
        appStateListener = listener;
        Object.defineProperty(AppState, "currentState", {
          configurable: true,
          value: "active",
        });
        return { remove: jest.fn() };
      },
    );
    const setup = harness();

    renderPlayer(setup);

    expect(
      screen.getByRole("button", { name: "Play full summary audio" }),
    ).toBeEnabled();
    expect(setup.requestSection).not.toHaveBeenCalled();
  });

  it("keeps honest idle copy when an untouched article backgrounds", () => {
    const setup = harness();
    renderPlayer(setup);

    act(() => appStateListener?.("background"));

    expect(screen.getByTestId("summary-audio-status")).toHaveTextContent(
      "Summary audio is ready when you are.",
    );
    expect(setup.runtime.configureBackgroundMode).not.toHaveBeenCalled();
  });

  it("cancels streamed staging on account change before loading expo-audio", async () => {
    const setup = harness();
    const staged =
      deferred<
        Awaited<ReturnType<NativeArticleAudioEphemeralStore["stage"]>>
      >();
    setup.store.stage = jest.fn().mockReturnValue(staged.promise);
    setup.requestSection.mockResolvedValue({
      accountEpoch,
      release: setup.responseRelease,
      response: readyResponse(),
      status: "ready",
    });
    const view = renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );
    await waitFor(() => expect(setup.store.stage).toHaveBeenCalled());
    const stageSignal = (setup.store.stage as jest.Mock).mock.calls[0]?.[1] as
      | AbortSignal
      | undefined;

    view.rerenderAccess({
      ...setup.access,
      accountEpoch: Symbol("account-b"),
    });

    await waitFor(() => expect(setup.responseRelease).toHaveBeenCalledTimes(1));
    expect(stageSignal?.aborted).toBe(true);
    expect(setup.loadRuntime).not.toHaveBeenCalled();

    await act(async () => {
      staged.resolve({ lease: setup.lease, status: "ready" });
      await staged.promise;
    });
    expect(setup.lease.release).toHaveBeenCalledTimes(1);
    expect(setup.player.play).not.toHaveBeenCalled();
  });

  it("bounds stalled body staging with the full preparation deadline", async () => {
    jest.useFakeTimers();
    const setup = harness();
    setup.store.stage = jest.fn(() => new Promise(() => undefined));
    setup.requestSection.mockResolvedValue({
      accountEpoch,
      release: setup.responseRelease,
      response: readyResponse(),
      status: "ready",
    });
    renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );
    await waitFor(() => expect(setup.store.stage).toHaveBeenCalled());
    const stageSignal = (setup.store.stage as jest.Mock).mock.calls[0]?.[1] as
      | AbortSignal
      | undefined;

    await act(async () => {
      await jest.advanceTimersByTimeAsync(240_000);
    });

    expect(stageSignal?.aborted).toBe(true);
    expect(setup.responseRelease).toHaveBeenCalledTimes(1);
    expect(setup.loadRuntime).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Try summary audio again" }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("summary-audio-status")).toHaveTextContent(
      "Summary audio took too long to prepare. Please try again.",
    );
  });

  it("keeps an already-playing summary alive through inactive, background, and foreground transitions", async () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, "OS");
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "android",
    });
    try {
      const setup = harness();
      renderPlayer(setup);
      await beginPlayback(setup);
      act(() => setup.emitStatus({ currentTime: 12, playing: true }));

      expect(screen.getByTestId("summary-audio-status")).toHaveProp(
        "accessibilityLiveRegion",
        "polite",
      );

      act(() => appStateListener?.("inactive"));
      act(() => appStateListener?.("background"));

      expect(setup.player.release).not.toHaveBeenCalled();
      expect(setup.lease.release).not.toHaveBeenCalled();
      expect(screen.getByTestId("summary-audio-status")).not.toHaveProp(
        "accessibilityLiveRegion",
        "polite",
      );
      expect(screen.getByTestId("summary-audio-control")).toBeDisabled();

      setup.setStatusSnapshot({ currentTime: 42, playing: false });
      act(() => appStateListener?.("active"));

      expect(setup.player.getStatus).toHaveBeenCalledTimes(1);
      expect(
        screen.getByRole("button", { name: "Resume full summary audio" }),
      ).toBeEnabled();
      expect(screen.getByTestId("summary-audio-time")).toHaveTextContent(
        "0:42 of 1:30",
      );
      expect(screen.getByTestId("summary-audio-status")).toHaveProp(
        "accessibilityLiveRegion",
        "polite",
      );
      expect(setup.player.play).toHaveBeenCalledTimes(1);
      expect(setup.requestSection).toHaveBeenCalledTimes(1);
    } finally {
      if (platformDescriptor) {
        Object.defineProperty(Platform, "OS", platformDescriptor);
      }
    }
  });

  it("cancels unfinished preparation when backgrounded instead of relying on suspended JavaScript", async () => {
    const setup = harness();
    const request =
      deferred<
        Awaited<ReturnType<NativeArticleAudioAccess["requestSection"]>>
      >();
    setup.requestSection.mockReturnValue(request.promise);
    renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );
    await waitFor(() => expect(setup.requestSection).toHaveBeenCalledTimes(1));
    const signal = setup.requestSection.mock.calls[0]?.[0].signal;

    act(() => appStateListener?.("background"));

    expect(signal?.aborted).toBe(true);
    expect(setup.loadRuntime).not.toHaveBeenCalled();
    expect(setup.player.play).not.toHaveBeenCalled();
    expect(screen.getByTestId("summary-audio-control")).toBeDisabled();

    act(() => appStateListener?.("active"));
    expect(
      screen.getByRole("button", { name: "Play full summary audio" }),
    ).toBeEnabled();
    expect(setup.requestSection).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve({
        accountEpoch,
        release: setup.responseRelease,
        response: readyResponse(),
        status: "ready",
      });
      await request.promise;
    });
    expect(setup.responseRelease).toHaveBeenCalledTimes(1);
    expect(setup.store.stage).not.toHaveBeenCalled();
  });

  it("reconciles a finished iOS snapshot whose one-shot completion flag was lost in the background", async () => {
    const setup = harness();
    renderPlayer(setup);
    await beginPlayback(setup);
    act(() => setup.emitStatus({ currentTime: 89, playing: true }));

    act(() => appStateListener?.("background"));
    setup.setStatusSnapshot({
      currentTime: 90,
      didJustFinish: false,
      playing: false,
    });
    act(() => appStateListener?.("active"));

    expect(
      screen.getByRole("button", { name: "Replay full summary audio" }),
    ).toBeEnabled();
    expect(screen.getByTestId("summary-audio-time")).toHaveTextContent(
      "1:30 of 1:30",
    );
    expect(setup.player.play).toHaveBeenCalledTimes(1);
  });

  it("tears down ready playback when the route deactivates without late resume", async () => {
    const setup = harness();
    const view = renderPlayer(setup);
    await beginPlayback(setup);
    expect(setup.responseRelease).toHaveBeenCalledTimes(1);

    view.rerenderProps({ active: false });

    await waitFor(() => expect(setup.lease.release).toHaveBeenCalledTimes(1));
    expect(setup.player.release).toHaveBeenCalledTimes(1);
    expect(
      (setup.player.release as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (setup.lease.release as jest.Mock).mock.invocationCallOrder[0] ?? 0,
    );
    expect(setup.responseRelease).toHaveBeenCalledTimes(1);

    act(() =>
      setup.emitStatus({
        error: "late native decoder /private/cache/path",
        playing: true,
      }),
    );
    view.rerenderProps({ active: true });

    expect(setup.player.play).toHaveBeenCalledTimes(1);
    expect(setup.requestSection).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "Play full summary audio" }),
    ).toBeOnTheScreen();
  });

  it("waits for native session deactivation before deleting staged audio", async () => {
    const sessionRelease = deferred<void>();
    const setup = harness();
    (setup.player.release as jest.Mock).mockReturnValue(sessionRelease.promise);
    const view = renderPlayer(setup);
    await beginPlayback(setup);

    view.rerenderProps({ active: false });

    await waitFor(() => expect(setup.player.release).toHaveBeenCalledTimes(1));
    expect(setup.lease.release).not.toHaveBeenCalled();

    await act(async () => {
      sessionRelease.resolve();
      await sessionRelease.promise;
    });

    await waitFor(() => expect(setup.lease.release).toHaveBeenCalledTimes(1));
  });

  it("never creates a stale player when the article changes during mode configuration", async () => {
    const configuration = deferred<void>();
    const setup = harness();
    (setup.runtime.configureBackgroundMode as jest.Mock).mockReturnValue(
      configuration.promise,
    );
    setup.requestSection.mockResolvedValue({
      accountEpoch,
      release: setup.responseRelease,
      response: readyResponse(),
      status: "ready",
    });
    const view = renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );
    await waitFor(() =>
      expect(setup.runtime.configureBackgroundMode).toHaveBeenCalledTimes(1),
    );

    view.rerenderProps({ revisionId: "5678", slug: "Winter_squash" });
    await waitFor(() => expect(setup.lease.release).toHaveBeenCalledTimes(1));

    await act(async () => {
      configuration.resolve();
      await configuration.promise;
    });

    expect(setup.runtime.createPlayer).not.toHaveBeenCalled();
    expect(setup.player.play).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Play full summary audio" }),
    ).toBeOnTheScreen();
  });

  it("turns an ephemeral store preparation failure into safe retry copy without requesting audio", async () => {
    const setup = harness();
    setup.store.prepare = jest.fn().mockResolvedValue({ status: "failed" });
    renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Try summary audio again" }),
      ).toBeOnTheScreen();
    });
    expect(screen.getByTestId("summary-audio-status")).toHaveTextContent(
      "Could not play the summary audio. Please try again.",
    );
    expect(setup.requestSection).not.toHaveBeenCalled();
  });

  it("turns an invalid staged response into safe retry copy and releases the response", async () => {
    const setup = harness();
    setup.store.stage = jest.fn().mockResolvedValue({
      reason: "invalid-response",
      status: "failed",
    });
    setup.requestSection.mockResolvedValue({
      accountEpoch,
      release: setup.responseRelease,
      response: readyResponse(),
      status: "ready",
    });
    renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Try summary audio again" }),
      ).toBeOnTheScreen();
    });
    expect(screen.getByTestId("summary-audio-status")).toHaveTextContent(
      "Could not play the summary audio. Please try again.",
    );
    expect(screen.queryByText(/invalid-response/iu)).toBeNull();
    expect(setup.responseRelease).toHaveBeenCalledTimes(1);
  });

  it("turns a transport failure into safe retry copy", async () => {
    const setup = harness();
    setup.requestSection.mockResolvedValue({
      reason: "temporarily-unavailable",
      retryable: true,
      status: "failed",
    });
    renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Try summary audio again" }),
      ).toBeOnTheScreen();
    });
    expect(screen.getByTestId("summary-audio-status")).toHaveTextContent(
      "Could not play the summary audio. Please try again.",
    );
    expect(screen.queryByText(/temporarily-unavailable/iu)).toBeNull();
  });

  it("sanitizes a native playback error and releases player before audio", async () => {
    const setup = harness();
    renderPlayer(setup);
    await beginPlayback(setup);

    act(() =>
      setup.emitStatus({
        error: "secret decoder failure at /private/cache/random-id.mp3",
      }),
    );

    await waitFor(() => expect(setup.lease.release).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", { name: "Try summary audio again" }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId("summary-audio-status")).toHaveTextContent(
      "Could not play the summary audio. Please try again.",
    );
    expect(screen.queryByText(/secret decoder|private\/cache/iu)).toBeNull();
    expect(setup.player.release).toHaveBeenCalledTimes(1);
    expect(
      (setup.player.release as jest.Mock).mock.invocationCallOrder[0],
    ).toBeLessThan(
      (setup.lease.release as jest.Mock).mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("lets a new generation play after an old mode configuration times out", async () => {
    jest.useFakeTimers();
    const oldConfiguration = deferred<void>();
    const setup = harness();
    const secondLease: NativeArticleAudioEphemeralLease = {
      release: jest.fn().mockResolvedValue(undefined),
      uri: "file:///private-cache/second-random-id.mp3",
    };
    (setup.store.stage as jest.Mock)
      .mockResolvedValueOnce({ lease: setup.lease, status: "ready" })
      .mockResolvedValueOnce({ lease: secondLease, status: "ready" });
    (setup.runtime.configureBackgroundMode as jest.Mock)
      .mockReturnValueOnce(oldConfiguration.promise)
      .mockResolvedValue(undefined);
    setup.requestSection.mockResolvedValue({
      accountEpoch,
      release: setup.responseRelease,
      response: readyResponse(),
      status: "ready",
    });
    renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );
    await waitFor(() =>
      expect(setup.runtime.configureBackgroundMode).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(240_000);
    });
    expect(
      screen.getByRole("button", { name: "Try summary audio again" }),
    ).toBeOnTheScreen();
    expect(setup.lease.release).toHaveBeenCalledTimes(1);

    fireEvent.press(
      screen.getByRole("button", { name: "Try summary audio again" }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Pause full summary audio" }),
      ).toBeOnTheScreen();
    });

    await act(async () => {
      oldConfiguration.resolve();
      await oldConfiguration.promise;
    });

    expect(setup.requestSection).toHaveBeenCalledTimes(2);
    expect(setup.loadRuntime).toHaveBeenCalledTimes(2);
    expect(setup.runtime.configureBackgroundMode).toHaveBeenCalledTimes(2);
    expect(setup.runtime.createPlayer).toHaveBeenCalledTimes(1);
    expect(setup.player.play).toHaveBeenCalledTimes(1);
    expect(setup.lease.release).toHaveBeenCalledTimes(1);
    expect(secondLease.release).not.toHaveBeenCalled();
  });

  it("ignores a cancelled mode configuration that completes late", async () => {
    const configuration = deferred<void>();
    const setup = harness();
    (setup.runtime.configureBackgroundMode as jest.Mock).mockReturnValue(
      configuration.promise,
    );
    setup.requestSection.mockResolvedValue({
      accountEpoch,
      release: setup.responseRelease,
      response: readyResponse(),
      status: "ready",
    });
    renderPlayer(setup);

    fireEvent.press(
      screen.getByRole("button", { name: "Play full summary audio" }),
    );
    await waitFor(() =>
      expect(setup.runtime.configureBackgroundMode).toHaveBeenCalledTimes(1),
    );

    fireEvent.press(
      screen.getByRole("button", {
        name: "Cancel preparing summary audio",
      }),
    );
    await waitFor(() => expect(setup.lease.release).toHaveBeenCalledTimes(1));

    await act(async () => {
      configuration.resolve();
      await configuration.promise;
    });

    expect(setup.runtime.createPlayer).not.toHaveBeenCalled();
    expect(setup.player.play).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Play full summary audio" }),
    ).toBeOnTheScreen();
  });
});
