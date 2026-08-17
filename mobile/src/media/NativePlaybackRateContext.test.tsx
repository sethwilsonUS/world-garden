import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { PropsWithChildren } from "react";

import type { NativePlaybackRate } from "./NativePlaybackRate";
import {
  NativePlaybackRateProvider,
  useNativePlaybackRate,
} from "./NativePlaybackRateContext";
import type { NativePlaybackRatePreferenceStore } from "./NativePlaybackRatePreferenceStore";

function deferred<Value>() {
  let resolvePromise: (value: Value) => void = () => undefined;
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function wrapperFor(store: NativePlaybackRatePreferenceStore) {
  return function PlaybackRateWrapper({ children }: PropsWithChildren) {
    return (
      <NativePlaybackRateProvider store={store}>
        {children}
      </NativePlaybackRateProvider>
    );
  };
}

describe("NativePlaybackRateProvider", () => {
  it("fails clearly when the hook escapes its provider", async () => {
    await expect(renderHook(() => useNativePlaybackRate())).rejects.toThrow(
      "useNativePlaybackRate() must be used within NativePlaybackRateProvider",
    );
  });

  it("starts at normal speed and restores a saved device preference", async () => {
    const load = deferred<NativePlaybackRate>();
    const store: NativePlaybackRatePreferenceStore = {
      load: () => load.promise,
      save: async () => undefined,
    };
    const { result } = await renderHook(() => useNativePlaybackRate(), {
      wrapper: wrapperFor(store),
    });

    expect(result.current.rate).toBe(1);

    await act(async () => {
      load.resolve(1.75);
      await load.promise;
    });

    expect(result.current.rate).toBe(1.75);
  });

  it("does not let a delayed load overwrite a newer user choice", async () => {
    const load = deferred<NativePlaybackRate>();
    const savedRates: NativePlaybackRate[] = [];
    const store: NativePlaybackRatePreferenceStore = {
      load: () => load.promise,
      save: async (rate) => {
        savedRates.push(rate);
      },
    };
    const { result } = await renderHook(() => useNativePlaybackRate(), {
      wrapper: wrapperFor(store),
    });

    await act(() => result.current.setRate(1.25));
    await waitFor(() => expect(savedRates).toEqual([1.25]));

    await act(async () => {
      load.resolve(1.75);
      await load.promise;
    });

    expect(result.current.rate).toBe(1.25);
  });

  it("cycles from the latest same-turn value and serializes preference writes", async () => {
    const firstWrite = deferred<void>();
    const startedRates: NativePlaybackRate[] = [];
    const committedRates: NativePlaybackRate[] = [];
    const store: NativePlaybackRatePreferenceStore = {
      load: async () => 1,
      save: async (rate) => {
        startedRates.push(rate);
        if (rate === 1.25) await firstWrite.promise;
        committedRates.push(rate);
      },
    };
    const { result } = await renderHook(() => useNativePlaybackRate(), {
      wrapper: wrapperFor(store),
    });
    let cycledRates: NativePlaybackRate[] = [];

    await act(() => {
      cycledRates = [result.current.cycleRate(), result.current.cycleRate()];
    });

    expect(cycledRates).toEqual([1.25, 1.5]);
    expect(result.current.rate).toBe(1.5);
    await waitFor(() => expect(startedRates).toEqual([1.25]));
    expect(committedRates).toEqual([]);

    await act(async () => {
      firstWrite.resolve();
      await firstWrite.promise;
    });

    await waitFor(() => {
      expect(startedRates).toEqual([1.25, 1.5]);
      expect(committedRates).toEqual([1.25, 1.5]);
    });
  });

  it("keeps working when injected preference reads and writes reject", async () => {
    const attemptedRates: NativePlaybackRate[] = [];
    const store: NativePlaybackRatePreferenceStore = {
      load: () => {
        throw new Error("private native detail");
      },
      save: async (rate) => {
        attemptedRates.push(rate);
        throw new Error("private native detail");
      },
    };
    const { result } = await renderHook(() => useNativePlaybackRate(), {
      wrapper: wrapperFor(store),
    });

    await act(() => {
      result.current.setRate(1.25);
      result.current.setRate(1.5);
    });

    expect(result.current.rate).toBe(1.5);
    await waitFor(() => expect(attemptedRates).toEqual([1.25, 1.5]));
  });
});
