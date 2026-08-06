export type ForegroundAudioPlaybackStatus = Readonly<{
  currentTime: number;
  didJustFinish: boolean;
  duration: number;
  error: string | null;
  isBuffering: boolean;
  isLoaded: boolean;
  playing: boolean;
}>;

type NativePlaybackStatus = ForegroundAudioPlaybackStatus &
  Readonly<Record<string, unknown>>;

interface ExpoAudioPlayerBoundary {
  addListener: (
    event: "playbackStatusUpdate",
    listener: (status: NativePlaybackStatus) => void,
  ) => Readonly<{ remove: () => void }>;
  pause: () => void;
  play: () => void;
  release: () => void;
  replace: (source: Readonly<{ uri: string }>) => void;
  seekTo: (seconds: number) => Promise<void>;
}

export interface ExpoAudioBoundary {
  createAudioPlayer: (
    source: null,
    options: Readonly<{
      downloadFirst: false;
      keepAudioSessionActive: false;
      updateInterval: 500;
    }>,
  ) => ExpoAudioPlayerBoundary;
  setAudioModeAsync: (mode: {
    allowsBackgroundRecording: false;
    allowsRecording: false;
    interruptionMode: "doNotMix";
    playsInSilentMode: true;
    shouldPlayInBackground: false;
    shouldRouteThroughEarpiece: false;
  }) => Promise<void>;
}

export interface ForegroundAudioPlayer {
  pause: () => void;
  play: () => void;
  release: () => void;
  seekTo: (seconds: number) => Promise<void>;
}

export interface ExpoForegroundAudioRuntime {
  configureForegroundMode: () => Promise<void>;
  createPlayer: (
    uri: string,
    onStatus: (status: ForegroundAudioPlaybackStatus) => void,
  ) => ForegroundAudioPlayer;
}

function safely(operation: () => void): void {
  try {
    operation();
  } catch (_error: unknown) {
    void _error;
  }
}

export function createExpoForegroundAudioRuntime(
  audio: ExpoAudioBoundary,
): ExpoForegroundAudioRuntime {
  return {
    configureForegroundMode: () =>
      audio.setAudioModeAsync({
        allowsBackgroundRecording: false,
        allowsRecording: false,
        interruptionMode: "doNotMix",
        playsInSilentMode: true,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      }),

    createPlayer: (uri, onStatus) => {
      if (!uri.startsWith("file:///")) {
        throw new Error("Expected a private local audio file URI");
      }
      const nativePlayer = audio.createAudioPlayer(null, {
        downloadFirst: false,
        keepAudioSessionActive: false,
        updateInterval: 500,
      });
      let released = false;
      let subscription: Readonly<{ remove: () => void }> | null = null;
      try {
        subscription = nativePlayer.addListener(
          "playbackStatusUpdate",
          (status) => {
            if (released) return;
            onStatus({
              currentTime: status.currentTime,
              didJustFinish: status.didJustFinish,
              duration: status.duration,
              error: status.error,
              isBuffering: status.isBuffering,
              isLoaded: status.isLoaded,
              playing: status.playing,
            });
          },
        );
        nativePlayer.replace({ uri });
      } catch (error: unknown) {
        if (subscription !== null) safely(() => subscription?.remove());
        safely(() => nativePlayer.release());
        throw error;
      }

      return {
        pause: () => nativePlayer.pause(),
        play: () => nativePlayer.play(),
        release: () => {
          if (released) return;
          released = true;
          safely(() => nativePlayer.pause());
          safely(() => subscription?.remove());
          safely(() => nativePlayer.release());
        },
        seekTo: (seconds) => nativePlayer.seekTo(seconds),
      };
    },
  };
}

export async function loadExpoForegroundAudioRuntime(): Promise<ExpoForegroundAudioRuntime> {
  const audio = (await import("expo-audio")) as unknown as ExpoAudioBoundary;
  return createExpoForegroundAudioRuntime(audio);
}
