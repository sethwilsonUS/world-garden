import { getItemAsync, setItemAsync } from "expo-secure-store";

import {
  DEFAULT_NATIVE_PLAYBACK_RATE,
  parseNativePlaybackRate,
  type NativePlaybackRate,
} from "./NativePlaybackRate";

const NATIVE_PLAYBACK_RATE_PREFERENCE_KEY =
  "curio-garden.native-playback-rate.v1";

type NativePlaybackRateSecureStoreBoundary = Readonly<{
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
}>;

export interface NativePlaybackRatePreferenceStore {
  readonly load: () => Promise<NativePlaybackRate>;
  readonly save: (rate: NativePlaybackRate) => Promise<void>;
}

export function createNativePlaybackRatePreferenceStore(
  secureStore: NativePlaybackRateSecureStoreBoundary,
): NativePlaybackRatePreferenceStore {
  return {
    load: async () => {
      try {
        const storedValue = await secureStore.getItemAsync(
          NATIVE_PLAYBACK_RATE_PREFERENCE_KEY,
        );
        return (
          parseNativePlaybackRate(storedValue) ?? DEFAULT_NATIVE_PLAYBACK_RATE
        );
      } catch (_error: unknown) {
        void _error;
        return DEFAULT_NATIVE_PLAYBACK_RATE;
      }
    },
    save: async (rate) => {
      try {
        await secureStore.setItemAsync(
          NATIVE_PLAYBACK_RATE_PREFERENCE_KEY,
          String(rate),
        );
      } catch (_error: unknown) {
        void _error;
      }
    },
  };
}

export const defaultNativePlaybackRatePreferenceStore =
  createNativePlaybackRatePreferenceStore({ getItemAsync, setItemAsync });
