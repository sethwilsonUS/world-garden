import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { BookmarkEntry } from "@curio-garden/domain";
import { AccessibilityInfo, Alert, StyleSheet, View } from "react-native";

import { AccessibleStatus } from "../components/AccessibleStatus";
import { GardenButton } from "../components/GardenButton";
import { GardenCard } from "../components/GardenCard";
import { LibraryEntryCard } from "../components/LibraryEntryCard";
import {
  RouteHeading,
  type RouteHeadingProps,
} from "../components/RouteHeading";
import { GardenScreen } from "../layout/GardenScreen";
import {
  useNativeLibrary,
  type NativeLibraryState,
} from "../library/NativeLibraryContext";
import {
  bookmarkEntriesRevision,
  SAFE_LIBRARY_UPDATE_ERROR,
} from "../library/bookmarkPresentation";
import { GardenText } from "../theme/GardenText";

type LibraryOperationStatus =
  | Readonly<{ kind: "idle"; message: ""; slug: null }>
  | Readonly<{
      kind: "confirming" | "busy";
      message: string;
      slug: string;
    }>
  | Readonly<{
      awaitingRemovalEcho: boolean;
      entriesRevision: string;
      kind: "success" | "error";
      message: string;
      slug: string;
    }>;

const IDLE_OPERATION: LibraryOperationStatus = Object.freeze({
  kind: "idle",
  message: "",
  slug: null,
});
const INACTIVE_ACCOUNT_EPOCH = Symbol("inactive-library-screen");

type ScopedLibraryOperation = Readonly<{
  accountEpoch: symbol;
  libraryStatus: NativeLibraryState["status"];
  routeActive: boolean;
  scope: symbol;
  status: LibraryOperationStatus;
}>;

type RemovalLock = {
  readonly accountEpoch: symbol;
  readonly generation: number;
  readonly intent: number;
  readonly slug: string;
  phase: "confirming" | "mutating";
};

type OpenRemovalConfirmation = Readonly<{
  accountEpoch: symbol;
  intent: number;
  slug: string;
}>;

type ReadyEntriesSnapshot = Readonly<{
  accountEpoch: symbol;
  entries: readonly BookmarkEntry[];
}>;

export type ConfirmLibraryRemoval = (entry: BookmarkEntry) => Promise<boolean>;

export interface LibraryScreenProps {
  readonly confirmRemoval?: ConfirmLibraryRemoval;
  readonly focusAfterRemoval?: (
    element: View,
    targetSlug: string | null,
  ) => void;
  readonly focusHeading?: NonNullable<RouteHeadingProps["focusElement"]>;
  readonly isRouteActive?: boolean;
  readonly onBack: () => void;
  readonly onOpenAccount: () => void;
  readonly onOpenArticle: (slug: string) => void;
  readonly onStartExploring: () => void;
}

export function focusLibraryElement(element: View) {
  element.focus();
  AccessibilityInfo.sendAccessibilityEvent(element, "focus");
}

export function confirmLibraryRemoval(entry: BookmarkEntry): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (answer: boolean) => {
      if (settled) return;
      settled = true;
      resolve(answer);
    };

    Alert.alert(
      "Remove saved article?",
      `Remove ${entry.title} from your Library?`,
      [
        { onPress: () => settle(false), style: "cancel", text: "Cancel" },
        { onPress: () => settle(true), style: "destructive", text: "Remove" },
      ],
      { cancelable: true, onDismiss: () => settle(false) },
    );
  });
}

function baseStatusMessage(
  state: ReturnType<typeof useNativeLibrary>["state"],
): string {
  switch (state.status) {
    case "signedOut":
      return "Sign in to see your saved articles.";
    case "connecting":
      return "Connecting your account.";
    case "loading":
      return "Loading your Library.";
    case "error":
      return state.message;
    case "ready":
      return state.entries.length === 0
        ? "No saved articles yet."
        : `${state.entries.length} saved article${
            state.entries.length === 1 ? "" : "s"
          }.`;
  }
}

