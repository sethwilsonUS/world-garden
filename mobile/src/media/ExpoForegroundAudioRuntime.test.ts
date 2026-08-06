import {
  createExpoForegroundAudioRuntime,
  type ExpoAudioBoundary,
  type ForegroundAudioPlaybackStatus,
} from "./ExpoForegroundAudioRuntime";

const initialStatus: ForegroundAudioPlaybackStatus = {
  currentTime: 0,
  didJustFinish: false,
  duration: 0,
  error: null,
  isBuffering: false,
  isLoaded: false,
  playing: false,
};

describe("ExpoForegroundAudioRuntime", () => {
  it("configures foreground-only non-recording mode without owning the global session switch", async () => {
    const setIsAudioActiveAsync = jest.fn().mockResolvedValue(undefined);
    const setAudioModeAsync = jest.fn().mockResolvedValue(undefined);
    const boundary = {
      createAudioPlayer: jest.fn(),
      setAudioModeAsync,
      setIsAudioActiveAsync,
    } as unknown as ExpoAudioBoundary;
    const runtime = createExpoForegroundAudioRuntime(boundary);

    await runtime.configureForegroundMode();

    expect(setIsAudioActiveAsync).not.toHaveBeenCalled();
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      allowsBackgroundRecording: false,
      allowsRecording: false,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      shouldRouteThroughEarpiece: false,
    });
  });

  it("fails closed when foreground audio mode configuration fails", async () => {
    const setIsAudioActiveAsync = jest.fn().mockResolvedValue(undefined);
    const boundary = {
      createAudioPlayer: jest.fn(),
      setAudioModeAsync: jest.fn().mockRejectedValue(new Error("native mode")),
      setIsAudioActiveAsync,
    } as unknown as ExpoAudioBoundary;

    await expect(
      createExpoForegroundAudioRuntime(boundary).configureForegroundMode(),
    ).rejects.toThrow("native mode");
    expect(setIsAudioActiveAsync).not.toHaveBeenCalled();
  });

  it("owns one local source without preloading or lock-screen registration", async () => {
    let statusListener!: (status: ForegroundAudioPlaybackStatus) => void;
    const removeSubscription = jest.fn();
    const nativePlayer = {
      addListener: jest.fn((_event, listener) => {
        statusListener = listener;
        return { remove: removeSubscription };
      }),
      clearLockScreenControls: jest.fn(),
      remove: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(),
      release: jest.fn(),
      replace: jest.fn(),
      seekTo: jest.fn().mockResolvedValue(undefined),
      setActiveForLockScreen: jest.fn(),
    };
    const createAudioPlayer = jest.fn(() => nativePlayer);
    const boundary = {
      createAudioPlayer,
      setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
      setIsAudioActiveAsync: jest.fn().mockResolvedValue(undefined),
    } as unknown as ExpoAudioBoundary;
    const runtime = createExpoForegroundAudioRuntime(boundary);
    const onStatus = jest.fn();

    const player = runtime.createPlayer(
      "file:///private-cache/random-id.mp3",
      onStatus,
    );

    expect(createAudioPlayer).toHaveBeenCalledWith(null, {
      downloadFirst: false,
      keepAudioSessionActive: false,
      updateInterval: 500,
    });
    expect(nativePlayer.replace).toHaveBeenCalledWith({
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

    player.play();
    player.pause();
    await player.seekTo(0);
    player.release();
    player.release();

    expect(nativePlayer.play).toHaveBeenCalledTimes(1);
    expect(nativePlayer.pause).toHaveBeenCalledTimes(2);
    expect(nativePlayer.seekTo).toHaveBeenCalledWith(0);
    expect(removeSubscription).toHaveBeenCalledTimes(1);
    expect(nativePlayer.remove).toHaveBeenCalledTimes(1);
    expect(nativePlayer.release).toHaveBeenCalledTimes(1);
    expect(nativePlayer.pause.mock.invocationCallOrder[1]).toBeLessThan(
      removeSubscription.mock.invocationCallOrder[0] ?? 0,
    );
    expect(removeSubscription.mock.invocationCallOrder[0]).toBeLessThan(
      nativePlayer.remove.mock.invocationCallOrder[0] ?? 0,
    );
    expect(nativePlayer.remove.mock.invocationCallOrder[0]).toBeLessThan(
      nativePlayer.release.mock.invocationCallOrder[0] ?? 0,
    );

    statusListener({ ...initialStatus, currentTime: 3, isLoaded: true });
    expect(onStatus).toHaveBeenCalledTimes(1);
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
      const runtime = createExpoForegroundAudioRuntime(boundary);

      expect(() => runtime.createPlayer(uri, jest.fn())).toThrow(
        "private local audio file",
      );
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
    const runtime = createExpoForegroundAudioRuntime(boundary);

    expect(() =>
      runtime.createPlayer("file:///private-cache/random-id.mp3", jest.fn()),
    ).toThrow("native listener");
    expect(nativePlayer.replace).not.toHaveBeenCalled();
    expect(nativePlayer.remove).toHaveBeenCalledTimes(1);
    expect(nativePlayer.release).toHaveBeenCalledTimes(1);
    expect(nativePlayer.remove.mock.invocationCallOrder[0]).toBeLessThan(
      nativePlayer.release.mock.invocationCallOrder[0] ?? 0,
    );
  });
});
