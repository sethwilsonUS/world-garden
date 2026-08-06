export type ExpoAudioBackgroundSafetySources = Readonly<{
  androidBaseAudioPlayer: string;
  androidAudioModule: string;
  androidAudioPlayer: string;
  androidControlsService: string;
  iosMediaController: string;
}>;

export type ExpoAudioPlaylistMediaSessionSources =
  ExpoAudioBackgroundSafetySources &
    Readonly<{
      androidAudioPlaylist: string;
      androidPlaybackServiceConnection: string;
      androidMediaSessionCallback: string;
      iosAudioPlaylist: string;
      iosAudioPlayer: string;
      iosAudioModule: string;
      typescriptAudioModuleTypes: string;
      builtAudioModuleTypes: string;
    }>;

export const EXPO_AUDIO_BACKGROUND_SAFETY_MARKER: string;
export const EXPO_AUDIO_VERSION: string;
export const applyExpoAudioBackgroundSafety: (
  sources: ExpoAudioBackgroundSafetySources,
) => ExpoAudioBackgroundSafetySources;
export const applyExpoAudioPlaylistMediaSession: (
  sources: ExpoAudioPlaylistMediaSessionSources,
  patchSource: string,
) => ExpoAudioPlaylistMediaSessionSources;
export const patchInstalledExpoAudio: (
  projectRoot: string,
  mode?: "apply" | "check",
) => Readonly<{
  changed: boolean;
  state: "background" | "patched" | "pristine";
}>;
