import { useAuth, useSession, useUser } from "@clerk/expo";
import { useConvexAuth, useQueries } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";

import { convexClientApi } from "../data/convexClientApi";
import { NativeAccountSubjectBindingProvider } from "./NativeAccountSubjectBindingContext";
import {
  NativeAuthTransportBindingProvider,
  type NativeAuthTransportBinding,
  type NativeAuthTransportCredentials,
} from "./NativeAuthTransportBindingContext";
import { isClerkSessionTokenIdentityConsistent } from "./clerkSessionToken";

const BRIDGE_ERROR_MESSAGE =
  "We couldn't connect your account. Please try again.";
const SIGN_OUT_ERROR_MESSAGE = "We couldn't sign you out. Please try again.";
const INACTIVE_TRANSPORT_EPOCH = Symbol("inactive-native-auth-transport");
const CLERK_TOKEN_RESOLUTION_TIMEOUT_MS = 15_000;
const CLERK_TOKEN_RESOLUTION_TIMED_OUT = Symbol(
  "clerk-token-resolution-timed-out",
);

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

interface NativeAuthTransportIdentity {
  readonly accountEpoch: symbol;
  readonly expectedAccountSubject: string | null;
  readonly sessionId: string | null;
  readonly sessionResource: ClerkSessionResource | null;
  readonly stateStatus: NativeAuthState["status"];
  readonly userId: string | null;
}

type ClerkSessionResource = NonNullable<
  ReturnType<typeof useSession>["session"]
>;

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
  readonly sessionEpochKey: string;
  readonly signOut: () => Promise<NativeSignOutResult>;
  readonly state: NativeAuthState;
}

let nextSessionEpochKey = 0;

function createSessionEpochState(
  sessionId: string | null,
  userId: string | null,
): {
  readonly key: string;
  readonly sessionId: string | null;
  readonly userId: string | null;
  readonly value: symbol;
} {
  nextSessionEpochKey += 1;

  return {
    // This key is a same-runtime correlation value, not an authentication
    // credential. Its sequence is intentionally independent of Clerk IDs.
    key: `native-epoch-${nextSessionEpochKey.toString(36)}`,
    sessionId,
    userId,
    value: Symbol("native-clerk-session"),
  };
}

function sanitizeSignOutError(_error: unknown): NativeSignOutResult {
  return { message: SIGN_OUT_ERROR_MESSAGE, ok: false };
}

