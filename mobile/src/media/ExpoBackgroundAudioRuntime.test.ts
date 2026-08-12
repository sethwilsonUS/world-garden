import type { AudioPlaylistStatus } from "expo-audio";

import {
  createExpoBackgroundAudioRuntime,
  type BackgroundAudioPlaylistStatus,
  type BackgroundAudioPlaybackStatus,
  type ExpoAudioBoundary,
} from "./ExpoBackgroundAudioRuntime";

const initialStatus: BackgroundAudioPlaybackStatus = {
  currentTime: 0,
  didJustFinish: false,
  duration: 0,
  error: null,
  isBuffering: false,
  isLoaded: false,
  playing: false,
};
const summaryMetadata = {
  albumTitle: "Curio Garden",
  artist: "Wikipedia",
  title: "Summary — Pumpkin",
};
const sectionMetadata = {
  albumTitle: "Pumpkin",
  artist: "Wikipedia",
  title: "History — Pumpkin",
};
const initialPlaylistStatus: BackgroundAudioPlaylistStatus = {
  ...initialStatus,
  currentIndex: 0,
  ended: false,
  playbackRate: 1,
  trackCount: 2,
};
const initialNativePlaylistStatus: AudioPlaylistStatus = {
  currentIndex: 0,
  currentTime: 0,
  didJustFinish: false,
  duration: 0,
  id: "playlist-id",
  isBuffering: false,
  isLoaded: false,
  loop: "none",
  muted: false,
  playbackRate: 1,
  playing: false,
  trackCount: 2,
  volume: 1,
};

type DurableNativePlaylistStatus = AudioPlaylistStatus &
  Readonly<{ ended: boolean }>;

