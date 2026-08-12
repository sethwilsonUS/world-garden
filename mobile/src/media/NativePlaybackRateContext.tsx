import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";

import {
  DEFAULT_NATIVE_PLAYBACK_RATE,
  getNextNativePlaybackRate,
  type NativePlaybackRate,
} from "./NativePlaybackRate";
import {
  defaultNativePlaybackRatePreferenceStore,
  type NativePlaybackRatePreferenceStore,
} from "./NativePlaybackRatePreferenceStore";

export interface NativePlaybackRateValue {
  readonly cycleRate: () => NativePlaybackRate;
  readonly rate: NativePlaybackRate;
  readonly setRate: (rate: NativePlaybackRate) => void;
}

export interface NativePlaybackRateProviderProps extends PropsWithChildren {
  readonly store?: NativePlaybackRatePreferenceStore;
}

const NativePlaybackRateContext = createContext<NativePlaybackRateValue | null>(
  null,
);

export function NativePlaybackRateProvider({
  children,
  store = defaultNativePlaybackRatePreferenceStore,
}: NativePlaybackRateProviderProps): ReactElement {
  const [rate, setRateState] = useState<NativePlaybackRate>(
    DEFAULT_NATIVE_PLAYBACK_RATE,
  );
  const rateRef = useRef<NativePlaybackRate>(DEFAULT_NATIVE_PLAYBACK_RATE);
  const userChangeVersion = useRef(0);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let active = true;
    const startingUserChangeVersion = userChangeVersion.current;

    void Promise.resolve()
      .then(() => store.load())
      .then(
        (storedRate) => {
          if (
            !active ||
            userChangeVersion.current !== startingUserChangeVersion
          ) {
            return;
          }
          rateRef.current = storedRate;
          setRateState(storedRate);
        },
        (_error: unknown) => {
          void _error;
        },
      );

    return () => {
      active = false;
    };
  }, [store]);

  const setRate = useCallback(
    (nextRate: NativePlaybackRate) => {
      userChangeVersion.current += 1;
      rateRef.current = nextRate;
      setRateState(nextRate);
      writeQueue.current = writeQueue.current
        .catch((_error: unknown) => undefined)
        .then(() => store.save(nextRate))
        .catch((_error: unknown) => undefined);
    },
    [store],
  );

  const cycleRate = useCallback(() => {
    const nextRate = getNextNativePlaybackRate(rateRef.current);
    setRate(nextRate);
    return nextRate;
  }, [setRate]);

  const value = useMemo<NativePlaybackRateValue>(
    () => ({ cycleRate, rate, setRate }),
    [cycleRate, rate, setRate],
  );

  return (
    <NativePlaybackRateContext.Provider value={value}>
      {children}
    </NativePlaybackRateContext.Provider>
  );
}

export function useNativePlaybackRate(): NativePlaybackRateValue {
  const value = useContext(NativePlaybackRateContext);
  if (value === null) {
    throw new Error(
      "useNativePlaybackRate() must be used within NativePlaybackRateProvider",
    );
  }
  return value;
}
