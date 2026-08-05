import { useAuth, useUser } from "@clerk/expo";
import { useConvexAuth, useQueries } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";

import { convexClientApi } from "../data/convexClientApi";

const BRIDGE_ERROR_MESSAGE =
  "We couldn't connect your account. Please try again.";
const SIGN_OUT_ERROR_MESSAGE = "We couldn't sign you out. Please try again.";

interface NativeAuthLoadingState {
  readonly profile: null;
  readonly status: "loading";
}

interface NativeAuthSignedOutState {
  readonly profile: null;
  readonly status: "signedOut";
}

interface NativeAuthConnectingState {
  readonly profile: null;
  readonly status: "connecting";
}

interface NativeViewerIdentity {
  readonly email: string | null;
  readonly name: string | null;
  readonly subject: string;
}

export interface NativeAccountProfile {
  readonly email: string | null;
  readonly name: string | null;
}

interface NativeAuthReadyState {
  readonly profile: NativeAccountProfile;
  readonly status: "ready";
}

interface NativeAuthBridgeErrorState {
  readonly message: string;
  readonly profile: null;
  readonly status: "bridgeError";
}

export type NativeAuthState =
  | NativeAuthLoadingState
  | NativeAuthSignedOutState
  | NativeAuthConnectingState
  | NativeAuthReadyState
  | NativeAuthBridgeErrorState;

export type NativeSignOutResult =
  | Readonly<{ ok: true }>
  | Readonly<{ message: string; ok: false }>;

export interface NativeAuthValue {
  readonly canSignOut: boolean;
  readonly sessionEpoch: symbol;
  readonly signOut: () => Promise<NativeSignOutResult>;
  readonly state: NativeAuthState;
}

function sanitizeSignOutError(_error: unknown): NativeSignOutResult {
  return { message: SIGN_OUT_ERROR_MESSAGE, ok: false };
}

const LOADING_STATE: NativeAuthLoadingState = Object.freeze({
  profile: null,
  status: "loading",
});
const SIGNED_OUT_STATE: NativeAuthSignedOutState = Object.freeze({
  profile: null,
  status: "signedOut",
});
const CONNECTING_STATE: NativeAuthConnectingState = Object.freeze({
  profile: null,
  status: "connecting",
});
const BRIDGE_ERROR_STATE: NativeAuthBridgeErrorState = Object.freeze({
  message: BRIDGE_ERROR_MESSAGE,
  profile: null,
  status: "bridgeError",
});
const SKIPPED_VIEWER_QUERIES = Object.freeze({});
const VIEWER_QUERIES = Object.freeze({
  nativeViewer: Object.freeze({
    args: Object.freeze({}),
    query: convexClientApi.auth.nativeViewer,
  }),
});

const NativeAuthContext = createContext<NativeAuthValue | null>(null);