describe("ExpoBackgroundAudioRuntime", () => {
  it("configures playback-only background mode without owning the global session switch", async () => {
    const setIsAudioActiveAsync = jest.fn().mockResolvedValue(undefined);
    const setAudioModeAsync = jest.fn().mockResolvedValue(undefined);
    const boundary = {
      createAudioPlayer: jest.fn(),
      setAudioModeAsync,
      setIsAudioActiveAsync,
    } as unknown as ExpoAudioBoundary;
    const runtime = createExpoBackgroundAudioRuntime(boundary);

    await runtime.configureBackgroundMode();

    expect(setIsAudioActiveAsync).not.toHaveBeenCalled();
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      allowsBackgroundRecording: false,
      allowsRecording: false,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      shouldRouteThroughEarpiece: false,
    });
  });

  it("fails closed when background audio mode configuration fails", async () => {
    const setIsAudioActiveAsync = jest.fn().mockResolvedValue(undefined);
    const boundary = {
      createAudioPlayer: jest.fn(),
      setAudioModeAsync: jest.fn().mockRejectedValue(new Error("native mode")),
      setIsAudioActiveAsync,
    } as unknown as ExpoAudioBoundary;

    await expect(
      createExpoBackgroundAudioRuntime(boundary).configureBackgroundMode(),
    ).rejects.toThrow("native mode");
    expect(setIsAudioActiveAsync).not.toHaveBeenCalled();
  });

  it("publishes one private summary track to lock-screen controls before playback", async () => {
    let statusListener!: (status: BackgroundAudioPlaybackStatus) => void;
    const removeSubscription = jest.fn();
    const nativePlayer = {
      addListener: jest.fn((_event, listener) => {
        statusListener = listener;
        return { remove: removeSubscription };
      }),
      clearLockScreenControls: jest.fn(),
      currentStatus: {
        ...initialStatus,
        currentTime: 7,
        duration: 12,
        isLoaded: true,
      },
      remove: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(),
      release: jest.fn(),
      replace: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
      setActiveForLockScreen: jest.fn(),
    };
    const createAudioPlayer = jest.fn(() => nativePlayer);
    const setIsAudioActiveAsync = jest.fn().mockResolvedValue(undefined);
    const boundary = {
      createAudioPlayer,
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      setIsAudioActiveAsync,
    } as unknown as ExpoAudioBoundary;
    const runtime = createExpoBackgroundAudioRuntime(boundary);
    const onStatus = jest.fn();
    const player = runtime.createPlayer(
      {
        metadata: summaryMetadata,
        uri: "file:///private-cache/random-id.mp3",
      },
      onStatus,
    );

    expect(createAudioPlayer).toHaveBeenCalledWith(null, {
      downloadFirst: false,
      keepAudioSessionActive: true,
      updateInterval: 500,
    });
    expect(nativePlayer.replace).toHaveBeenCalledWith({
      name: "Summary — Pumpkin",
      uri: "file:///private-cache/random-id.mp3",
    });
    expect(nativePlayer.setActiveForLockScreen).not.toHaveBeenCalled();
    expect(nativePlayer.clearLockScreenControls).not.toHaveBeenCalled();

    statusListener({ ...initialStatus, duration: 12, isLoaded: true });
    expect(onStatus).toHaveBeenCalledWith({
      ...initialStatus,
      duration: 12,
      isLoaded: true,
    });
    expect(player.getStatus()).toEqual({
      ...initialStatus,
      currentTime: 7,
      duration: 12,
      isLoaded: true,
    });

    await player.play();
    expect(setIsAudioActiveAsync).toHaveBeenCalledWith(true);
    expect(nativePlayer.setActiveForLockScreen).toHaveBeenCalledWith(
      true,
      summaryMetadata,
      {
        isLiveStream: false,
        showSeekBackward: true,
        showSeekForward: true,
      },
    );
    expect(setIsAudioActiveAsync.mock.invocationCallOrder[0]).toBeLessThan(
      nativePlayer.setActiveForLockScreen.mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      nativePlayer.setActiveForLockScreen.mock.invocationCallOrder[0],
    ).toBeLessThan(nativePlayer.play.mock.invocationCallOrder[0] ?? 0);
    player.pause();
    await player.seekTo(0);
    await player.release();
    await player.release();
    await player.seekTo(9);

    expect(nativePlayer.play).toHaveBeenCalledTimes(1);
    expect(nativePlayer.pause).toHaveBeenCalledTimes(2);
    expect(nativePlayer.seekTo).toHaveBeenCalledWith(0);
    expect(nativePlayer.seekTo).toHaveBeenCalledTimes(1);
    expect(nativePlayer.setActiveForLockScreen).toHaveBeenNthCalledWith(
      2,
      false,
    );
    expect(nativePlayer.clearLockScreenControls).not.toHaveBeenCalled();
    expect(removeSubscription).toHaveBeenCalledTimes(1);
    expect(nativePlayer.remove).toHaveBeenCalledTimes(1);
    expect(nativePlayer.release).toHaveBeenCalledTimes(1);
    expect(setIsAudioActiveAsync.mock.calls).toEqual([[true], [false]]);
    expect(nativePlayer.pause.mock.invocationCallOrder[1]).toBeLessThan(
      nativePlayer.setActiveForLockScreen.mock.invocationCallOrder[1] ?? 0,
    );
    expect(
      nativePlayer.setActiveForLockScreen.mock.invocationCallOrder[1],
    ).toBeLessThan(removeSubscription.mock.invocationCallOrder[0] ?? 0);
    expect(removeSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      nativePlayer.remove.mock.invocationCallOrder[0] ?? 0,
    );
    expect(nativePlayer.remove.mock.invocationCallOrder[0]).toBeLessThan(
      nativePlayer.release.mock.invocationCallOrder[0] ?? 0,
    );

    statusListener({ ...initialStatus, currentTime: 3, isLoaded: true });
    expect(onStatus).toHaveBeenCalledTimes(1);
    Object.defineProperty(nativePlayer, "currentStatus", {
      get: () => {
        throw new Error("released native player");
      },
    });
    expect(player.getStatus()).toEqual({
      ...initialStatus,
      currentTime: 7,
      duration: 12,
      isLoaded: true,
    });
  });

  it("keeps the shared audio session active until the final player releases", async () => {
    const makeNativePlayer = () => ({
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      currentStatus: initialStatus,
      remove: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(),
      release: jest.fn(),
      replace: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
      setActiveForLockScreen: jest.fn(),
    });
    const firstNativePlayer = makeNativePlayer();
    const secondNativePlayer = makeNativePlayer();
    const setIsAudioActiveAsync = jest.fn().mockResolvedValue(undefined);
    const boundary = {
      createAudioPlayer: jest
        .fn()
        .mockReturnValueOnce(firstNativePlayer)
        .mockReturnValueOnce(secondNativePlayer),
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      setIsAudioActiveAsync,
    } as unknown as ExpoAudioBoundary;
    const runtime = createExpoBackgroundAudioRuntime(boundary);
    const firstPlayer = runtime.createPlayer(
      { metadata: summaryMetadata, uri: "file:///private-cache/first.mp3" },
      jest.fn(),
    );
    const secondPlayer = runtime.createPlayer(
      { metadata: summaryMetadata, uri: "file:///private-cache/second.mp3" },
      jest.fn(),
    );

    await firstPlayer.play();
    await secondPlayer.play();
    await firstPlayer.release();

    expect(setIsAudioActiveAsync).not.toHaveBeenCalledWith(false);

    await secondPlayer.release();

    expect(setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
  });

  it("serializes a new play behind an older player's in-flight deactivation", async () => {
    let finishDeactivation!: () => void;
    const deactivation = new Promise<void>((resolve) => {
      finishDeactivation = resolve;
    });
    const makeNativePlayer = () => ({
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      currentStatus: initialStatus,
      remove: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(),
      release: jest.fn(),
      replace: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
      setActiveForLockScreen: jest.fn(),
    });
    const firstNativePlayer = makeNativePlayer();
    const secondNativePlayer = makeNativePlayer();
    const setIsAudioActiveAsync = jest.fn((active: boolean) =>
      active ? Promise.resolve() : deactivation,
    );
    const boundary = {
      createAudioPlayer: jest
        .fn()
        .mockReturnValueOnce(firstNativePlayer)
        .mockReturnValueOnce(secondNativePlayer),
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      setIsAudioActiveAsync,
    } as unknown as ExpoAudioBoundary;
    const runtime = createExpoBackgroundAudioRuntime(boundary);
    const firstPlayer = runtime.createPlayer(
      { metadata: summaryMetadata, uri: "file:///private-cache/first.mp3" },
      jest.fn(),
    );
    const secondPlayer = runtime.createPlayer(
      { metadata: summaryMetadata, uri: "file:///private-cache/second.mp3" },
      jest.fn(),
    );

    await firstPlayer.play();
    const releasing = firstPlayer.release();
    const starting = secondPlayer.play();

    expect(secondNativePlayer.play).not.toHaveBeenCalled();

    finishDeactivation();
    await releasing;
    await starting;

    expect(setIsAudioActiveAsync.mock.calls).toEqual([[true], [false], [true]]);
    expect(secondNativePlayer.play).toHaveBeenCalledTimes(1);
    await secondPlayer.release();
  });

  it("publishes a fixed private queue and native track metadata before playback", async () => {
    let statusListener!: (status: AudioPlaylistStatus) => void;
    let trackListener!: (change: {
      currentIndex: number;
      previousIndex: number;
    }) => void;
    const removeStatusSubscription = jest.fn();
    const removeTrackSubscription = jest.fn();
    const nativePlaylist = {
      addListener: jest.fn((event, listener) => {
        if (event === "playlistStatusUpdate") {
          statusListener = listener;
          return { remove: removeStatusSubscription };
        }
        trackListener = listener;
        return { remove: removeTrackSubscription };
      }),
      currentStatus: {
        ...initialNativePlaylistStatus,
        currentIndex: 1,
        currentTime: 7,
        duration: 12,
        isLoaded: true,
        playbackRate: 1.25,
        playing: true,
      },
      destroy: jest.fn(),
      next: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(),
      previous: jest.fn(),
      release: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
      setActiveForLockScreen: jest.fn(),
      skipTo: jest.fn(),
    };
    const createAudioPlaylist = jest.fn(() => nativePlaylist);
    const setIsAudioActiveAsync = jest.fn().mockResolvedValue(undefined);
    const boundary = {
      createAudioPlayer: jest.fn(),
      createAudioPlaylist,
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      setIsAudioActiveAsync,
    } as unknown as ExpoAudioBoundary;
    const runtime = createExpoBackgroundAudioRuntime(boundary);
    const onStatus = jest.fn();
    const onTrackChanged = jest.fn();
    const playlist = runtime.createPlaylist(
      [
        {
          metadata: summaryMetadata,
          uri: "file:///private-cache/summary.mp3",
        },
        {
          metadata: sectionMetadata,
          uri: "file:///private-cache/history.mp3",
        },
      ],
      onStatus,
      onTrackChanged,
    );

    expect(createAudioPlaylist).toHaveBeenCalledWith({
      loop: "none",
      sources: [
        {
          name: "Summary — Pumpkin",
          uri: "file:///private-cache/summary.mp3",
        },
        {
          name: "History — Pumpkin",
          uri: "file:///private-cache/history.mp3",
        },
      ],
      updateInterval: 500,
    });
    expect(nativePlaylist.setActiveForLockScreen).not.toHaveBeenCalled();

    const failedStatus = {
      ...nativePlaylist.currentStatus,
      currentIndex: 0,
      currentTime: 2,
      error: "History track failed",
      playbackRate: 1,
      playing: false,
    };
    statusListener(failedStatus);
    trackListener({ currentIndex: 1, previousIndex: 0 });
    expect(onStatus).toHaveBeenCalledWith({
      ...initialPlaylistStatus,
      currentTime: 2,
      duration: 12,
      error: "History track failed",
      isLoaded: true,
    });
    expect(onTrackChanged).toHaveBeenCalledWith({
      currentIndex: 1,
      previousIndex: 0,
    });
    expect(playlist.getStatus()).toEqual({
      ...initialPlaylistStatus,
      currentIndex: 1,
      currentTime: 7,
      duration: 12,
      isLoaded: true,
      playbackRate: 1.25,
      playing: true,
    });

    await playlist.play();
    expect(setIsAudioActiveAsync).toHaveBeenCalledWith(true);
    expect(nativePlaylist.setActiveForLockScreen).toHaveBeenCalledWith(
      true,
      [summaryMetadata, sectionMetadata],
      {
        isLiveStream: false,
        showSeekBackward: true,
        showSeekForward: true,
      },
    );
    expect(
      nativePlaylist.setActiveForLockScreen.mock.invocationCallOrder[0],
    ).toBeLessThan(nativePlaylist.play.mock.invocationCallOrder[0] ?? 0);

    playlist.pause();
    playlist.next();
    playlist.previous();
    playlist.skipTo(1);
    await playlist.seekTo(4);
    await playlist.release();
    await playlist.release();
    playlist.next();
    playlist.previous();
    playlist.skipTo(0);
    await playlist.seekTo(9);

    expect(nativePlaylist.pause).toHaveBeenCalledTimes(2);
    expect(nativePlaylist.next).toHaveBeenCalledTimes(1);
    expect(nativePlaylist.previous).toHaveBeenCalledTimes(1);
    expect(nativePlaylist.skipTo).toHaveBeenCalledTimes(1);
    expect(nativePlaylist.skipTo).toHaveBeenCalledWith(1);
    expect(nativePlaylist.seekTo).toHaveBeenCalledTimes(1);
    expect(nativePlaylist.seekTo).toHaveBeenCalledWith(4);
    expect(nativePlaylist.setActiveForLockScreen).toHaveBeenNthCalledWith(
      2,
      false,
    );
    expect(removeStatusSubscription).toHaveBeenCalledTimes(1);
    expect(removeTrackSubscription).toHaveBeenCalledTimes(1);
    expect(nativePlaylist.destroy).toHaveBeenCalledTimes(1);
    expect(nativePlaylist.release).toHaveBeenCalledTimes(1);
    expect(setIsAudioActiveAsync.mock.calls).toEqual([[true], [false]]);

    statusListener(nativePlaylist.currentStatus);
    trackListener({ currentIndex: 0, previousIndex: 1 });
    expect(onStatus).toHaveBeenCalledTimes(1);
    expect(onTrackChanged).toHaveBeenCalledTimes(1);
    Object.defineProperty(nativePlaylist, "currentStatus", {
      get: () => {
        throw new Error("released native playlist");
      },
    });
    expect(playlist.getStatus()).toEqual({
      ...initialPlaylistStatus,
      currentIndex: 1,
      currentTime: 7,
      duration: 12,
      isLoaded: true,
      playbackRate: 1.25,
      playing: true,
    });
  });

  it("preserves durable native playlist completion after the one-shot finish flag clears", () => {
    let statusListener!: (status: DurableNativePlaylistStatus) => void;
    let nativeStatus: DurableNativePlaylistStatus = {
      ...initialNativePlaylistStatus,
      currentIndex: 1,
      didJustFinish: true,
      ended: true,
      trackCount: 2,
    };
    const nativePlaylist = {
      addListener: jest.fn((event, listener) => {
        if (event === "playlistStatusUpdate") statusListener = listener;
        return { remove: jest.fn() };
      }),
      get currentStatus() {
        return nativeStatus;
      },
      destroy: jest.fn(),
      next: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(),
      previous: jest.fn(),
      release: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
      setActiveForLockScreen: jest.fn(),
      skipTo: jest.fn(),
    };
    const runtime = createExpoBackgroundAudioRuntime({
      createAudioPlayer: jest.fn(),
      createAudioPlaylist: jest.fn(() => nativePlaylist),
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      setIsAudioActiveAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as ExpoAudioBoundary);
    const onStatus = jest.fn();
    const playlist = runtime.createPlaylist(
      [
        {
          metadata: summaryMetadata,
          uri: "file:///private-cache/summary.mp3",
        },
        {
          metadata: sectionMetadata,
          uri: "file:///private-cache/history.mp3",
        },
      ],
      onStatus,
      jest.fn(),
    );

    statusListener(nativeStatus);
    expect(onStatus).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentIndex: 1,
        didJustFinish: true,
        ended: true,
      }),
    );

    nativeStatus = { ...nativeStatus, didJustFinish: false };
    expect(playlist.getStatus()).toEqual(
      expect.objectContaining({
        currentIndex: 1,
        didJustFinish: false,
        ended: true,
      }),
    );
  });

  it("keeps the shared audio session active across independently loaded player and playlist runtimes", async () => {
    const nativePlayer = {
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      currentStatus: initialStatus,
      pause: jest.fn(),
      play: jest.fn(),
      release: jest.fn(),
      remove: jest.fn(),
      replace: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
      setActiveForLockScreen: jest.fn(),
    };
    const nativePlaylist = {
      addListener: jest.fn(() => ({ remove: jest.fn() })),
      currentStatus: {
        ...initialNativePlaylistStatus,
        trackCount: 1,
      },
      destroy: jest.fn(),
      next: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(),
      previous: jest.fn(),
      release: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
      setActiveForLockScreen: jest.fn(),
      skipTo: jest.fn(),
    };
    const setIsAudioActiveAsync = jest.fn().mockResolvedValue(undefined);
    const setAudioModeAsync = jest.fn().mockResolvedValue(undefined);
    const playerRuntime = createExpoBackgroundAudioRuntime({
      createAudioPlayer: jest.fn(() => nativePlayer),
      createAudioPlaylist: jest.fn(),
      setAudioModeAsync,
      setIsAudioActiveAsync,
    } as unknown as ExpoAudioBoundary);
    const playlistRuntime = createExpoBackgroundAudioRuntime({
      createAudioPlayer: jest.fn(),
      createAudioPlaylist: jest.fn(() => nativePlaylist),
      setAudioModeAsync,
      setIsAudioActiveAsync,
    } as unknown as ExpoAudioBoundary);
    const player = playerRuntime.createPlayer(
      { metadata: summaryMetadata, uri: "file:///private-cache/summary.mp3" },
      jest.fn(),
    );
    const playlist = playlistRuntime.createPlaylist(
      [
        {
          metadata: sectionMetadata,
          uri: "file:///private-cache/history.mp3",
        },
      ],
      jest.fn(),
      jest.fn(),
    );

    await player.play();
    await playlist.play();
    await player.release();
    expect(setIsAudioActiveAsync).not.toHaveBeenCalledWith(false);

    await playlist.release();
    expect(setIsAudioActiveAsync).toHaveBeenLastCalledWith(false);
  });

  it.each([
    { label: "an empty", sources: [] },
    {
      label: "a non-private",
      sources: [
        {
          metadata: summaryMetadata,
          uri: "file:///private-cache/summary.mp3",
        },
        {
          metadata: sectionMetadata,
          uri: "https://example.com/history.mp3",
        },
      ],
    },
  ])("rejects $label queue before native creation", ({ sources }) => {
    const createAudioPlaylist = jest.fn();
    const boundary = {
      createAudioPlayer: jest.fn(),
      createAudioPlaylist,
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      setIsAudioActiveAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as ExpoAudioBoundary;
    const runtime = createExpoBackgroundAudioRuntime(boundary);

    expect(() => runtime.createPlaylist(sources, jest.fn(), jest.fn())).toThrow(
      /private local audio file|at least one track/,
    );
    expect(createAudioPlaylist).not.toHaveBeenCalled();
  });

  it.each(["https://example.com/audio.mp3", "data:audio/mpeg;base64,AA=="])(
    "rejects a non-private playback source before creating a native player (%s)",
    (uri) => {
      const createAudioPlayer = jest.fn();
      const boundary = {
        createAudioPlayer,
        setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
        setIsAudioActiveAsync: jest.fn().mockResolvedValue(undefined),
      } as unknown as ExpoAudioBoundary;
      const runtime = createExpoBackgroundAudioRuntime(boundary);

      expect(() =>
        runtime.createPlayer({ metadata: summaryMetadata, uri }, jest.fn()),
      ).toThrow("private local audio file");
      expect(createAudioPlayer).not.toHaveBeenCalled();
    },
  );

  it("removes and releases a native player when status-listener registration fails", () => {
    const nativePlayer = {
      addListener: jest.fn(() => {
        throw new Error("native listener");
      }),
      currentStatus: initialStatus,
      remove: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(),
      release: jest.fn(),
      replace: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
    };
    const boundary = {
      createAudioPlayer: jest.fn(() => nativePlayer),
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      setIsAudioActiveAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as ExpoAudioBoundary;
    const runtime = createExpoBackgroundAudioRuntime(boundary);

    expect(() =>
      runtime.createPlayer(
        {
          metadata: summaryMetadata,
          uri: "file:///private-cache/random-id.mp3",
        },
        jest.fn(),
      ),
    ).toThrow("native listener");
    expect(nativePlayer.replace).not.toHaveBeenCalled();
    expect(nativePlayer.remove).toHaveBeenCalledTimes(1);
    expect(nativePlayer.release).toHaveBeenCalledTimes(1);
    expect(nativePlayer.remove.mock.invocationCallOrder[0]).toBeLessThan(
      nativePlayer.release.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("destroys a native playlist when listener registration is incomplete", () => {
    const removeStatusSubscription = jest.fn();
    const nativePlaylist = {
      addListener: jest
        .fn()
        .mockReturnValueOnce({ remove: removeStatusSubscription })
        .mockImplementationOnce(() => {
          throw new Error("native track listener");
        }),
      currentStatus: initialNativePlaylistStatus,
      destroy: jest.fn(),
      next: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(),
      previous: jest.fn(),
      release: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
      setActiveForLockScreen: jest.fn(),
      skipTo: jest.fn(),
    };
    const boundary = {
      createAudioPlayer: jest.fn(),
      createAudioPlaylist: jest.fn(() => nativePlaylist),
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      setIsAudioActiveAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as ExpoAudioBoundary;
    const runtime = createExpoBackgroundAudioRuntime(boundary);

    expect(() =>
      runtime.createPlaylist(
        [
          {
            metadata: summaryMetadata,
            uri: "file:///private-cache/summary.mp3",
          },
        ],
        jest.fn(),
        jest.fn(),
      ),
    ).toThrow("native track listener");
    expect(removeStatusSubscription).toHaveBeenCalledTimes(1);
    expect(nativePlaylist.pause).toHaveBeenCalledTimes(1);
    expect(nativePlaylist.destroy).toHaveBeenCalledTimes(1);
    expect(nativePlaylist.release).toHaveBeenCalledTimes(1);
    expect(nativePlaylist.pause.mock.invocationCallOrder[0]).toBeLessThan(
      nativePlaylist.destroy.mock.invocationCallOrder[0] ?? 0,
    );
    expect(nativePlaylist.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      nativePlaylist.release.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