function sanitizeCredentialError(
  _error: unknown,
): NativeAuthTransportCredentials {
  return { status: "unavailable" };
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
  const clerkSession = useSession();
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
  const activeUserId =
    clerkAuth.isLoaded && clerkAuth.isSignedIn ? clerkAuth.userId : null;
  const activeSessionResource =
    clerkSession.isLoaded && clerkSession.isSignedIn === true
      ? clerkSession.session
      : null;
  const isCurrentSessionSuppressed =
    activeSessionId !== null && activeSessionId === suppressedSessionId;
  const exposedSessionId = isCurrentSessionSuppressed ? null : activeSessionId;
  const exposedUserId = isCurrentSessionSuppressed ? null : activeUserId;
  const exposedSessionResource = isCurrentSessionSuppressed
    ? null
    : activeSessionResource;
  const [sessionEpochState, setSessionEpochState] = useState<{
    readonly key: string;
    readonly sessionId: string | null;
    readonly userId: string | null;
    readonly value: symbol;
  }>(() => createSessionEpochState(exposedSessionId, exposedUserId));
  if (
    sessionEpochState.sessionId !== exposedSessionId ||
    sessionEpochState.userId !== exposedUserId
  ) {
    // State is a semantic identity guarantee, unlike a memo cache. React
    // restarts this render before committing the replacement session.
    setSessionEpochState(
      createSessionEpochState(exposedSessionId, exposedUserId),
    );
  }
  const sessionEpoch = sessionEpochState.value;
  const sessionEpochKey = sessionEpochState.key;
  const clerkIdentityReady =
    clerkAuth.isLoaded &&
    clerkAuth.isSignedIn &&
    clerkSession.isLoaded &&
    clerkSession.isSignedIn === true &&
    clerkUser.isLoaded &&
    clerkUser.isSignedIn &&
    clerkUser.user.id === clerkAuth.userId &&
    clerkSession.session.id === clerkAuth.sessionId &&
    clerkSession.session.user.id === clerkAuth.userId;
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

    if (!clerkAuth.isLoaded || !clerkSession.isLoaded || !clerkUser.isLoaded) {
      return LOADING_STATE;
    }

    if (
      !clerkAuth.isSignedIn ||
      clerkSession.isSignedIn !== true ||
      !clerkUser.isSignedIn ||
      clerkUser.user.id !== clerkAuth.userId ||
      clerkSession.session.id !== clerkAuth.sessionId ||
      clerkSession.session.user.id !== clerkAuth.userId
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
    clerkSession,
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
        () => {
          if (signOutOperationRef.current?.promise === operation) {
            setSuppressedSessionId((currentSessionId) =>
              currentSessionId === activeSessionId ? null : currentSessionId,
            );
          }
          return { ok: true };
        },
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

  const validatedAccountSubject =
    state.status === "ready" &&
    viewer !== undefined &&
    viewer !== null &&
    !(viewer instanceof Error)
      ? viewer.subject
      : null;

  const latestTransportIdentityRef = useRef<NativeAuthTransportIdentity>({
    accountEpoch: sessionEpoch,
    expectedAccountSubject: validatedAccountSubject,
    sessionId: exposedSessionId,
    sessionResource: exposedSessionResource,
    stateStatus: state.status,
    userId: exposedUserId,
  });
  useLayoutEffect(() => {
    latestTransportIdentityRef.current = {
      accountEpoch: sessionEpoch,
      expectedAccountSubject: validatedAccountSubject,
      sessionId: exposedSessionId,
      sessionResource: exposedSessionResource,
      stateStatus: state.status,
      userId: exposedUserId,
    };

    return () => {
      latestTransportIdentityRef.current = {
        accountEpoch: INACTIVE_TRANSPORT_EPOCH,
        expectedAccountSubject: null,
        sessionId: null,
        sessionResource: null,
        stateStatus: "loading",
        userId: null,
      };
    };
  }, [
    exposedSessionId,
    exposedSessionResource,
    exposedUserId,
    sessionEpoch,
    state.status,
    validatedAccountSubject,
  ]);

  const isCurrentAccountEpoch = useCallback(
    (accountEpoch: symbol): boolean =>
      latestTransportIdentityRef.current.accountEpoch === accountEpoch,
    [],
  );

  const resolveRequestCredentials = useCallback(
    async (options?: {
      readonly forceRefresh?: boolean;
    }): Promise<NativeAuthTransportCredentials> => {
      const startingIdentity = {
        accountEpoch: sessionEpoch,
        expectedAccountSubject: validatedAccountSubject,
        sessionId: exposedSessionId,
        sessionResource: exposedSessionResource,
        stateStatus: state.status,
        userId: exposedUserId,
      } as const;
      const isStartingIdentityCurrent = (): boolean => {
        const currentIdentity = latestTransportIdentityRef.current;

        return (
          currentIdentity.accountEpoch === startingIdentity.accountEpoch &&
          currentIdentity.expectedAccountSubject ===
            startingIdentity.expectedAccountSubject &&
          currentIdentity.sessionId === startingIdentity.sessionId &&
          currentIdentity.sessionResource ===
            startingIdentity.sessionResource &&
          currentIdentity.stateStatus === startingIdentity.stateStatus &&
          currentIdentity.userId === startingIdentity.userId
        );
      };

      if (!isStartingIdentityCurrent()) {
        return { status: "superseded" };
      }

      if (startingIdentity.stateStatus === "signedOut") {
        return {
          accountEpoch: startingIdentity.accountEpoch,
          status: "public",
        };
      }

      if (
        startingIdentity.stateStatus !== "ready" ||
        startingIdentity.expectedAccountSubject === null ||
        startingIdentity.sessionId === null ||
        startingIdentity.sessionResource === null ||
        startingIdentity.userId === null ||
        startingIdentity.expectedAccountSubject !== startingIdentity.userId ||
        startingIdentity.sessionResource.id !== startingIdentity.sessionId ||
        startingIdentity.sessionResource.user.id !== startingIdentity.userId
      ) {
        return { status: "unavailable" };
      }

      let sessionToken: string | null;
      let tokenTimeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        const tokenPromise = options?.forceRefresh
          ? startingIdentity.sessionResource.getToken({ skipCache: true })
          : startingIdentity.sessionResource.getToken();
        const tokenResult = await Promise.race([
          Promise.resolve(tokenPromise),
          new Promise<typeof CLERK_TOKEN_RESOLUTION_TIMED_OUT>((resolve) => {
            tokenTimeoutId = setTimeout(
              () => resolve(CLERK_TOKEN_RESOLUTION_TIMED_OUT),
              CLERK_TOKEN_RESOLUTION_TIMEOUT_MS,
            );
          }),
        ]);
        if (tokenResult === CLERK_TOKEN_RESOLUTION_TIMED_OUT) {
          return isStartingIdentityCurrent()
            ? { status: "unavailable" }
            : { status: "superseded" };
        }
        sessionToken = tokenResult;
      } catch (error: unknown) {
        return isStartingIdentityCurrent()
          ? sanitizeCredentialError(error)
          : { status: "superseded" };
      } finally {
        if (tokenTimeoutId !== undefined) clearTimeout(tokenTimeoutId);
      }

      if (!isStartingIdentityCurrent()) {
        return { status: "superseded" };
      }

      if (typeof sessionToken !== "string") {
        return { status: "unavailable" };
      }
      const trimmedSessionToken = sessionToken.trim();
      if (
        trimmedSessionToken.length === 0 ||
        trimmedSessionToken !== sessionToken ||
        !isClerkSessionTokenIdentityConsistent(
          sessionToken,
          startingIdentity.userId,
          startingIdentity.sessionId,
        )
      ) {
        return { status: "unavailable" };
      }

      return {
        accountEpoch: startingIdentity.accountEpoch,
        sessionToken,
        status: "authenticated",
      };
    },
    [
      exposedSessionId,
      exposedSessionResource,
      exposedUserId,
      sessionEpoch,
      state.status,
      validatedAccountSubject,
    ],
  );

  const transportBinding = useMemo<NativeAuthTransportBinding>(
    () => ({
      accountEpoch: sessionEpoch,
      isCurrentAccountEpoch,
      resolveRequestCredentials,
    }),
    [isCurrentAccountEpoch, resolveRequestCredentials, sessionEpoch],
  );

  const value = useMemo<NativeAuthValue>(
    () => ({
      canSignOut: activeSessionId !== null && !isCurrentSessionSuppressed,
      sessionEpoch,
      sessionEpochKey,
      signOut,
      state,
    }),
    [
      activeSessionId,
      isCurrentSessionSuppressed,
      sessionEpoch,
      sessionEpochKey,
      signOut,
      state,
    ],
  );

  return (
    <NativeAuthTransportBindingProvider binding={transportBinding}>
      <NativeAccountSubjectBindingProvider subject={validatedAccountSubject}>
        <NativeAuthContext.Provider value={value}>
          {children}
        </NativeAuthContext.Provider>
      </NativeAccountSubjectBindingProvider>
    </NativeAuthTransportBindingProvider>
  );
}

export function useNativeAuth(): NativeAuthValue {
  const value = useContext(NativeAuthContext);

  if (value === null) {
    throw new Error("useNativeAuth() must be used within NativeAuthProvider");
  }

  return value;
}