export function NativeAuthProvider({
  children,
}: PropsWithChildren): ReactElement {
  const clerkAuth = useAuth({ treatPendingAsSignedOut: false });
  const clerkUser = useUser();
  const convexAuth = useConvexAuth();
  const [suppressedSessionId, setSuppressedSessionId] = useState<string | null>(
    null,
  );
  const signOutOperationRef = useRef<{
    readonly promise: Promise<NativeSignOutResult>;
    readonly sessionId: string;
  } | null>(null);

  const activeSessionId =
    clerkAuth.isLoaded && clerkAuth.isSignedIn ? clerkAuth.sessionId : null;
  const sessionEpoch = useMemo(() => {
    // The public epoch intentionally changes with the private Clerk session ID
    // without exposing that identifier outside this provider.
    void activeSessionId;
    return Symbol("native-clerk-session");
  }, [activeSessionId]);
  const isCurrentSessionSuppressed =
    activeSessionId !== null && activeSessionId === suppressedSessionId;
  const clerkIdentityReady =
    clerkAuth.isLoaded &&
    clerkAuth.isSignedIn &&
    clerkUser.isLoaded &&
    clerkUser.isSignedIn &&
    clerkUser.user.id === clerkAuth.userId;
  const canQueryViewer =
    clerkIdentityReady &&
    !isCurrentSessionSuppressed &&
    convexAuth.isAuthenticated &&
    !convexAuth.isLoading &&
    !convexAuth.isRefreshing;
  const viewerResults = useQueries(
    canQueryViewer ? VIEWER_QUERIES : SKIPPED_VIEWER_QUERIES,
  );
  const viewer = (
    "nativeViewer" in viewerResults ? viewerResults.nativeViewer : undefined
  ) as NativeViewerIdentity | null | undefined | Error;

  const state = useMemo<NativeAuthState>(() => {
    if (isCurrentSessionSuppressed) {
      return SIGNED_OUT_STATE;
    }

    if (clerkAuth.isLoaded && !clerkAuth.isSignedIn) {
      return SIGNED_OUT_STATE;
    }

    if (!clerkAuth.isLoaded || !clerkUser.isLoaded) {
      return LOADING_STATE;
    }

    if (
      !clerkAuth.isSignedIn ||
      !clerkUser.isSignedIn ||
      clerkUser.user.id !== clerkAuth.userId
    ) {
      return CONNECTING_STATE;
    }

    if (convexAuth.isLoading || convexAuth.isRefreshing) {
      return CONNECTING_STATE;
    }

    if (!convexAuth.isAuthenticated) {
      return BRIDGE_ERROR_STATE;
    }

    if (viewer instanceof Error) {
      return BRIDGE_ERROR_STATE;
    }

    if (viewer === undefined) {
      return CONNECTING_STATE;
    }

    if (viewer === null || viewer.subject !== clerkAuth.userId) {
      return BRIDGE_ERROR_STATE;
    }

    return {
      profile: {
        email: viewer.email,
        name: viewer.name,
      },
      status: "ready",
    };
  }, [
    clerkAuth,
    clerkUser,
    convexAuth.isAuthenticated,
    convexAuth.isLoading,
    convexAuth.isRefreshing,
    isCurrentSessionSuppressed,
    viewer,
  ]);

  const signOut = useCallback((): Promise<NativeSignOutResult> => {
    if (activeSessionId === null) {
      return Promise.resolve({ ok: true });
    }

    const pendingOperation = signOutOperationRef.current;
    if (pendingOperation?.sessionId === activeSessionId) {
      return pendingOperation.promise;
    }

    setSuppressedSessionId(activeSessionId);

    let clerkOperation: Promise<void>;
    try {
      clerkOperation = clerkAuth.signOut();
    } catch (error: unknown) {
      clerkOperation = Promise.reject(error);
    }

    let operation: Promise<NativeSignOutResult>;
    operation = clerkOperation
      .then<NativeSignOutResult, NativeSignOutResult>(
        () => ({ ok: true }),
        (error: unknown) => {
          if (signOutOperationRef.current?.promise === operation) {
            setSuppressedSessionId((currentSessionId) =>
              currentSessionId === activeSessionId ? null : currentSessionId,
            );
          }
          return sanitizeSignOutError(error);
        },
      )
      .finally(() => {
        if (signOutOperationRef.current?.promise === operation) {
          signOutOperationRef.current = null;
        }
      });
    signOutOperationRef.current = {
      promise: operation,
      sessionId: activeSessionId,
    };

    return operation;
  }, [activeSessionId, clerkAuth]);

  const value = useMemo<NativeAuthValue>(
    () => ({
      canSignOut: activeSessionId !== null && !isCurrentSessionSuppressed,
      sessionEpoch,
      signOut,
      state,
    }),
    [activeSessionId, isCurrentSessionSuppressed, sessionEpoch, signOut, state],
  );

  return (
    <NativeAuthContext.Provider value={value}>
      {children}
    </NativeAuthContext.Provider>
  );
}

export function useNativeAuth(): NativeAuthValue {
  const value = useContext(NativeAuthContext);

  if (value === null) {
    throw new Error("useNativeAuth() must be used within NativeAuthProvider");
  }

  return value;
}
