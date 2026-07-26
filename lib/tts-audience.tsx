"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  getTtsProfile,
  getTtsProviderForAudience,
  type TtsAudience,
  type TtsProfile,
} from "./tts-profile";

const PUBLIC_TTS_PROFILE = getTtsProfile("edge");
const TtsProfileContext = createContext<TtsProfile>(PUBLIC_TTS_PROFILE);

const TtsProfileProvider = ({
  audience,
  children,
}: {
  audience: TtsAudience;
  children: ReactNode;
}) => {
  const profile = useMemo(
    () => getTtsProfile(getTtsProviderForAudience(audience)),
    [audience],
  );

  return (
    <TtsProfileContext.Provider value={profile}>
      {children}
    </TtsProfileContext.Provider>
  );
};

export const PublicTtsProfileProvider = ({
  children,
}: {
  children: ReactNode;
}) => <TtsProfileProvider audience="public">{children}</TtsProfileProvider>;

export const AuthAwareTtsProfileProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { isLoaded, isSignedIn } = useAuth();
  const audience: TtsAudience =
    isLoaded && isSignedIn === true ? "authenticated" : "public";

  return (
    <TtsProfileProvider audience={audience}>{children}</TtsProfileProvider>
  );
};

export const useTtsProfile = (): TtsProfile => useContext(TtsProfileContext);
