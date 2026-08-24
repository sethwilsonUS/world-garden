import { useAuth, useSession, useUser } from "@clerk/expo";
import { useMemo } from "react";

export type NativeClerkTokenOptions = Readonly<{
  skipCache?: boolean;
}>;

export type NativeClerkAuthOptions = Readonly<{
  treatPendingAsSignedOut: false;
}>;

export interface NativeClerkSessionResource {
  readonly getToken: (
    options?: NativeClerkTokenOptions,
  ) => Promise<string | null>;
  readonly id: string;
  readonly user: Readonly<{ id: string }>;
}

type NativeClerkSignOut = () => Promise<void>;

export type NativeClerkAuth =
  | Readonly<{
      isLoaded: false;
      isSignedIn: undefined;
      sessionId: undefined;
      signOut: NativeClerkSignOut;
      userId: undefined;
    }>
  | Readonly<{
      isLoaded: true;
      isSignedIn: false;
      sessionId: null;
      signOut: NativeClerkSignOut;
      userId: null;
    }>
  | Readonly<{
      isLoaded: true;
      isSignedIn: true;
      sessionId: string;
      signOut: NativeClerkSignOut;
      userId: string;
    }>;

export type NativeClerkSession =
  | Readonly<{
      isLoaded: false;
      isSignedIn: undefined;
      session: undefined;
    }>
  | Readonly<{
      isLoaded: true;
      isSignedIn: false;
      session: null;
    }>
  | Readonly<{
      isLoaded: true;
      isSignedIn: true;
      session: NativeClerkSessionResource;
    }>;

export type NativeClerkUser =
  | Readonly<{
      isLoaded: false;
      isSignedIn: undefined;
      user: undefined;
    }>
  | Readonly<{
      isLoaded: true;
      isSignedIn: false;
      user: null;
    }>
  | Readonly<{
      isLoaded: true;
      isSignedIn: true;
      user: Readonly<{ id: string }>;
    }>;

type NativeClerkAuthSource = NativeClerkAuth;

type NativeClerkSessionSource =
  | Readonly<{
      isLoaded: false;
      isSignedIn: undefined;
      session: undefined;
    }>
  | Readonly<{
      isLoaded: true;
      isSignedIn: false;
      session: null;
    }>
  | Readonly<{
      isLoaded: true;
      isSignedIn: boolean;
      session: NativeClerkSessionResource;
    }>;

type NativeClerkUserSource = NativeClerkUser;

export interface NativeClerkHookSource {
  readonly useAuth: (
    options: NativeClerkAuthOptions,
  ) => NativeClerkAuthSource;
  readonly useSession: () => NativeClerkSessionSource;
  readonly useUser: () => NativeClerkUserSource;
}

const clerkHookSource = {
  useAuth,
  useSession,
  useUser,
} satisfies NativeClerkHookSource;

/**
 * Narrows Clerk's large public hook contracts to the identity capabilities the
 * native auth bridge actually owns. Tests can provide complete fixtures for
 * this boundary without impersonating Clerk's unrelated SDK resources.
 */
export function useNativeClerkAuthFrom(
  source: Pick<NativeClerkHookSource, "useAuth">,
): NativeClerkAuth {
  const auth = source.useAuth({ treatPendingAsSignedOut: false });

  return useMemo<NativeClerkAuth>(() => {
    if (!auth.isLoaded) {
      return {
        isLoaded: false,
        isSignedIn: undefined,
        sessionId: undefined,
        signOut: auth.signOut,
        userId: undefined,
      };
    }
    if (!auth.isSignedIn) {
      return {
        isLoaded: true,
        isSignedIn: false,
        sessionId: null,
        signOut: auth.signOut,
        userId: null,
      };
    }
    return {
      isLoaded: true,
      isSignedIn: true,
      sessionId: auth.sessionId,
      signOut: auth.signOut,
      userId: auth.userId,
    };
  }, [
    auth.isLoaded,
    auth.isSignedIn,
    auth.sessionId,
    auth.signOut,
    auth.userId,
  ]);
}

export function useNativeClerkAuth(): NativeClerkAuth {
  return useNativeClerkAuthFrom(clerkHookSource);
}

export function useNativeClerkSessionFrom(
  source: Pick<NativeClerkHookSource, "useSession">,
): NativeClerkSession {
  const clerkSession = source.useSession();

  return useMemo<NativeClerkSession>(() => {
    if (!clerkSession.isLoaded) {
      return {
        isLoaded: false,
        isSignedIn: undefined,
        session: undefined,
      };
    }
    if (!clerkSession.isSignedIn) {
      return { isLoaded: true, isSignedIn: false, session: null };
    }
    return {
      isLoaded: true,
      isSignedIn: true,
      session: clerkSession.session,
    };
  }, [
    clerkSession.isLoaded,
    clerkSession.isSignedIn,
    clerkSession.session,
  ]);
}

export function useNativeClerkSession(): NativeClerkSession {
  return useNativeClerkSessionFrom(clerkHookSource);
}

export function useNativeClerkUserFrom(
  source: Pick<NativeClerkHookSource, "useUser">,
): NativeClerkUser {
  const clerkUser = source.useUser();
  const userId =
    clerkUser.isLoaded && clerkUser.isSignedIn ? clerkUser.user.id : null;

  return useMemo<NativeClerkUser>(() => {
    if (!clerkUser.isLoaded) {
      return { isLoaded: false, isSignedIn: undefined, user: undefined };
    }
    if (!clerkUser.isSignedIn || userId === null) {
      return { isLoaded: true, isSignedIn: false, user: null };
    }
    return {
      isLoaded: true,
      isSignedIn: true,
      user: { id: userId },
    };
  }, [clerkUser.isLoaded, clerkUser.isSignedIn, userId]);
}

export function useNativeClerkUser(): NativeClerkUser {
  return useNativeClerkUserFrom(clerkHookSource);
}
