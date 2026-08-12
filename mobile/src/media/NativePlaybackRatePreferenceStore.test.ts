import { DEFAULT_NATIVE_PLAYBACK_RATE } from "./NativePlaybackRate";
import { createNativePlaybackRatePreferenceStore } from "./NativePlaybackRatePreferenceStore";

const PREFERENCE_KEY = "curio-garden.native-playback-rate.v1";

function createSecureStoreBoundary(initialValue: string | null = null) {
  const values = new Map<string, string>();
  if (initialValue !== null) values.set(PREFERENCE_KEY, initialValue);

  return {
    boundary: {
      getItemAsync: async (key: string) => values.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        values.set(key, value);
      },
    },
    values,
  };
}

describe("NativePlaybackRatePreferenceStore", () => {
  it("loads and saves one versioned native playback-rate preference", async () => {
    const secureStore = createSecureStoreBoundary("1.75");
    const store = createNativePlaybackRatePreferenceStore(secureStore.boundary);

    await expect(store.load()).resolves.toBe(1.75);
    await expect(store.save(1.25)).resolves.toBeUndefined();
    expect(secureStore.values).toEqual(new Map([[PREFERENCE_KEY, "1.25"]]));
  });

  it.each([null, "", "2.5", "1.5x", " 1.5 "])(
    "falls back to normal speed for an absent or invalid value %p",
    async (storedValue) => {
      const secureStore = createSecureStoreBoundary(storedValue);
      const store = createNativePlaybackRatePreferenceStore(
        secureStore.boundary,
      );

      await expect(store.load()).resolves.toBe(DEFAULT_NATIVE_PLAYBACK_RATE);
    },
  );

  it("fails soft when native preference storage cannot be read or written", async () => {
    const store = createNativePlaybackRatePreferenceStore({
      getItemAsync: async () => {
        throw new Error("private native detail");
      },
      setItemAsync: async () => {
        throw new Error("private native detail");
      },
    });

    await expect(store.load()).resolves.toBe(DEFAULT_NATIVE_PLAYBACK_RATE);
    await expect(store.save(1.5)).resolves.toBeUndefined();
  });
});
