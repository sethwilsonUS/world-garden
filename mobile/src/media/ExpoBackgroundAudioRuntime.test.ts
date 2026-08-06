import {
  createExpoBackgroundAudioRuntime,
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
});
