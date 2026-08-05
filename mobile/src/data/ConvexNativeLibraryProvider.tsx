import type { BookmarkEntry } from "@curio-garden/domain";
import { useMutation, useQueries } from "convex/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import { useNativeAuth } from "../auth/NativeAuthContext";
import { useNativeAuthTransportBinding } from "../auth/NativeAuthTransportBindingContext";
import {
  NativeLibraryProvider,
  type NativeLibraryMutationResult,
  type NativeLibraryValue,
} from "../library/NativeLibraryContext";
import { convexClientApi } from "./convexClientApi";

const EMPTY_ENTRIES = Object.freeze([]) as readonly [];
const SIGNED_OUT_STATE = Object.freeze({
  entries: EMPTY_ENTRIES,
  status: "signedOut" as const,
});
const CONNECTING_STATE = Object.freeze({
  entries: EMPTY_ENTRIES,
  status: "connecting" as const,
});
const LOADING_STATE = Object.freeze({
  entries: EMPTY_ENTRIES,
  status: "loading" as const,
});
const ERROR_STATE = Object.freeze({
  entries: EMPTY_ENTRIES,
  message: "We couldn’t load your Library. Please try again.",
  status: "error" as const,
});
const SKIPPED_LIBRARY_QUERIES = Object.freeze({});
const SUPERSEDED_RESULT = Object.freeze({
  status: "superseded" as const,
});
const COMMITTED_RESULT = Object.freeze({
  status: "committed" as const,
});
const SAVE_ERROR_MESSAGE = "We couldn’t save this article. Please try again.";
const REMOVE_ERROR_MESSAGE =
  "We couldn’t remove this article. Please try again.";
const INACTIVE_EPOCH = Symbol("inactive-native-library");

interface PendingOperation {
  readonly promise: Promise<NativeLibraryMutationResult>;
  readonly signature: string;
  readonly token: symbol;
}

function sanitizeMutationError(
  _error: unknown,
  message: string,
): NativeLibraryMutationResult {
  return { message, status: "failed" };
}

