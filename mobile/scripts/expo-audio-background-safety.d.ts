export type ExpoAudioBackgroundSafetySources = Readonly<{
  androidBaseAudioPlayer: string;
  androidAudioModule: string;
  androidAudioPlayer: string;
  androidControlsService: string;
  iosMediaController: string;
}>;

export const EXPO_AUDIO_BACKGROUND_SAFETY_MARKER: string;
export const EXPO_AUDIO_VERSION: string;
export const applyExpoAudioBackgroundSafety: (
  sources: ExpoAudioBackgroundSafetySources,
) => ExpoAudioBackgroundSafetySources;
export const patchInstalledExpoAudio: (
  projectRoot: string,
  mode?: "apply" | "check",
) => Readonly<{ changed: boolean; state: "patched" | "pristine" }>;
