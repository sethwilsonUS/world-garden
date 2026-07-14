"use client";

import {
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type RefObject,
} from "react";
import {
  addClaimedImportSlugs,
  clearAccountMirrorBookmarks,
  readAccountMirrorBookmarks,
  readClaimedImportSlugs,
  readGuestBookmarks,
  writeAccountMirrorBookmarks,
} from "@/lib/bookmark-storage";
import { getUnclaimedGuestBookmarks, type BookmarkEntry } from "@/lib/bookmarks";
import {
  buildBookmarkImportSignature,
  hybridBookmarkReducer,
  initialHybridBookmarkState,
  type HybridBookmarkAction,
  type HybridBookmarkState,
} from "@/lib/bookmark-state";

type ImportGuestBookmarks = (args: {
  entries: BookmarkEntry[];
}) => Promise<unknown>;

type BookmarkSynchronizationArgs = {
  isClerkLoaded: boolean;
  isSignedIn: boolean;
  isConvexAuthLoading: boolean;
  isAuthenticated: boolean;
  canUseAccountApi: boolean;
  userKey: string | null;
  remoteEntries: BookmarkEntry[] | undefined;
  importGuestBookmarks: ImportGuestBookmarks;
};

type BookmarkSynchronization = {
  state: HybridBookmarkState;
  dispatch: Dispatch<HybridBookmarkAction>;
  activeUserKeyRef: RefObject<string | null>;
  pendingMutationKeysRef: RefObject<Set<string>>;
};

export const getBookmarkMutationKey = (userKey: string, slug: string): string =>
  `${userKey}\u0000${slug}`;

export const useBookmarkSynchronization = ({
  isClerkLoaded,
  isSignedIn,
  isConvexAuthLoading,
  isAuthenticated,
  canUseAccountApi,
  userKey,
  remoteEntries,
  importGuestBookmarks,
}: BookmarkSynchronizationArgs): BookmarkSynchronization => {
  const [state, dispatch] = useReducer(
    hybridBookmarkReducer,
    initialHybridBookmarkState,
  );
  const [importRetryRevision, retryFailedImport] = useReducer(
    (revision: number) => revision + 1,
    0,
  );
  const activeUserKeyRef = useRef<string | null>(null);
  const pendingMutationKeysRef = useRef(new Set<string>());
  const attemptedImportSignatureRef = useRef<string | null>(null);
  const importInFlightSignatureRef = useRef<string | null>(null);
  const failedImportSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isClerkLoaded) {
      dispatch({ type: "reset" });
      return;
    }

    const previousUserKey = activeUserKeyRef.current;

    if (!isSignedIn || !userKey) {
      if (previousUserKey) {
        clearAccountMirrorBookmarks(previousUserKey);
      }

      activeUserKeyRef.current = null;
      pendingMutationKeysRef.current.clear();
      attemptedImportSignatureRef.current = null;
      importInFlightSignatureRef.current = null;
      failedImportSignatureRef.current = null;
      dispatch({ type: "guest", entries: readGuestBookmarks() });
      return;
    }

    if (previousUserKey && previousUserKey !== userKey) {
      clearAccountMirrorBookmarks(previousUserKey);
    }

    activeUserKeyRef.current = userKey;
    pendingMutationKeysRef.current.clear();
    attemptedImportSignatureRef.current = null;
    importInFlightSignatureRef.current = null;
    failedImportSignatureRef.current = null;
    dispatch({
      type: "accountMirror",
      entries: readAccountMirrorBookmarks(userKey),
    });
  }, [isClerkLoaded, isSignedIn, userKey]);

  useEffect(() => {
    if (!isClerkLoaded || !isSignedIn || !userKey) {
      return;
    }

    if (!isConvexAuthLoading && !isAuthenticated) {
      dispatch({ type: "convexUnavailable" });
    }
  }, [isAuthenticated, isClerkLoaded, isConvexAuthLoading, isSignedIn, userKey]);

  useEffect(() => {
    const handleWindowFocus = () => {
      const failedImportSignature = failedImportSignatureRef.current;
      if (!failedImportSignature) {
        return;
      }

      if (attemptedImportSignatureRef.current === failedImportSignature) {
        attemptedImportSignatureRef.current = null;
      }
      if (importInFlightSignatureRef.current === failedImportSignature) {
        importInFlightSignatureRef.current = null;
      }
      failedImportSignatureRef.current = null;
      retryFailedImport();
    };

    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, []);

  useEffect(() => {
    if (!canUseAccountApi || !userKey || remoteEntries === undefined) {
      return;
    }

    dispatch({ type: "syncRemote", remoteEntries });

    const unclaimedGuestEntries = getUnclaimedGuestBookmarks(
      readGuestBookmarks(),
      readClaimedImportSlugs(userKey),
    );
    const importSignature = buildBookmarkImportSignature(
      userKey,
      unclaimedGuestEntries,
    );

    if (importSignature && importInFlightSignatureRef.current === importSignature) {
      dispatch({ type: "startImport" });
      return;
    }

    if (
      importSignature &&
      attemptedImportSignatureRef.current !== importSignature &&
      !importInFlightSignatureRef.current
    ) {
      attemptedImportSignatureRef.current = importSignature;
      importInFlightSignatureRef.current = importSignature;
      dispatch({ type: "startImport" });

      void importGuestBookmarks({ entries: unclaimedGuestEntries })
        .then(() => {
          if (activeUserKeyRef.current !== userKey) {
            return;
          }

          failedImportSignatureRef.current = null;
          addClaimedImportSlugs(
            userKey,
            unclaimedGuestEntries.map((entry) => entry.slug),
          );
          dispatch({
            type: "importSuccess",
            importedEntries: unclaimedGuestEntries,
            remoteEntries,
          });
        })
        .catch(() => {
          if (activeUserKeyRef.current !== userKey) {
            return;
          }

          failedImportSignatureRef.current = importSignature;
          dispatch({ type: "importFailure", remoteEntries });
        })
        .finally(() => {
          if (importInFlightSignatureRef.current === importSignature) {
            importInFlightSignatureRef.current = null;
          }
        });
    }
  }, [
    canUseAccountApi,
    importGuestBookmarks,
    importRetryRevision,
    remoteEntries,
    userKey,
  ]);

  useEffect(() => {
    if (isSignedIn && userKey) {
      writeAccountMirrorBookmarks(userKey, state.entries);
    }
  }, [isSignedIn, state.entries, userKey]);

  return {
    state,
    dispatch,
    activeUserKeyRef,
    pendingMutationKeysRef,
  };
};
