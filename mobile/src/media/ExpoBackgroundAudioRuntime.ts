export type BackgroundAudioPlaybackStatus = Readonly<{
  currentTime: number;
  didJustFinish: boolean;
  duration: number;
  error: string | null;
  isBuffering: boolean;
  isLoaded: boolean;
  playing: boolean;
}>;

export type BackgroundAudioPlaylistStatus = BackgroundAudioPlaybackStatus &
  Readonly<{
    currentIndex: number;
    ended: boolean;
    playbackRate: number;
    trackCount: number;
  }>;

export type BackgroundAudioTrackChange = Readonly<{
  currentIndex: number;
  previousIndex: number;
}>;

export type BackgroundAudioMetadata = Readonly<{
  albumTitle: string;
  artist: string;
  title: string;
}>;

export type BackgroundAudioSource = Readonly<{
  metadata: BackgroundAudioMetadata;
  uri: string;
}>;

type InstalledExpoAudioModule = typeof import("expo-audio");
type InstalledAudioPlaylist = ReturnType<
  InstalledExpoAudioModule["createAudioPlaylist"]
>;
type CurioPatchedAudioPlaylist = InstalledAudioPlaylist & {
  clearLockScreenControls: () => void;
  setActiveForLockScreen: (
    active: boolean,
    metadata?: BackgroundAudioMetadata[],
    options?: Readonly<{
      isLiveStream?: boolean;
      showSeekBackward?: boolean;
      showSeekForward?: boolean;
    }>,
  ) => void;
};

type NativeAudioSubscription = Readonly<{ remove: () => void }>;

type NativeAudioPlaybackStatus = Readonly<{
  currentTime: number;
  didJustFinish: boolean;
  duration: number;
  error?: string | null;
  isBuffering: boolean;
  isLoaded: boolean;
  playing: boolean;
}>;

type NativeAudioPlaylistStatus = NativeAudioPlaybackStatus &
  Readonly<{
    currentIndex: number;
    // Expo Audio 57.0.4 omits these from its playlist status type. The pinned
    // native patch emits them while this optional seam keeps pristine installs
    // typecheckable before the native build hook runs.
    ended?: boolean;
    playbackRate: number;
    trackCount: number;
  }>;

interface NativeAudioPlayerPort {
  readonly currentStatus: NativeAudioPlaybackStatus;
  readonly addListener: (
    event: "playbackStatusUpdate",
    listener: (status: NativeAudioPlaybackStatus) => void,
  ) => NativeAudioSubscription;
  readonly pause: () => void;
  readonly play: () => void;
  readonly release: () => void;
  readonly remove: () => void;
  readonly replace: (source: Readonly<{ name: string; uri: string }>) => void;
  readonly seekTo: (seconds: number) => Promise<void>;
  readonly setActiveForLockScreen: (
    active: boolean,
    metadata?: BackgroundAudioMetadata,
    options?: Readonly<{
      isLiveStream?: boolean;
      showSeekBackward?: boolean;
      showSeekForward?: boolean;
    }>,
  ) => void;
  readonly setPlaybackRate: (rate: number, quality: "high") => void;
}

interface NativeAudioPlaylistPort {
  readonly currentStatus: NativeAudioPlaylistStatus;
  playbackRate: number;
  readonly addListener: {
    (
      event: "playlistStatusUpdate",
      listener: (status: NativeAudioPlaylistStatus) => void,
    ): NativeAudioSubscription;
    (
      event: "trackChanged",
      listener: (change: BackgroundAudioTrackChange) => void,
    ): NativeAudioSubscription;
  };
  readonly destroy: () => void;
  readonly next: () => void;
  readonly pause: () => void;
  readonly play: () => void;
  readonly previous: () => void;
  readonly release: () => void;
  readonly seekTo: (seconds: number) => Promise<void>;
  readonly setActiveForLockScreen: (
    active: boolean,
    metadata?: BackgroundAudioMetadata[],
    options?: Readonly<{
      isLiveStream?: boolean;
      showSeekBackward?: boolean;
      showSeekForward?: boolean;
    }>,
  ) => void;
  readonly skipTo: (index: number) => void;
}

type NativeAudioMode = Readonly<{
  allowsBackgroundRecording: boolean;
  allowsRecording: boolean;
  interruptionMode: "doNotMix";
  playsInSilentMode: boolean;
  shouldPlayInBackground: boolean;
  shouldRouteThroughEarpiece: boolean;
}>;