export function LibraryScreen({
  confirmRemoval = confirmLibraryRemoval,
  focusAfterRemoval = focusLibraryElement,
  focusHeading,
  isRouteActive = true,
  onBack,
  onOpenAccount,
  onOpenArticle,
  onStartExploring,
}: LibraryScreenProps): ReactElement {
  const library = useNativeLibrary();
  const headingRef = useRef<View>(null);
  const articleRefs = useRef(new Map<string, View>());
  const currentLibraryState = useRef(library.state);
  const focusedEntrySlug = useRef<string | null>(null);
  const lastFocusedEntrySlug = useRef<string | null>(null);
  const focusContextRevision = useRef(0);
  const focusedEntryBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const previousReadyEntries = useRef<ReadyEntriesSnapshot | null>(
    library.state.status === "ready"
      ? { accountEpoch: library.accountEpoch, entries: library.state.entries }
      : null,
  );
  const latestRemovalIntent = useRef(0);
  const removalGeneration = useRef(0);
  const removalLock = useRef<RemovalLock | null>(null);
  const pendingUnavailableMutationFocus = useRef<(() => void) | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduledFocusAttempt = useRef<(() => void) | null>(null);
  const pendingRouteFocusAttempt = useRef<(() => void) | null>(null);
  const activeAccountEpoch = useRef<symbol>(library.accountEpoch);
  const routeActive = useRef(isRouteActive);
  const [scopedOperation, setScopedOperation] =
    useState<ScopedLibraryOperation>(() => ({
      accountEpoch: library.accountEpoch,
      libraryStatus: library.state.status,
      routeActive: isRouteActive,
      scope: Symbol("native-library-screen-scope"),
      status: IDLE_OPERATION,
    }));
  const [openConfirmation, setOpenConfirmation] =
    useState<OpenRemovalConfirmation | null>(null);
  if (
    scopedOperation.accountEpoch !== library.accountEpoch ||
    scopedOperation.libraryStatus !== library.state.status ||
    scopedOperation.routeActive !== isRouteActive
  ) {
    setScopedOperation({
      accountEpoch: library.accountEpoch,
      libraryStatus: library.state.status,
      routeActive: isRouteActive,
      scope: Symbol("native-library-screen-scope"),
      status: IDLE_OPERATION,
    });
  }
  const operationScope = scopedOperation.scope;
  const operation =
    scopedOperation.accountEpoch === library.accountEpoch
      ? scopedOperation.status
      : IDLE_OPERATION;
  if (
    library.state.status === "ready" &&
    (operation.kind === "success" || operation.kind === "error")
  ) {
    const revision = bookmarkEntriesRevision(library.state.entries);
    if (operation.entriesRevision !== revision) {
      const removalEchoArrived =
        operation.kind === "success" &&
        operation.awaitingRemovalEcho &&
        !library.state.entries.some((entry) => entry.slug === operation.slug);
      if (removalEchoArrived) {
        setScopedOperation((current) =>
          current.scope === scopedOperation.scope &&
          (current.status.kind === "success" || current.status.kind === "error")
            ? {
                ...current,
                status: {
                  ...current.status,
                  awaitingRemovalEcho: false,
                  entriesRevision: revision,
                },
              }
            : current,
        );
      } else {
        setScopedOperation({
          accountEpoch: library.accountEpoch,
          libraryStatus: library.state.status,
          routeActive: isRouteActive,
          scope: Symbol("native-library-screen-scope"),
          status: IDLE_OPERATION,
        });
      }
    }
  }
  const setOperation = (status: LibraryOperationStatus) => {
    setScopedOperation((current) =>
      current.scope === operationScope ? { ...current, status } : current,
    );
  };
  const completedOperationMetadata = (
    slug: string,
    awaitingRemovalEcho: boolean,
  ) => {
    const currentState = currentLibraryState.current;
    if (currentState.status !== "ready") {
      return { awaitingRemovalEcho: false, entriesRevision: "" };
    }
    return {
      awaitingRemovalEcho:
        awaitingRemovalEcho &&
        currentState.entries.some((entry) => entry.slug === slug),
      entriesRevision: bookmarkEntriesRevision(currentState.entries),
    };
  };
  const activeOperation =
    isRouteActive && library.state.status === "ready"
      ? operation
      : IDLE_OPERATION;
  const confirmationOpen =
    isRouteActive && openConfirmation?.accountEpoch === library.accountEpoch;
  const statusMessage =
    activeOperation.kind === "idle" || activeOperation.kind === "confirming"
      ? baseStatusMessage(library.state)
      : activeOperation.message;
  const statusIsError =
    activeOperation.kind === "error" || library.state.status === "error";

  const relinquishEntryFocusClaim = () => {
    focusedEntrySlug.current = null;
    lastFocusedEntrySlug.current = null;
    focusContextRevision.current += 1;
  };

  const scheduleFocusAttempt = useCallback((attempt: () => void) => {
    if (focusTimer.current !== null) clearTimeout(focusTimer.current);
    scheduledFocusAttempt.current = attempt;
    const timer = setTimeout(() => {
      if (focusTimer.current === timer) focusTimer.current = null;
      if (scheduledFocusAttempt.current === attempt) {
        scheduledFocusAttempt.current = null;
      }
      if (!routeActive.current) {
        pendingRouteFocusAttempt.current = attempt;
        return;
      }
      attempt();
    }, 0);
    focusTimer.current = timer;
  }, []);

  useLayoutEffect(() => {
    currentLibraryState.current = library.state;
  }, [library.state]);

  useLayoutEffect(() => {
    routeActive.current = isRouteActive;
  }, [isRouteActive]);

  useEffect(() => {
    if (!isRouteActive) return;
    const pendingAttempt = pendingRouteFocusAttempt.current;
    pendingRouteFocusAttempt.current = null;
    pendingAttempt?.();
  }, [isRouteActive]);

  useEffect(() => {
    if (library.state.status === "ready" && isRouteActive) return;

    const currentLock = removalLock.current;
    const recoverMutationFocus =
      isRouteActive &&
      library.state.status !== "ready" &&
      currentLock?.phase === "mutating" &&
      currentLock.accountEpoch === library.accountEpoch
        ? pendingUnavailableMutationFocus.current
        : null;
    removalGeneration.current += 1;
    removalLock.current = null;
    pendingUnavailableMutationFocus.current = null;
    if (!isRouteActive && focusTimer.current !== null) {
      clearTimeout(focusTimer.current);
      focusTimer.current = null;
      pendingRouteFocusAttempt.current = scheduledFocusAttempt.current;
      scheduledFocusAttempt.current = null;
    }
    recoverMutationFocus?.();
  }, [isRouteActive, library.accountEpoch, library.state.status]);

  useLayoutEffect(() => {
    const accountEpoch = library.accountEpoch;
    activeAccountEpoch.current = accountEpoch;
    removalGeneration.current += 1;

    return () => {
      if (activeAccountEpoch.current === accountEpoch) {
        activeAccountEpoch.current = INACTIVE_ACCOUNT_EPOCH;
      }
      removalLock.current = null;
      pendingUnavailableMutationFocus.current = null;
      scheduledFocusAttempt.current = null;
      pendingRouteFocusAttempt.current = null;
      focusedEntrySlug.current = null;
      lastFocusedEntrySlug.current = null;
      previousReadyEntries.current = null;
      removalGeneration.current += 1;
      if (focusTimer.current !== null) {
        clearTimeout(focusTimer.current);
        focusTimer.current = null;
      }
      if (focusedEntryBlurTimer.current !== null) {
        clearTimeout(focusedEntryBlurTimer.current);
        focusedEntryBlurTimer.current = null;
      }
    };
  }, [library.accountEpoch]);

  useLayoutEffect(() => {
    const previous = previousReadyEntries.current;
    const current =
      library.state.status === "ready"
        ? {
            accountEpoch: library.accountEpoch,
            entries: library.state.entries,
          }
        : null;
    previousReadyEntries.current = current;

    if (!previous || previous.accountEpoch !== library.accountEpoch) return;
    const focusedSlug = focusedEntrySlug.current;
    if (
      !focusedSlug ||
      !previous.entries.some((entry) => entry.slug === focusedSlug)
    ) {
      return;
    }

    const focusedEntryStillPresent =
      current?.entries.some((entry) => entry.slug === focusedSlug) ?? false;
    if (focusedEntryStillPresent) return;

    const operationOwnsFocusRecovery =
      (removalLock.current?.accountEpoch === library.accountEpoch &&
        removalLock.current.slug === focusedSlug) ||
      (operation.kind !== "idle" && operation.slug === focusedSlug);
    if (operationOwnsFocusRecovery) return;

    const removedIndex = previous.entries.findIndex(
      (entry) => entry.slug === focusedSlug,
    );
    const preferredSlugs = [
      ...previous.entries.slice(removedIndex + 1),
      ...previous.entries.slice(0, removedIndex).reverse(),
    ].map((entry) => entry.slug);
    const accountEpoch = library.accountEpoch;
    scheduleFocusAttempt(() => {
      if (activeAccountEpoch.current !== accountEpoch) return;
      if (
        currentLibraryState.current.status === "ready" &&
        currentLibraryState.current.entries.some(
          (entry) => entry.slug === focusedSlug,
        )
      ) {
        return;
      }
      const lockedSlug = removalLock.current?.slug;
      const targetSlug = preferredSlugs.find(
        (slug) => slug !== lockedSlug && articleRefs.current.has(slug),
      );
      const target = targetSlug
        ? articleRefs.current.get(targetSlug)
        : headingRef.current;
      focusedEntrySlug.current = targetSlug ?? null;
      if (target) {
        lastFocusedEntrySlug.current = targetSlug ?? null;
        focusContextRevision.current += 1;
        focusAfterRemoval(target, targetSlug ?? null);
      }
    });
  }, [
    focusAfterRemoval,
    library.accountEpoch,
    library.state,
    operation,
    scheduleFocusAttempt,
  ]);

  const requestRemoval = async (entry: BookmarkEntry, index: number) => {
    if (!isRouteActive || confirmationOpen || removalLock.current !== null) {
      return;
    }

    const accountEpoch = library.accountEpoch;
    const generation = ++removalGeneration.current;
    const intent = ++latestRemovalIntent.current;
    let expectedFocusContextRevision = focusContextRevision.current;
    if (focusTimer.current !== null) {
      clearTimeout(focusTimer.current);
      focusTimer.current = null;
    }
    scheduledFocusAttempt.current = null;
    pendingRouteFocusAttempt.current = null;
    const nextFocusSlug = library.state.entries[index + 1]?.slug ?? null;
    const previousFocusSlug = library.state.entries[index - 1]?.slug ?? null;
    const lock: RemovalLock = {
      accountEpoch,
      generation,
      intent,
      phase: "confirming",
      slug: entry.slug,
    };
    removalLock.current = lock;
    const ownsLock = () => removalLock.current === lock;
    let focusRecoveryScheduled = false;
    const scheduleFocusRecovery = (
      onlyIfEntryMissing: boolean,
      requireCurrentGeneration = true,
      preferInvokingEntry = false,
    ) => {
      if (focusRecoveryScheduled) return;
      focusRecoveryScheduled = true;
      scheduleFocusAttempt(() => {
        if (
          (requireCurrentGeneration &&
            generation !== removalGeneration.current) ||
          activeAccountEpoch.current !== accountEpoch ||
          focusContextRevision.current !== expectedFocusContextRevision ||
          (!requireCurrentGeneration &&
            intent !== latestRemovalIntent.current) ||
          (onlyIfEntryMissing &&
            currentLibraryState.current.status === "ready" &&
            currentLibraryState.current.entries.some(
              (currentEntry) => currentEntry.slug === entry.slug,
            ))
        ) {
          return;
        }
        const invokingTarget = preferInvokingEntry
          ? articleRefs.current.get(entry.slug)
          : undefined;
        const nextTarget = nextFocusSlug
          ? articleRefs.current.get(nextFocusSlug)
          : undefined;
        const previousTarget = previousFocusSlug
          ? articleRefs.current.get(previousFocusSlug)
          : undefined;
        const target =
          invokingTarget ?? nextTarget ?? previousTarget ?? headingRef.current;
        const targetSlug = invokingTarget
          ? entry.slug
          : nextTarget
            ? nextFocusSlug
            : previousTarget
              ? previousFocusSlug
              : null;
        focusedEntrySlug.current = targetSlug;
        if (target) {
          lastFocusedEntrySlug.current = targetSlug;
          focusContextRevision.current += 1;
          focusAfterRemoval(target, targetSlug);
        }
      });
    };
    const recoverUnavailableMutationFocus = () =>
      scheduleFocusRecovery(false, false);
    pendingUnavailableMutationFocus.current = recoverUnavailableMutationFocus;
    const releaseLock = () => {
      if (!ownsLock()) return;
      removalLock.current = null;
      if (
        pendingUnavailableMutationFocus.current ===
        recoverUnavailableMutationFocus
      ) {
        pendingUnavailableMutationFocus.current = null;
      }
    };
    const closeConfirmation = () => {
      if (activeAccountEpoch.current !== accountEpoch) return;
      setOpenConfirmation((current) =>
        current?.accountEpoch === accountEpoch && current.intent === intent
          ? null
          : current,
      );
    };
    setOpenConfirmation({
      accountEpoch,
      intent,
      slug: entry.slug,
    });
    setOperation({
      kind: "confirming",
      message: `Removing ${entry.title} requires confirmation.`,
      slug: entry.slug,
    });
    let confirmed = false;
    try {
      confirmed = await confirmRemoval(entry);
    } catch (error) {
      void error;
      closeConfirmation();
      if (activeAccountEpoch.current !== accountEpoch) return;
      if (generation !== removalGeneration.current || !ownsLock()) {
        scheduleFocusRecovery(false, false, true);
        return;
      }
      releaseLock();
      setOperation({
        ...completedOperationMetadata(entry.slug, false),
        kind: "error",
        message: SAFE_LIBRARY_UPDATE_ERROR,
        slug: entry.slug,
      });
      scheduleFocusRecovery(true);
      return;
    }
    closeConfirmation();
    if (
      currentLibraryState.current.status !== "ready" ||
      generation !== removalGeneration.current ||
      !ownsLock()
    ) {
      releaseLock();
      if (activeAccountEpoch.current === accountEpoch) {
        scheduleFocusRecovery(false, false, true);
      }
      return;
    }
    if (!confirmed) {
      releaseLock();
      setOperation(IDLE_OPERATION);
      scheduleFocusRecovery(true);
      return;
    }

    expectedFocusContextRevision = focusContextRevision.current;
    lock.phase = "mutating";
    setOperation({
      kind: "busy",
      message: `Removing ${entry.title} from your Library.`,
      slug: entry.slug,
    });

    let result;
    try {
      result = await library.removeBookmark({ slug: entry.slug });
    } catch (error) {
      void error;
      result = {
        message: SAFE_LIBRARY_UPDATE_ERROR,
        status: "failed",
      } as const;
    }
    if (generation !== removalGeneration.current || !ownsLock()) {
      if (activeAccountEpoch.current === accountEpoch) {
        scheduleFocusRecovery(false, false);
      }
      return;
    }
    releaseLock();

    if (result.status === "superseded") {
      setOperation(IDLE_OPERATION);
      scheduleFocusRecovery(true);
      return;
    }
    if (result.status === "failed") {
      setOperation({
        ...completedOperationMetadata(entry.slug, false),
        kind: "error",
        message: result.message,
        slug: entry.slug,
      });
      scheduleFocusRecovery(true);
      return;
    }

    setOperation({
      ...completedOperationMetadata(entry.slug, true),
      kind: "success",
      message: `${entry.title} removed from your Library.`,
      slug: entry.slug,
    });
    scheduleFocusRecovery(false);
  };

  return (
    <GardenScreen
      contentContainerStyle={styles.content}
      testID="library-screen"
    >
      <GardenButton
        hint="Returns to the Curio Garden home screen."
        label="Back to garden"
        onFocus={relinquishEntryFocusClaim}
        onPress={() => {
          relinquishEntryFocusClaim();
          onBack();
        }}
        variant="secondary"
      />
      <RouteHeading
        active={isRouteActive}
        ref={headingRef}
        focusElement={focusHeading}
        focusKey="library"
        onFocus={relinquishEntryFocusClaim}
        testID="library-screen-heading"
        title="Library"
      />
      <AccessibleStatus
        accessible={!confirmationOpen && statusMessage.trim().length > 0}
        announceOnReveal={statusIsError}
        accessibilityRole={statusIsError ? "alert" : undefined}
        announcementMode={
          isRouteActive && !confirmationOpen ? "automatic" : "none"
        }
        color={statusIsError ? "critical" : "foreground2"}
        message={statusMessage}
        testID="library-status"
      />

      {library.state.status === "signedOut" ? (
        <GardenCard style={styles.centeredCard}>
          <GardenText variant="cardTitle">
            Sign in to see your saved articles
          </GardenText>
          <GardenText color="foreground2">
            Your Library is tied to your Curio Garden account. Articles stay
            public while you’re signed out.
          </GardenText>
          <GardenButton
            hint="Opens sign-in and account settings."
            label="Go to Account"
            onPress={onOpenAccount}
          />
          <GardenButton
            hint="Returns to public search and reading."
            label="Start exploring"
            onPress={onStartExploring}
            variant="secondary"
          />
        </GardenCard>
      ) : null}

      {library.state.status === "connecting" ||
      library.state.status === "loading" ? (
        <GardenCard style={styles.centeredCard}>
          <GardenText variant="cardTitle">Loading your Library</GardenText>
          <GardenText color="foreground2">
            Fetching the articles saved to this signed-in account.
          </GardenText>
        </GardenCard>
      ) : null}

      {library.state.status === "error" ? (
        <GardenCard style={styles.centeredCard}>
          <GardenText variant="cardTitle">The garden gate stuck</GardenText>
          <GardenText color="foreground2">
            Retry your account Library without leaving this screen.
          </GardenText>
          <GardenButton
            hint="Requests your saved articles again."
            label="Try again"
            onPress={library.retry}
            variant="secondary"
          />
        </GardenCard>
      ) : null}

      {library.state.status === "ready" &&
      library.state.entries.length === 0 ? (
        <GardenCard style={styles.centeredCard}>
          <GardenText variant="cardTitle">No saved articles yet</GardenText>
          <GardenText color="foreground2">
            Save articles while browsing and they’ll appear here.
          </GardenText>
          <GardenButton
            hint="Returns to public search and reading."
            label="Start exploring"
            onPress={onStartExploring}
          />
        </GardenCard>
      ) : null}

      {library.state.status === "ready" && library.state.entries.length > 0 ? (
        <View accessible={false} style={styles.entries}>
          {library.state.entries.map((entry, index) => (
            <LibraryEntryCard
              key={entry.slug}
              ref={(element) => {
                if (element) articleRefs.current.set(entry.slug, element);
                else articleRefs.current.delete(entry.slug);
              }}
              blockedByRemoval={
                (confirmationOpen && openConfirmation.slug !== entry.slug) ||
                ((activeOperation.kind === "confirming" ||
                  activeOperation.kind === "busy") &&
                  activeOperation.slug !== entry.slug)
              }
              busy={
                library.isMutating(entry.slug) ||
                (confirmationOpen && openConfirmation.slug === entry.slug) ||
                ((activeOperation.kind === "confirming" ||
                  activeOperation.kind === "busy") &&
                  activeOperation.slug === entry.slug)
              }
              entry={entry}
              onEntryBlur={() => {
                if (focusedEntryBlurTimer.current !== null) {
                  clearTimeout(focusedEntryBlurTimer.current);
                }
                focusedEntryBlurTimer.current = setTimeout(() => {
                  focusedEntryBlurTimer.current = null;
                  if (focusedEntrySlug.current === entry.slug) {
                    focusedEntrySlug.current = null;
                  }
                }, 0);
              }}
              onEntryFocus={() => {
                if (focusedEntryBlurTimer.current !== null) {
                  clearTimeout(focusedEntryBlurTimer.current);
                  focusedEntryBlurTimer.current = null;
                }
                focusedEntrySlug.current = entry.slug;
                if (lastFocusedEntrySlug.current !== entry.slug) {
                  lastFocusedEntrySlug.current = entry.slug;
                  focusContextRevision.current += 1;
                }
              }}
              onOpen={() => onOpenArticle(entry.slug)}
              onRequestRemove={() => void requestRemoval(entry, index)}
            />
          ))}
        </View>
      ) : null}
    </GardenScreen>
  );
}

const styles = StyleSheet.create({
  centeredCard: {
    alignItems: "stretch",
  },
  content: {
    gap: 24,
  },
  entries: {
    gap: 8,
  },
});
