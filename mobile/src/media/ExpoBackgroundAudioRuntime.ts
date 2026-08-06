export type BackgroundAudioPlaybackStatus = Readonly<{
  currentTime: number;
  didJustFinish: boolean;
  duration: number;
  error: string | null;
  isBuffering: boolean;
  isLoaded: boolean;
  playing: boolean;
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

// Keep the seam lazy-loadable and mockable, but derive every native signature
// from the installed SDK so an Expo API change fails typecheck instead of being
// hidden behind a structural cast.
export type ExpoAudioBoundary = Pick<
  InstalledExpoAudioModule,
  "createAudioPlayer" | "setAudioModeAsync" | "setIsAudioActiveAsync"
>;
type NativeAudioPlaybackStatus = ReturnType<
  ExpoAudioBoundary["createAudioPlayer"]
>["currentStatus"];

export interface BackgroundAudioPlayer {
  getStatus: () => BackgroundAudioPlaybackStatus;
  pause: () => void;
  play: () => Promise<void>;
  release: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
}

export interface BackgroundAudioRuntime {
  configureBackgroundMode: () => Promise<void>;
  createPlayer: (
    source: BackgroundAudioSource,
    onStatus: (status: BackgroundAudioPlaybackStatus) => void,
  ) => BackgroundAudioPlayer;
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
  ExpoAudioBoundary,
  AudioSessionCoordinator
>();

function getAudioSessionCoordinator(
  audio: ExpoAudioBoundary,
): AudioSessionCoordinator {
  const existing = audioSessionCoordinators.get(audio);
  if (existing !== undefined) return existing;

  const created: AudioSessionCoordinator = {
    ownerCount: 0,
    transition: Promise.resolve(),
  };
  audioSessionCoordinators.set(audio, created);
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
        seekTo: (seconds) => nativePlayer.seekTo(seconds),
      };
    },
  };
}

export async function loadExpoBackgroundAudioRuntime(): Promise<BackgroundAudioRuntime> {
  const audio: ExpoAudioBoundary = await import("expo-audio");
  return createExpoBackgroundAudioRuntime(audio);
}