export interface ExpoAudioBoundary {
  readonly createAudioPlayer: (
    source: null,
    options: Readonly<{
      downloadFirst: boolean;
      keepAudioSessionActive: boolean;
      updateInterval: number;
    }>,
  ) => NativeAudioPlayerPort;
  readonly createAudioPlaylist: (options: Readonly<{
    loop: "none";
    sources: readonly Readonly<{ name: string; uri: string }>[];
    updateInterval: number;
  }>) => NativeAudioPlaylistPort;
  readonly setAudioModeAsync: (mode: NativeAudioMode) => Promise<void>;
  readonly setIsAudioActiveAsync: (active: boolean) => Promise<void>;
}

export interface BackgroundAudioPlayer {
  getStatus: () => BackgroundAudioPlaybackStatus;
  pause: () => void;
  play: () => Promise<void>;
  release: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  setPlaybackRate: (rate: number) => void;
}

export interface BackgroundAudioPlaylist {
  getStatus: () => BackgroundAudioPlaylistStatus;
  next: () => void;
  pause: () => void;
  play: () => Promise<void>;
  previous: () => void;
  release: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  setPlaybackRate: (rate: number) => void;
  skipTo: (index: number) => void;
}

export interface BackgroundAudioRuntime {
  configureBackgroundMode: () => Promise<void>;
  createPlayer: (
    source: BackgroundAudioSource,
    onStatus: (status: BackgroundAudioPlaybackStatus) => void,
  ) => BackgroundAudioPlayer;
  createPlaylist: (
    sources: readonly BackgroundAudioSource[],
    onStatus: (status: BackgroundAudioPlaylistStatus) => void,
    onTrackChanged: (change: BackgroundAudioTrackChange) => void,
  ) => BackgroundAudioPlaylist;
}

function safely(operation: () => void): void {
  try {
    operation();
  } catch (_error: unknown) {
    void _error;
  }
}

type AudioSessionCoordinator = {
  ownerCount: number;
  transition: Promise<void>;
};

const audioSessionCoordinators = new WeakMap<
  ExpoAudioBoundary["setIsAudioActiveAsync"],
  AudioSessionCoordinator
>();

function getAudioSessionCoordinator(
  audio: ExpoAudioBoundary,
): AudioSessionCoordinator {
  // Lazy runtime loads wrap the same Expo module in fresh boundary objects.
  // The stable native session function keeps those wrappers on one lease.
  const existing = audioSessionCoordinators.get(audio.setIsAudioActiveAsync);
  if (existing !== undefined) return existing;

  const created: AudioSessionCoordinator = {
    ownerCount: 0,
    transition: Promise.resolve(),
  };
  audioSessionCoordinators.set(audio.setIsAudioActiveAsync, created);
  return created;
}

function queueAudioSessionState(
  audio: ExpoAudioBoundary,
  coordinator: AudioSessionCoordinator,
  active: boolean,
): Promise<void> {
  const transition = coordinator.transition
    .catch((_error: unknown) => undefined)
    .then(() => audio.setIsAudioActiveAsync(active));
  coordinator.transition = transition;
  return transition;
}

type BackgroundAudioLifecycleOperations = Readonly<{
  activateLockScreen: () => void;
  deactivateLockScreen: () => void;
  pause: () => void;
  play: () => void;
  teardown: () => void;
}>;

type BackgroundAudioLifecycle = Readonly<{
  isReleased: () => boolean;
  play: () => Promise<void>;
  release: () => Promise<void>;
}>;