export function ConvexNativeLibraryProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const auth = useNativeAuth();
  const expectedAccountSubject = useNativeAuthTransportBinding();
  const [queryAttemptState, setQueryAttemptState] = useState<{
    readonly attempt: number;
    readonly epoch: symbol;
    readonly paused: boolean;
  }>(() => ({ attempt: 0, epoch: auth.sessionEpoch, paused: false }));
  if (queryAttemptState.epoch !== auth.sessionEpoch) {
    setQueryAttemptState({
      attempt: 0,
      epoch: auth.sessionEpoch,
      paused: false,
    });
  }
  useEffect(() => {
    if (!queryAttemptState.paused) {
      return;
    }

    let active = true;
    queueMicrotask(() => {
      if (!active) {
        return;
      }
      setQueryAttemptState((current) =>
        current.epoch === auth.sessionEpoch && current.paused
          ? {
              attempt: current.attempt + 1,
              epoch: current.epoch,
              paused: false,
            }
          : current,
      );
    });

    return () => {
      active = false;
    };
  }, [auth.sessionEpoch, queryAttemptState.paused]);
  const queryName = `nativeBookmarks${queryAttemptState.attempt}`;
  const canQuery =
    auth.state.status === "ready" &&
    expectedAccountSubject !== null &&
    !queryAttemptState.paused;
  const libraryQueries = useMemo(
    () =>
      canQuery
        ? Object.freeze({
            [queryName]: Object.freeze({
              args: Object.freeze({
                expectedAccountSubject,
                sessionEpochKey: auth.sessionEpochKey,
              }),
              query: convexClientApi.bookmarks.listNative,
            }),
          })
        : SKIPPED_LIBRARY_QUERIES,
    [auth.sessionEpochKey, canQuery, expectedAccountSubject, queryName],
  );
  const libraryResults = useQueries(libraryQueries);
  const libraryResult = (
    queryName in libraryResults ? libraryResults[queryName] : undefined
  ) as
    | {
        readonly entries: readonly BookmarkEntry[];
        readonly sessionEpochKey: string;
      }
    | Error
    | undefined;
  const libraryIsReady =
    auth.state.status === "ready" &&
    expectedAccountSubject !== null &&
    libraryResult !== undefined &&
    !(libraryResult instanceof Error) &&
    libraryResult.sessionEpochKey === auth.sessionEpochKey;
  const saveMutation = useMutation(convexClientApi.bookmarks.saveNative);
  const removeMutation = useMutation(convexClientApi.bookmarks.removeNative);
  const currentEpochRef = useRef<symbol>(
    auth.state.status === "ready" ? auth.sessionEpoch : INACTIVE_EPOCH,
  );
  useLayoutEffect(() => {
    currentEpochRef.current =
      auth.state.status === "ready" ? auth.sessionEpoch : INACTIVE_EPOCH;

    return () => {
      if (currentEpochRef.current === auth.sessionEpoch) {
        currentEpochRef.current = INACTIVE_EPOCH;
      }
    };
  }, [auth.sessionEpoch, auth.state.status]);
  const operationsRef = useRef<Map<symbol, Map<string, PendingOperation>>>(
    new Map(),
  );
  const [pendingState, setPendingState] = useState<{
    readonly epoch: symbol;
    readonly slugs: ReadonlySet<string>;
  }>(() => ({ epoch: auth.sessionEpoch, slugs: new Set() }));

  const runMutation = useCallback(
    (
      slug: string,
      signature: string,
      mutate: () => Promise<{ readonly sessionEpochKey: string }>,
      failureMessage: string,
    ): Promise<NativeLibraryMutationResult> => {
      if (!libraryIsReady || currentEpochRef.current !== auth.sessionEpoch) {
        return Promise.resolve(SUPERSEDED_RESULT);
      }

      const operationEpoch = auth.sessionEpoch;
      let epochOperations = operationsRef.current.get(operationEpoch);
      if (epochOperations === undefined) {
        epochOperations = new Map();
        operationsRef.current.set(operationEpoch, epochOperations);
      }
      const existing = epochOperations.get(slug);
      if (existing !== undefined) {
        return existing.signature === signature
          ? existing.promise
          : Promise.resolve(SUPERSEDED_RESULT);
      }

      const operationToken = Symbol("native-library-mutation");
      const promise = (async (): Promise<NativeLibraryMutationResult> => {
        try {
          const response = await Promise.resolve().then(mutate);
          return currentEpochRef.current === operationEpoch &&
            response.sessionEpochKey === auth.sessionEpochKey
            ? COMMITTED_RESULT
            : SUPERSEDED_RESULT;
        } catch (error: unknown) {
          return currentEpochRef.current === operationEpoch
            ? sanitizeMutationError(error, failureMessage)
            : SUPERSEDED_RESULT;
        } finally {
          if (epochOperations.get(slug)?.token === operationToken) {
            epochOperations.delete(slug);
            if (epochOperations.size === 0) {
              operationsRef.current.delete(operationEpoch);
            }
            if (currentEpochRef.current === operationEpoch) {
              setPendingState((current) => {
                if (current.epoch !== operationEpoch) {
                  return current;
                }

                const slugs = new Set(current.slugs);
                slugs.delete(slug);
                return { epoch: current.epoch, slugs };
              });
            }
          }
        }
      })();
      const operation: PendingOperation = {
        promise,
        signature,
        token: operationToken,
      };
      epochOperations.set(slug, operation);
      setPendingState((current) => {
        const slugs =
          current.epoch === operationEpoch
            ? new Set(current.slugs)
            : new Set<string>();
        slugs.add(slug);
        return { epoch: operationEpoch, slugs };
      });
      return promise;
    },
    [auth.sessionEpoch, auth.sessionEpochKey, libraryIsReady],
  );

  const saveBookmark = useCallback(
    (args: Readonly<{ slug: string; title: string }>) => {
      if (expectedAccountSubject === null) {
        return Promise.resolve(SUPERSEDED_RESULT);
      }

      return runMutation(
        args.slug,
        `save:${args.title}`,
        () =>
          saveMutation({
            ...args,
            expectedAccountSubject,
            sessionEpochKey: auth.sessionEpochKey,
          }),
        SAVE_ERROR_MESSAGE,
      );
    },
    [auth.sessionEpochKey, expectedAccountSubject, runMutation, saveMutation],
  );
  const removeBookmark = useCallback(
    (args: Readonly<{ slug: string }>) => {
      if (expectedAccountSubject === null) {
        return Promise.resolve(SUPERSEDED_RESULT);
      }

      return runMutation(
        args.slug,
        "remove",
        () =>
          removeMutation({
            ...args,
            expectedAccountSubject,
            sessionEpochKey: auth.sessionEpochKey,
          }),
        REMOVE_ERROR_MESSAGE,
      );
    },
    [auth.sessionEpochKey, expectedAccountSubject, removeMutation, runMutation],
  );
  const isMutating = useCallback(
    (slug: string) =>
      pendingState.epoch === auth.sessionEpoch && pendingState.slugs.has(slug),
    [auth.sessionEpoch, pendingState],
  );
  const retry = useCallback(() => {
    if (auth.state.status !== "ready") {
      return;
    }

    setQueryAttemptState((current) =>
      current.epoch === auth.sessionEpoch
        ? { ...current, paused: true }
        : { attempt: 0, epoch: auth.sessionEpoch, paused: false },
    );
  }, [auth.sessionEpoch, auth.state.status]);

  const value = useMemo<NativeLibraryValue>(() => {
    const state =
      auth.state.status === "signedOut"
        ? SIGNED_OUT_STATE
        : auth.state.status !== "ready"
          ? CONNECTING_STATE
          : libraryResult instanceof Error
            ? ERROR_STATE
            : libraryResult !== undefined &&
                libraryResult.sessionEpochKey === auth.sessionEpochKey
              ? {
                  entries: libraryResult.entries,
                  status: "ready" as const,
                }
              : LOADING_STATE;

    return {
      accountEpoch: auth.sessionEpoch,
      isMutating,
      removeBookmark,
      retry,
      saveBookmark,
      state,
    };
  }, [
    auth.sessionEpoch,
    auth.sessionEpochKey,
    auth.state.status,
    isMutating,
    libraryResult,
    removeBookmark,
    retry,
    saveBookmark,
  ]);

  return (
    <NativeLibraryProvider value={value}>{children}</NativeLibraryProvider>
  );
}
