"use client";

import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { OnThisDayPageResponse } from "@/lib/on-this-day-contracts";

export type OnThisDayNavControl = "previous" | "next" | "picker";

export type OnThisDaySessionContextValue = {
  cache: Record<string, OnThisDayPageResponse>;
  setCache: Dispatch<SetStateAction<Record<string, OnThisDayPageResponse>>>;
  pendingFocusControlRef: MutableRefObject<OnThisDayNavControl | null>;
  pendingDayAnnouncementRef: MutableRefObject<boolean>;
};

const OnThisDaySessionContext =
  createContext<OnThisDaySessionContextValue | null>(null);

export const OnThisDaySessionProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const [cache, setCache] = useState<Record<string, OnThisDayPageResponse>>({});
  const pendingFocusControlRef = useRef<OnThisDayNavControl | null>(null);
  const pendingDayAnnouncementRef = useRef(false);

  const value = useMemo<OnThisDaySessionContextValue>(
    () => ({
      cache,
      setCache,
      pendingFocusControlRef,
      pendingDayAnnouncementRef,
    }),
    [cache],
  );

  return (
    <OnThisDaySessionContext.Provider value={value}>
      {children}
    </OnThisDaySessionContext.Provider>
  );
};

export const useOnThisDaySession = (): OnThisDaySessionContextValue => {
  const shared = useContext(OnThisDaySessionContext);
  const [localCache, setLocalCache] = useState<
    Record<string, OnThisDayPageResponse>
  >({});
  const localFocusRef = useRef<OnThisDayNavControl | null>(null);
  const localAnnouncementRef = useRef(false);

  return useMemo<OnThisDaySessionContextValue>(
    () =>
      shared ?? {
        cache: localCache,
        setCache: setLocalCache,
        pendingFocusControlRef: localFocusRef,
        pendingDayAnnouncementRef: localAnnouncementRef,
      },
    [localCache, shared],
  );
};