function createBackgroundAudioLifecycle(
  audio: ExpoAudioBoundary,
  session: AudioSessionCoordinator,
  operations: BackgroundAudioLifecycleOperations,
): BackgroundAudioLifecycle {
  let lockScreenActive = false;
  let released = false;
  let releasePromise: Promise<void> | null = null;
  let playPromise: Promise<void> | null = null;
  let sessionRetained = false;

  const play = (): Promise<void> => {
    if (released) return Promise.resolve();
    if (playPromise !== null) return playPromise;

    const retainedForThisPlay = !sessionRetained;
    if (retainedForThisPlay) {
      sessionRetained = true;
      session.ownerCount += 1;
    }

    const pending = (async () => {
      try {
        await queueAudioSessionState(audio, session, true);
        if (released) return;

        if (!lockScreenActive) {
          operations.activateLockScreen();
          lockScreenActive = true;
        }
        operations.play();
      } catch (error: unknown) {
        if (retainedForThisPlay && sessionRetained) {
          sessionRetained = false;
          session.ownerCount -= 1;
          try {
            await queueAudioSessionState(
              audio,
              session,
              session.ownerCount > 0,
            );
          } catch (_recoveryError: unknown) {
            void _recoveryError;
          }
        }
        throw error;
      } finally {
        playPromise = null;
      }
    })();
    playPromise = pending;
    return pending;
  };

  const release = (): Promise<void> => {
    if (releasePromise !== null) return releasePromise;
    released = true;
    safely(operations.pause);
    if (lockScreenActive) {
      safely(operations.deactivateLockScreen);
      lockScreenActive = false;
    }
    safely(operations.teardown);

    if (sessionRetained) {
      sessionRetained = false;
      session.ownerCount -= 1;
      releasePromise = queueAudioSessionState(
        audio,
        session,
        session.ownerCount > 0,
      );
    } else {
      releasePromise = Promise.resolve();
    }
    return releasePromise;
  };

  return {
    isReleased: () => released,
    play,
    release,
  };
}

function normalizeStatus(
  status: NativeAudioPlaybackStatus,
): BackgroundAudioPlaybackStatus {
  return {
    currentTime: status.currentTime,
    didJustFinish: status.didJustFinish,
    duration: status.duration,
    error: typeof status.error === "string" ? status.error : null,
    isBuffering: status.isBuffering,
    isLoaded: status.isLoaded,
    playing: status.playing,
  };
}

function normalizePlaylistStatus(
  status: NativeAudioPlaylistStatus,
): BackgroundAudioPlaylistStatus {
  return {
    currentIndex: status.currentIndex,
    currentTime: status.currentTime,
    didJustFinish: status.didJustFinish,
    duration: status.duration,
    ended: status.ended === true,
    error: typeof status.error === "string" ? status.error : null,
    isBuffering: status.isBuffering,
    isLoaded: status.isLoaded,
    playbackRate: status.playbackRate,
    playing: status.playing,
    trackCount: status.trackCount,
  };
}

