import { useHostedAuth } from "@clerk/expo/hosted-auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { AccessibilityInfo, Platform } from "react-native";

const HOSTED_AUTH_ERROR_MESSAGE =
  "We couldn't open secure sign-in. Please try again.";
const HOSTED_AUTH_PREPARATION_MESSAGE = "Opening secure sign-in.";

export type HostedAuthOutcome = "cancelled" | "completed" | "error";

export interface OpenHostedAuthOptions {
  restoreFocus?: (outcome: HostedAuthOutcome) => void;
}

export interface HostedAuthContextValue {
  readonly authErrorMessage: string | null;
  readonly isAccessibilityActive: boolean;
  readonly isBusy: boolean;
  readonly openAuth: (
    options?: OpenHostedAuthOptions,
  ) => Promise<HostedAuthOutcome>;
}

const HostedAuthContext = createContext<HostedAuthContextValue | null>(null);

function focusRestoreDelayMs(): number {
  return Platform.OS === "android" ? 1_000 : 250;
}

function announceAuthPreparation() {
  if (
    Platform.OS === "ios" &&
    typeof AccessibilityInfo.announceForAccessibilityWithOptions === "function"
  ) {
    AccessibilityInfo.announceForAccessibilityWithOptions(
      HOSTED_AUTH_PREPARATION_MESSAGE,
      { queue: true, priority: "low" },
    );
    return;
  }

  AccessibilityInfo.announceForAccessibility(HOSTED_AUTH_PREPARATION_MESSAGE);
}

export function HostedAuthProvider({
  children,
}: PropsWithChildren): ReactElement {
  const { startHostedAuth } = useHostedAuth();
  const startHostedAuthRef = useRef(startHostedAuth);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const pendingDelayRef = useRef<{
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const commitSequenceRef = useRef(0);
  const pendingCommitRef = useRef<{
    requestId: number;
    resolve: () => void;
  } | null>(null);
  const operationRef = useRef<Promise<HostedAuthOutcome> | null>(null);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);
  const [isAccessibilityActive, setIsAccessibilityActive] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [commitRequestId, setCommitRequestId] = useState(0);

  useLayoutEffect(() => {
    startHostedAuthRef.current = startHostedAuth;
  }, [startHostedAuth]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      operationRef.current = null;

      const pendingDelay = pendingDelayRef.current;
      if (pendingDelay) {
        clearTimeout(pendingDelay.timer);
        pendingDelayRef.current = null;
        pendingDelay.resolve();
      }

      const pendingCommit = pendingCommitRef.current;
      if (pendingCommit) {
        pendingCommitRef.current = null;
        pendingCommit.resolve();
      }
    };
  }, []);

  useEffect(() => {
    const pendingCommit = pendingCommitRef.current;
    if (pendingCommit?.requestId !== commitRequestId) return;

    pendingCommitRef.current = null;
    pendingCommit.resolve();
  }, [commitRequestId]);

  const waitForBrowserToSettle = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          pendingDelayRef.current = null;
          resolve();
        }, focusRestoreDelayMs());
        pendingDelayRef.current = { resolve, timer };
      }),
    [],
  );

  const waitForStateCommit = useCallback(
    () =>
      new Promise<void>((resolve) => {
        const requestId = ++commitSequenceRef.current;
        pendingCommitRef.current = { requestId, resolve };
        setCommitRequestId(requestId);
      }),
    [],
  );

  const openAuth = useCallback(
    (options: OpenHostedAuthOptions = {}): Promise<HostedAuthOutcome> => {
      const pendingOperation = operationRef.current;
      if (pendingOperation) return pendingOperation;

      const generation = ++generationRef.current;
      setAuthErrorMessage(null);
      setIsAccessibilityActive(false);
      setIsBusy(true);

      let operation: Promise<HostedAuthOutcome>;
      operation = (async () => {
        // First commit an accessible preparation update. This gives screen
        // readers useful feedback while Clerk creates the hosted URL.
        await waitForStateCommit();
        if (!mountedRef.current || generationRef.current !== generation) {
          return "cancelled";
        }
        announceAuthPreparation();

        // Then isolate background announcements before the OS auth session can
        // present or activate a returning session.
        setIsAccessibilityActive(true);
        await waitForStateCommit();
        if (!mountedRef.current || generationRef.current !== generation) {
          return "cancelled";
        }

        let outcome: HostedAuthOutcome;

        try {
          const result = await startHostedAuthRef.current();
          outcome = result.createdSessionId
            ? "completed"
            : result.authSessionResult?.type === "cancel" ||
                result.authSessionResult?.type === "dismiss"
              ? "cancelled"
              : "error";
        } catch (error: unknown) {
          void error;
          outcome = "error";
        }

        if (!mountedRef.current || generationRef.current !== generation) {
          return outcome;
        }

        if (outcome === "error") {
          setAuthErrorMessage(HOSTED_AUTH_ERROR_MESSAGE);
        }

        setIsBusy(false);
        await waitForStateCommit();

        if (!mountedRef.current || generationRef.current !== generation) {
          return outcome;
        }

        // The returning native activity must first commit an enabled opener.
        // Only then wait for the browser transition to settle and restore
        // focus while the background status remains isolated from TalkBack.
        await waitForBrowserToSettle();

        if (!mountedRef.current || generationRef.current !== generation) {
          return outcome;
        }

        try {
          options.restoreFocus?.(outcome);
        } catch (error: unknown) {
          // A platform focus adapter must not turn a completed auth flow into
          // an authentication failure.
          void error;
        }

        setIsAccessibilityActive(false);
        await waitForStateCommit();

        return outcome;
      })().finally(() => {
        if (operationRef.current === operation) {
          operationRef.current = null;
        }
      });

      operationRef.current = operation;
      return operation;
    },
    [waitForBrowserToSettle, waitForStateCommit],
  );

  const value = useMemo<HostedAuthContextValue>(
    () => ({
      authErrorMessage,
      isAccessibilityActive,
      isBusy,
      openAuth,
    }),
    [authErrorMessage, isAccessibilityActive, isBusy, openAuth],
  );

  return (
    <HostedAuthContext.Provider value={value}>
      {children}
    </HostedAuthContext.Provider>
  );
}

export function useHostedAuthFlow(): HostedAuthContextValue {
  const value = useContext(HostedAuthContext);
  if (value === null) {
    throw new Error(
      "useHostedAuthFlow() must be used within HostedAuthProvider",
    );
  }

  return value;
}
