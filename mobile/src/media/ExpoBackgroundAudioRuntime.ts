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

// Keep the seam lazy-loadable and mockable, while deriving Expo's public
// signatures from the installed SDK. The two playlist media-session methods
// are the only structural extension; the exact-version native patch contract
// verifies their implementation before any native build.
export type ExpoAudioBoundary = Pick<
  InstalledExpoAudioModule,
  "createAudioPlayer" | "setAudioModeAsync" | "setIsAudioActiveAsync"
> & {
  createAudioPlaylist: (
    ...args: Parameters<InstalledExpoAudioModule["createAudioPlaylist"]>
  ) => CurioPatchedAudioPlaylist;
};
type NativeAudioPlaybackStatus = ReturnType<
  ExpoAudioBoundary["createAudioPlayer"]
>["currentStatus"];
type NativeAudioPlaylistStatus = InstalledAudioPlaylist["currentStatus"];

export interface BackgroundAudioPlayer {
  getStatus: () => BackgroundAudioPlaybackStatus;
  pause: () => void;
  play: () => Promise<void>;
  release: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
}

export interface BackgroundAudioPlaylist {
  getStatus: () => BackgroundAudioPlaylistStatus;
  next: () => void;
  pause: () => void;
  play: () => Promise<void>;
  previous: () => void;
  release: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
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

function normalizeStatus(
  status: NativeAudioPlaybackStatus,
): BackgroundAudioPlaybackStatus {
  return {
    currentTime: status.currentTime,
    didJustFinish: status.didJustFinish,
    duration: status.duration,
    error: status.error,
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
    error: null,
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
      let lockScreenActive = false;
      let released = false;
      let releasePromise: Promise<void> | null = null;
      let playPromise: Promise<void> | null = null;
      let sessionRetained = false;
      let statusSubscription: Readonly<{ remove: () => void }> | null = null;
      let trackSubscription: Readonly<{ remove: () => void }> | null = null;
      try {
        statusSubscription = nativePlaylist.addListener(
          "playlistStatusUpdate",
          (status) => {
            if (released) return;
            onStatus(normalizePlaylistStatus(status));
          },
        );
        trackSubscription = nativePlaylist.addListener(
          "trackChanged",
          (change) => {
            if (released) return;
            onTrackChanged(change);
          },
        );
      } catch (error: unknown) {
        if (statusSubscription !== null) {
          safely(() => statusSubscription?.remove());
        }
        if (trackSubscription !== null) {
          safely(() => trackSubscription?.remove());
        }
        safely(() => nativePlaylist.pause());
        safely(() => nativePlaylist.destroy());
        safely(() => nativePlaylist.release());
        throw error;
      }

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
              nativePlaylist.setActiveForLockScreen(true, metadata, {
                isLiveStream: false,
                showSeekBackward: true,
                showSeekForward: true,
              });
              lockScreenActive = true;
            }
            nativePlaylist.play();
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
        safely(() => nativePlaylist.pause());
        if (lockScreenActive) {
          safely(() => nativePlaylist.setActiveForLockScreen(false));
          lockScreenActive = false;
        }
        safely(() => statusSubscription?.remove());
        safely(() => trackSubscription?.remove());
        safely(() => nativePlaylist.destroy());
        safely(() => nativePlaylist.release());

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
        getStatus: () => normalizePlaylistStatus(nativePlaylist.currentStatus),
        next: () => {
          if (!released) nativePlaylist.next();
        },
        pause: () => {
          if (!released) nativePlaylist.pause();
        },
        play,
        previous: () => {
          if (!released) nativePlaylist.previous();
        },
        release,
        seekTo: (seconds) =>
          released ? Promise.resolve() : nativePlaylist.seekTo(seconds),
        skipTo: (index) => {
          if (!released) nativePlaylist.skipTo(index);
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
      let lockScreenActive = false;
      let released = false;
      let releasePromise: Promise<void> | null = null;
      let playPromise: Promise<void> | null = null;
      let sessionRetained = false;
      let subscription: Readonly<{ remove: () => void }> | null = null;
      try {
        subscription = nativePlayer.addListener(
          "playbackStatusUpdate",
          (status) => {
            if (released) return;
            onStatus(normalizeStatus(status));
          },
        );
        nativePlayer.replace({ name: metadata.title, uri });
      } catch (error: unknown) {
        if (subscription !== null) safely(() => subscription?.remove());
        safely(() => nativePlayer.remove());
        safely(() => nativePlayer.release());
        throw error;
      }

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
              nativePlayer.setActiveForLockScreen(true, metadata, {
                isLiveStream: false,
                showSeekBackward: true,
                showSeekForward: true,
              });
              lockScreenActive = true;
            }
            nativePlayer.play();
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
        safely(() => nativePlayer.pause());
        if (lockScreenActive) {
          safely(() => nativePlayer.setActiveForLockScreen(false));
          lockScreenActive = false;
        }
        safely(() => subscription?.remove());
        safely(() => nativePlayer.remove());
        safely(() => nativePlayer.release());

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
        getStatus: () => normalizeStatus(nativePlayer.currentStatus),
        pause: () => {
          if (!released) nativePlayer.pause();
        },
        play,
        release,
        seekTo: (seconds) =>
          released ? Promise.resolve() : nativePlayer.seekTo(seconds),
      };
    },
  };
}

export async function loadExpoBackgroundAudioRuntime(): Promise<BackgroundAudioRuntime> {
  const installedAudio = await import("expo-audio");
  const audio: ExpoAudioBoundary = {
    createAudioPlayer: installedAudio.createAudioPlayer,
    createAudioPlaylist: (...args) =>
      installedAudio.createAudioPlaylist(...args) as CurioPatchedAudioPlaylist,
    setAudioModeAsync: installedAudio.setAudioModeAsync,
    setIsAudioActiveAsync: installedAudio.setIsAudioActiveAsync,
  };
  return createExpoBackgroundAudioRuntime(audio);
}