export function createExpoBackgroundAudioRuntime(
  audio: ExpoAudioBoundary,
): BackgroundAudioRuntime {
  const session = getAudioSessionCoordinator(audio);

  return {
    configureBackgroundMode: () =>
      audio.setAudioModeAsync({
        allowsBackgroundRecording: false,
        allowsRecording: false,
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        shouldRouteThroughEarpiece: false,
      }),

    createPlaylist: (sources, onStatus, onTrackChanged) => {
      if (sources.length === 0) {
        throw new Error("Expected at least one track in the audio playlist");
      }
      for (const source of sources) {
        if (!source.uri.startsWith("file:///")) {
          throw new Error("Expected a private local audio file URI");
        }
      }

      // This is deliberately a fixed-source queue. Keeping mutation methods out
      // of the public boundary guarantees that native metadata remains aligned
      // with the section order while JavaScript is suspended.
      const metadata = sources.map((source) => ({ ...source.metadata }));
      const nativePlaylist = audio.createAudioPlaylist({
        loop: "none",
        sources: sources.map(({ metadata: sourceMetadata, uri }) => ({
          name: sourceMetadata.title,
          uri,
        })),
        updateInterval: 500,
      });
      let lastStatus = normalizePlaylistStatus(nativePlaylist.currentStatus);
      let statusSubscription: Readonly<{ remove: () => void }> | null = null;
      let trackSubscription: Readonly<{ remove: () => void }> | null = null;
      const lifecycle = createBackgroundAudioLifecycle(audio, session, {
        activateLockScreen: () =>
          nativePlaylist.setActiveForLockScreen(true, metadata, {
            isLiveStream: false,
            showSeekBackward: true,
            showSeekForward: true,
          }),
        deactivateLockScreen: () =>
          nativePlaylist.setActiveForLockScreen(false),
        pause: () => nativePlaylist.pause(),
        play: () => nativePlaylist.play(),
        teardown: () => {
          safely(() => statusSubscription?.remove());
          safely(() => trackSubscription?.remove());
          safely(() => nativePlaylist.destroy());
          safely(() => nativePlaylist.release());
        },
      });
      try {
        statusSubscription = nativePlaylist.addListener(
          "playlistStatusUpdate",
          (status) => {
            if (lifecycle.isReleased()) return;
            lastStatus = normalizePlaylistStatus(status);
            onStatus(lastStatus);
          },
        );
        trackSubscription = nativePlaylist.addListener(
          "trackChanged",
          (change) => {
            if (lifecycle.isReleased()) return;
            onTrackChanged(change);
          },
        );
      } catch (error: unknown) {
        void lifecycle.release();
        throw error;
      }

      return {
        getStatus: () => {
          if (!lifecycle.isReleased()) {
            lastStatus = normalizePlaylistStatus(nativePlaylist.currentStatus);
          }
          return lastStatus;
        },
        next: () => {
          if (!lifecycle.isReleased()) nativePlaylist.next();
        },
        pause: () => {
          if (!lifecycle.isReleased()) nativePlaylist.pause();
        },
        play: lifecycle.play,
        previous: () => {
          if (!lifecycle.isReleased()) nativePlaylist.previous();
        },
        release: lifecycle.release,
        seekTo: (seconds) =>
          lifecycle.isReleased()
            ? Promise.resolve()
            : nativePlaylist.seekTo(seconds),
        setPlaybackRate: (rate) => {
          if (!lifecycle.isReleased()) nativePlaylist.playbackRate = rate;
        },
        skipTo: (index) => {
          if (!lifecycle.isReleased()) nativePlaylist.skipTo(index);
        },
      };
    },

    createPlayer: ({ metadata, uri }, onStatus) => {
      if (!uri.startsWith("file:///")) {
        throw new Error("Expected a private local audio file URI");
      }
      const nativePlayer = audio.createAudioPlayer(null, {
        downloadFirst: false,
        keepAudioSessionActive: true,
        updateInterval: 500,
      });
      let lastStatus = normalizeStatus(nativePlayer.currentStatus);
      let subscription: Readonly<{ remove: () => void }> | null = null;
      const lifecycle = createBackgroundAudioLifecycle(audio, session, {
        activateLockScreen: () =>
          nativePlayer.setActiveForLockScreen(true, metadata, {
            isLiveStream: false,
            showSeekBackward: true,
            showSeekForward: true,
          }),
        deactivateLockScreen: () => nativePlayer.setActiveForLockScreen(false),
        pause: () => nativePlayer.pause(),
        play: () => nativePlayer.play(),
        teardown: () => {
          safely(() => subscription?.remove());
          safely(() => nativePlayer.remove());
          safely(() => nativePlayer.release());
        },
      });
      try {
        subscription = nativePlayer.addListener(
          "playbackStatusUpdate",
          (status) => {
            if (lifecycle.isReleased()) return;
            lastStatus = normalizeStatus(status);
            onStatus(lastStatus);
          },
        );
        nativePlayer.replace({ name: metadata.title, uri });
      } catch (error: unknown) {
        void lifecycle.release();
        throw error;
      }

      return {
        getStatus: () => {
          if (!lifecycle.isReleased()) {
            lastStatus = normalizeStatus(nativePlayer.currentStatus);
          }
          return lastStatus;
        },
        pause: () => {
          if (!lifecycle.isReleased()) nativePlayer.pause();
        },
        play: lifecycle.play,
        release: lifecycle.release,
        seekTo: (seconds) =>
          lifecycle.isReleased()
            ? Promise.resolve()
            : nativePlayer.seekTo(seconds),
        setPlaybackRate: (rate) => {
          if (!lifecycle.isReleased()) {
            nativePlayer.setPlaybackRate(rate, "high");
          }
        },
      };
    },
  };
}

export async function loadExpoBackgroundAudioRuntime(): Promise<BackgroundAudioRuntime> {
  const installedAudio = await import("expo-audio");
  const audio: ExpoAudioBoundary = {
    createAudioPlayer: (source, options) =>
      installedAudio.createAudioPlayer(source, options),
    createAudioPlaylist: (options) =>
      installedAudio.createAudioPlaylist({
        ...options,
        sources: [...options.sources],
      }) as CurioPatchedAudioPlaylist,
    setAudioModeAsync: (mode) => installedAudio.setAudioModeAsync(mode),
    // Forward this reference unwrapped: the shared session lease is keyed on
    // its identity across separately loaded runtime boundaries.
    setIsAudioActiveAsync: installedAudio.setIsAudioActiveAsync,
  };
  return createExpoBackgroundAudioRuntime(audio);
}
