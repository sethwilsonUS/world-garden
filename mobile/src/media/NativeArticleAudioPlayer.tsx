import type { WikipediaArticle } from "@curio-garden/domain";
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
import { AppState, StyleSheet, View, type AppStateStatus } from "react-native";

import { AccessibleStatus } from "../components/AccessibleStatus";
import { GardenButton } from "../components/GardenButton";
import { GardenCard } from "../components/GardenCard";
import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";
import {
  type BackgroundAudioPlaylist,
  type BackgroundAudioPlaylistStatus,
  type BackgroundAudioRuntime,
  type BackgroundAudioSource,
  loadExpoBackgroundAudioRuntime,
} from "./ExpoBackgroundAudioRuntime";
import { useNativeArticleAudioAccess } from "./NativeArticleAudioAccessContext";
import {
  defaultNativeArticleAudioEphemeralStore,
  type NativeArticleAudioEphemeralLease,
  type NativeArticleAudioEphemeralStore,
} from "./NativeArticleAudioEphemeralStore";
import { NativeArticleSummaryAudioPlayer } from "./NativeArticleSummaryAudioPlayer";
import {
  buildNativeArticleAudioItems,
  type NativeArticleAudioItem,
} from "./NativeArticleAudioTracks";

export const MAX_NATIVE_ARTICLE_PLAYLIST_TRACKS = 64;
export const MAX_NATIVE_ARTICLE_PLAYLIST_AUDIO_BYTES = 256 * 1024 * 1024;
export const NATIVE_ARTICLE_PLAYLIST_PREPARATION_TIMEOUT_MS = 15 * 60 * 1000;

const OPERATION_ABORTED = Symbol("native-article-playlist-operation-aborted");

type PlaybackKind =
  | "idle"
  | "preparing"
  | "playing"
  | "paused"
  | "finished"
  | "failure";
type PlaybackMode = "all" | "single";

type PlayerPresentation = Readonly<{
  currentIndex: number;
  currentTime: number;
  duration: number;
  kind: PlaybackKind;
  message: string;
  mode: PlaybackMode | null;
  selectedKey: NativeArticleAudioItem["sectionKey"] | null;
}>;

type ActiveOperation = {
  controller: AbortController;
  currentIndex: number;
  items: readonly NativeArticleAudioItem[];
  leases: NativeArticleAudioEphemeralLease[];
  mode: PlaybackMode;
  playbackStarted: boolean;
  playlist: BackgroundAudioPlaylist | null;
  responseRelease: (() => void) | null;
  timeoutId: ReturnType<typeof setTimeout>;
};

export interface NativeArticleAudioPlayerProps {
  readonly active: boolean;
  readonly article: WikipediaArticle;
  readonly ephemeralStore?: NativeArticleAudioEphemeralStore;
  readonly loadRuntime?: () => Promise<BackgroundAudioRuntime>;
  readonly slug: string;
  readonly summaryDisclosure?: ReactNode;
}

type PlaylistPlayerProps = NativeArticleAudioPlayerProps &
  Readonly<{ items: readonly NativeArticleAudioItem[] }>;

function initialPresentation(playAllCount: number): PlayerPresentation {
  return {
    currentIndex: 0,
    currentTime: 0,
    duration: 0,
    kind: "idle",
    message:
      playAllCount === 0
        ? "No article audio is available for this revision."
        : playAllCount > MAX_NATIVE_ARTICLE_PLAYLIST_TRACKS
          ? `Play All supports up to ${MAX_NATIVE_ARTICLE_PLAYLIST_TRACKS} audio items. You can still listen to one section at a time.`
          : "Article audio is ready when you are.",
    mode: null,
    selectedKey: null,
  };
}

function raceWithAbort<Value>(
  operation: Promise<Value>,
  signal: AbortSignal,
): Promise<Value | typeof OPERATION_ABORTED> {
  if (signal.aborted) return Promise.resolve(OPERATION_ABORTED);

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(OPERATION_ABORTED);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function safeCall(operation: () => void): void {
  try {
    operation();
  } catch (_error: unknown) {
    void _error;
  }
}

async function safeAwait(operation: Promise<unknown>): Promise<void> {
  try {
    await operation;
  } catch (_error: unknown) {
    void _error;
  }
}

function releaseResponse(operation: ActiveOperation): void {
  const release = operation.responseRelease;
  operation.responseRelease = null;
  if (release !== null) safeCall(release);
}

async function disposeOperation(operation: ActiveOperation): Promise<void> {
  clearTimeout(operation.timeoutId);
  operation.controller.abort();
  releaseResponse(operation);
  if (operation.playlist !== null) {
    const playlist = operation.playlist;
    operation.playlist = null;
    await safeAwait(playlist.release());
  }
  const leases = operation.leases.splice(0);
  for (const lease of leases) await safeAwait(lease.release());
}

function normalizeTime(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function responseContentLength(response: Response): number | null {
  const value = response.headers.get("content-length");
  if (value === null || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function formatTime(value: number): string {
  const seconds = Math.floor(normalizeTime(value));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const clock = `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    : clock;
}

function formatAccessibleTime(value: number): string {
  const totalSeconds = Math.floor(normalizeTime(value));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  }
  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
  }
  return parts.join(", ");
}

function timeAccessibilityLabel(presentation: PlayerPresentation): string {
  if (presentation.duration <= 0) {
    return "Current audio duration is available after playback begins.";
  }
  return `Elapsed time ${formatAccessibleTime(presentation.currentTime)}. Current audio duration ${formatAccessibleTime(presentation.duration)}.`;
}

function itemMessage(
  kind: "Playing" | "Paused",
  target: ActiveOperation,
  index: number,
): string {
  const item = target.items[index];
  if (item === undefined) return `${kind} article audio.`;
  if (target.mode === "single") return `${kind} ${item.title}.`;
  return `${kind} ${item.title}. Audio item ${index + 1} of ${target.items.length}.`;
}

function mainControlLabel(
  presentation: PlayerPresentation,
  playAllCount: number,
): string {
  if (playAllCount === 0) return "No audio available";
  if (presentation.mode !== "all") {
    return `Play all ${playAllCount} audio item${playAllCount === 1 ? "" : "s"}`;
  }
  switch (presentation.kind) {
    case "preparing":
      return "Cancel preparing Play All";
    case "playing":
      return "Pause playing all audio";
    case "paused":
      return "Resume playing all audio";
    case "finished":
      return "Replay all audio";
    case "failure":
    case "idle":
      return `Play all ${playAllCount} audio item${playAllCount === 1 ? "" : "s"}`;
  }
}

function mainControlHint(
  presentation: PlayerPresentation,
  articleTitle: string,
  disabled: boolean,
): string | undefined {
  if (disabled) return undefined;
  if (presentation.mode === "all") {
    switch (presentation.kind) {
      case "preparing":
        return "Stops preparing the complete article audio queue.";
      case "playing":
        return "Pauses the complete article audio queue.";
      case "paused":
        return `Resumes the complete article audio queue. Playback can continue in the background with lock-screen controls for ${articleTitle}.`;
      case "finished":
        return `Restarts the complete article audio queue. Playback can continue in the background with lock-screen controls for ${articleTitle}.`;
      case "failure":
      case "idle":
        break;
    }
  }
  return `Starts the complete article audio queue. Playback can continue in the background with lock-screen controls for ${articleTitle}.`;
}

function itemControl(
  item: NativeArticleAudioItem,
  articleTitle: string,
  presentation: PlayerPresentation,
  position?: Readonly<{ current: number; total: number }>,
): Readonly<{ accessibleLabel: string; label: string }> {
  const selected = presentation.selectedKey === item.sectionKey;
  const itemContext =
    item.kind === "summary"
      ? `summary of ${articleTitle}`
      : `${item.title} in ${articleTitle}`;
  const context = position
    ? `${itemContext}. Audio item ${position.current} of ${position.total}`
    : itemContext;
  if (!selected)
    return { accessibleLabel: `Listen to ${context}`, label: "Listen" };
  switch (presentation.kind) {
    case "preparing":
      return {
        accessibleLabel: `Cancel preparing ${context}`,
        label: "Cancel",
      };
    case "playing":
      return {
        accessibleLabel: `Playing ${context}. Pause audio`,
        label: "Playing",
      };
    case "paused":
      return {
        accessibleLabel: `Paused ${context}. Resume audio`,
        label: "Paused",
      };
    case "finished":
      return { accessibleLabel: `Replay ${context}`, label: "Replay" };
    case "failure":
    case "idle":
      return { accessibleLabel: `Listen to ${context}`, label: "Listen" };
  }
}

function spokenTitleKey(title: string): string {
  return title.normalize("NFKC").toLocaleLowerCase("en-US");
}

function NativeArticlePlaylistAudioPlayer({
  active,
  article,
  ephemeralStore,
  items,
  loadRuntime = loadExpoBackgroundAudioRuntime,
  slug,
  summaryDisclosure,
}: PlaylistPlayerProps): ReactElement {
  const access = useNativeArticleAudioAccess();
  const { colors, fonts, radii, spacing } = useGardenTheme();
  const store = ephemeralStore ?? defaultNativeArticleAudioEphemeralStore;
  const { playAllIndexByKey, playAllItems, spokenTitleCounts } = useMemo(() => {
    const nextPlayAllItems = items.filter((item) => item.includedInPlayAll);
    const nextSpokenTitleCounts = new Map<string, number>();
    for (const item of items) {
      if (!item.individuallyPlayable) continue;
      const titleKey = spokenTitleKey(item.title);
      nextSpokenTitleCounts.set(
        titleKey,
        (nextSpokenTitleCounts.get(titleKey) ?? 0) + 1,
      );
    }
    return {
      playAllIndexByKey: new Map(
        nextPlayAllItems.map((item, index) => [item.sectionKey, index]),
      ),
      playAllItems: nextPlayAllItems,
      spokenTitleCounts: nextSpokenTitleCounts,
    };
  }, [items]);
  const canPlayAll =
    playAllItems.length > 0 &&
    playAllItems.length <= MAX_NATIVE_ARTICLE_PLAYLIST_TRACKS;
  const mounted = useRef(true);
  const initiallyForeground = AppState.currentState === "active";
  const foreground = useRef(initiallyForeground);
  const operation = useRef<ActiveOperation | null>(null);
  const currentAccountEpoch = useRef(access.accountEpoch);
  const initial = initialPresentation(playAllItems.length);
  const [isForeground, setIsForeground] = useState(initiallyForeground);
  const [presentation, setPresentation] = useState<PlayerPresentation>(initial);
  const presentationRef = useRef(presentation);

  useLayoutEffect(() => {
    currentAccountEpoch.current = access.accountEpoch;
  }, [access.accountEpoch]);

  const updatePresentation = useCallback((next: PlayerPresentation) => {
    presentationRef.current = next;
    if (mounted.current) setPresentation(next);
  }, []);

  const failOperation = useCallback(
    (
      target: ActiveOperation,
      message = "Could not play the article audio. Please try again.",
    ) => {
      if (operation.current !== target) return;
      operation.current = null;
      updatePresentation({
        currentIndex: 0,
        currentTime: 0,
        duration: 0,
        kind: "failure",
        message,
        mode: null,
        selectedKey: null,
      });
      void disposeOperation(target);
    },
    [updatePresentation],
  );

  const stopCurrent = useCallback(
    (message: string, announce: boolean) => {
      const target = operation.current;
      const hadOperation = target !== null;
      if (target !== null) {
        operation.current = null;
        void disposeOperation(target);
      }
      if (announce && hadOperation) {
        updatePresentation({
          ...initialPresentation(playAllItems.length),
          message,
        });
      }
    },
    [playAllItems.length, updatePresentation],
  );

  const handlePlaybackStatus = useCallback(
    (target: ActiveOperation, status: BackgroundAudioPlaylistStatus) => {
      if (operation.current !== target || target.controller.signal.aborted)
        return;
      if (status.error !== null) {
        failOperation(target);
        return;
      }

      const currentIndex = Math.max(
        0,
        Math.min(target.items.length - 1, status.currentIndex),
      );
      target.currentIndex = currentIndex;
      const currentTime = normalizeTime(status.currentTime);
      const duration = normalizeTime(status.duration);
      const finished = status.ended && currentIndex === target.items.length - 1;
      if (finished) {
        updatePresentation({
          currentIndex,
          currentTime,
          duration,
          kind: "finished",
          message:
            target.mode === "all"
              ? "Finished playing all article audio."
              : `Finished playing ${target.items[0]?.title ?? "article audio"}.`,
          mode: target.mode,
          selectedKey: target.items[currentIndex]?.sectionKey ?? null,
        });
        return;
      }

      const current = presentationRef.current;
      if (status.playing) {
        updatePresentation({
          currentIndex,
          currentTime,
          duration,
          kind: "playing",
          message:
            current.kind === "playing" && current.currentIndex === currentIndex
              ? current.message
              : itemMessage("Playing", target, currentIndex),
          mode: target.mode,
          selectedKey: target.items[currentIndex]?.sectionKey ?? null,
        });
      } else if (
        status.isLoaded &&
        !status.isBuffering &&
        (current.kind === "playing" ||
          current.kind === "paused" ||
          current.kind === "finished")
      ) {
        updatePresentation({
          currentIndex,
          currentTime,
          duration,
          kind: "paused",
          message: itemMessage("Paused", target, currentIndex),
          mode: target.mode,
          selectedKey: target.items[currentIndex]?.sectionKey ?? null,
        });
      } else {
        updatePresentation({ ...current, currentIndex, currentTime, duration });
      }
    },
    [failOperation, updatePresentation],
  );

  const beginPlayback = useCallback(
    async (
      selectedItems: readonly NativeArticleAudioItem[],
      mode: PlaybackMode,
    ) => {
      if (
        !active ||
        !foreground.current ||
        operation.current !== null ||
        selectedItems.length === 0
      ) {
        return;
      }

      const controller = new AbortController();
      const target: ActiveOperation = {
        controller,
        currentIndex: 0,
        items: selectedItems,
        leases: [],
        mode,
        playbackStarted: false,
        playlist: null,
        responseRelease: null,
        timeoutId: 0 as unknown as ReturnType<typeof setTimeout>,
      };
      target.timeoutId = setTimeout(() => {
        if (operation.current !== target) return;
        operation.current = null;
        updatePresentation({
          currentIndex: 0,
          currentTime: 0,
          duration: 0,
          kind: "failure",
          message: "Article audio took too long to prepare. Please try again.",
          mode: null,
          selectedKey: null,
        });
        void disposeOperation(target);
      }, NATIVE_ARTICLE_PLAYLIST_PREPARATION_TIMEOUT_MS);
      operation.current = target;
      const startingEpoch = access.accountEpoch;
      updatePresentation({
        currentIndex: 0,
        currentTime: 0,
        duration: 0,
        kind: "preparing",
        message:
          mode === "all"
            ? `Preparing audio 1 of ${selectedItems.length}: ${selectedItems[0]?.title ?? "article audio"}.`
            : `Preparing ${selectedItems[0]?.title ?? "article audio"}.`,
        mode,
        selectedKey: selectedItems[0]?.sectionKey ?? null,
      });

      try {
        const prepared = await raceWithAbort(
          store.prepare(controller.signal),
          controller.signal,
        );
        if (prepared === OPERATION_ABORTED || operation.current !== target)
          return;
        if (prepared.status !== "ready") {
          failOperation(target);
          return;
        }

        let totalBytes = 0;
        for (let index = 0; index < selectedItems.length; index += 1) {
          const item = selectedItems[index];
          if (item === undefined) {
            failOperation(target);
            return;
          }
          if (mode === "all") {
            updatePresentation({
              currentIndex: index,
              currentTime: 0,
              duration: 0,
              kind: "preparing",
              message: `Preparing audio ${index + 1} of ${selectedItems.length}: ${item.title}.`,
              mode,
              selectedKey: item.sectionKey,
            });
          }

          const requestPromise = access.requestSection({
            narrationVersion: article.narrationVersion,
            provider: "openai",
            revisionId: article.revisionId,
            sectionKey: item.sectionKey,
            signal: controller.signal,
            slug,
          });
          void requestPromise.then(
            (lateResult) => {
              if (
                (controller.signal.aborted || operation.current !== target) &&
                lateResult.status === "ready"
              ) {
                safeCall(lateResult.release);
              }
            },
            (_error: unknown) => void _error,
          );
          const requested = await raceWithAbort(
            requestPromise,
            controller.signal,
          );
          if (requested === OPERATION_ABORTED || operation.current !== target)
            return;
          if (requested.status !== "ready") {
            failOperation(target);
            return;
          }
          target.responseRelease = requested.release;
          if (
            requested.accountEpoch !== startingEpoch ||
            currentAccountEpoch.current !== startingEpoch
          ) {
            failOperation(target);
            return;
          }

          const declaredBytes = responseContentLength(requested.response);
          if (
            declaredBytes !== null &&
            totalBytes + declaredBytes > MAX_NATIVE_ARTICLE_PLAYLIST_AUDIO_BYTES
          ) {
            failOperation(
              target,
              "This article's Play All audio is too large to prepare safely. You can still listen to one section at a time.",
            );
            return;
          }

          const stagePromise = store.stage(
            requested.response,
            controller.signal,
          );
          void stagePromise.then(
            (lateResult) => {
              if (
                (controller.signal.aborted || operation.current !== target) &&
                lateResult.status === "ready"
              ) {
                void safeAwait(lateResult.lease.release());
              }
            },
            (_error: unknown) => void _error,
          );
          const staged = await raceWithAbort(stagePromise, controller.signal);
          if (staged === OPERATION_ABORTED || operation.current !== target)
            return;
          releaseResponse(target);
          if (staged.status !== "ready") {
            if (staged.status === "cancelled" && controller.signal.aborted)
              return;
            failOperation(target);
            return;
          }
          if (currentAccountEpoch.current !== startingEpoch) {
            await safeAwait(staged.lease.release());
            failOperation(target);
            return;
          }
          const nextTotalBytes = totalBytes + staged.lease.byteLength;
          if (nextTotalBytes > MAX_NATIVE_ARTICLE_PLAYLIST_AUDIO_BYTES) {
            await safeAwait(staged.lease.release());
            failOperation(
              target,
              "This article's Play All audio is too large to prepare safely. You can still listen to one section at a time.",
            );
            return;
          }
          target.leases.push(staged.lease);
          totalBytes = nextTotalBytes;
        }

        const runtime = await raceWithAbort(loadRuntime(), controller.signal);
        if (runtime === OPERATION_ABORTED || operation.current !== target)
          return;
        const configured = await raceWithAbort(
          runtime.configureBackgroundMode(),
          controller.signal,
        );
        if (
          configured === OPERATION_ABORTED ||
          operation.current !== target ||
          currentAccountEpoch.current !== startingEpoch
        ) {
          return;
        }

        const sources: BackgroundAudioSource[] = selectedItems.map(
          (item, index) => ({
            metadata: {
              albumTitle: "Curio Garden",
              artist: "Wikipedia",
              title: `${item.title} — ${article.title}`,
            },
            uri: target.leases[index]?.uri ?? "",
          }),
        );
        const playlist = runtime.createPlaylist(
          sources,
          (status) => handlePlaybackStatus(target, status),
          ({ currentIndex }) => {
            if (
              operation.current !== target ||
              target.controller.signal.aborted
            )
              return;
            const boundedIndex = Math.max(
              0,
              Math.min(target.items.length - 1, currentIndex),
            );
            target.currentIndex = boundedIndex;
            const current = presentationRef.current;
            if (
              current.kind !== "playing" &&
              current.kind !== "paused" &&
              current.kind !== "finished"
            )
              return;
            const kind = current.kind === "playing" ? "playing" : "paused";
            updatePresentation({
              currentIndex: boundedIndex,
              currentTime: 0,
              duration: 0,
              kind,
              message: itemMessage(
                kind === "paused" ? "Paused" : "Playing",
                target,
                boundedIndex,
              ),
              mode: target.mode,
              selectedKey: target.items[boundedIndex]?.sectionKey ?? null,
            });
          },
        );
        if (operation.current !== target || controller.signal.aborted) {
          await safeAwait(playlist.release());
          return;
        }
        target.playlist = playlist;
        const started = await raceWithAbort(playlist.play(), controller.signal);
        if (
          started === OPERATION_ABORTED ||
          operation.current !== target ||
          currentAccountEpoch.current !== startingEpoch
        ) {
          return;
        }
        target.playbackStarted = true;
        clearTimeout(target.timeoutId);
        updatePresentation({
          currentIndex: 0,
          currentTime: 0,
          duration: 0,
          kind: "playing",
          message: itemMessage("Playing", target, 0),
          mode,
          selectedKey: selectedItems[0]?.sectionKey ?? null,
        });
      } catch (_error: unknown) {
        void _error;
        if (operation.current === target && !controller.signal.aborted) {
          failOperation(target);
        }
      }
    },
    [
      access,
      active,
      article.narrationVersion,
      article.revisionId,
      article.title,
      failOperation,
      handlePlaybackStatus,
      loadRuntime,
      slug,
      store,
      updatePresentation,
    ],
  );

  const cancelPreparation = useCallback(
    (message: string) => {
      const target = operation.current;
      if (target !== null) {
        operation.current = null;
        void disposeOperation(target);
      }
      updatePresentation({
        ...initialPresentation(playAllItems.length),
        message,
      });
    },
    [playAllItems.length, updatePresentation],
  );

  const toggleTarget = useCallback(
    (target: ActiveOperation) => {
      switch (presentationRef.current.kind) {
        case "preparing":
          cancelPreparation("Article audio preparation cancelled.");
          return;
        case "playing":
          if (target.playlist === null) return;
          try {
            target.playlist.pause();
            updatePresentation({
              ...presentationRef.current,
              kind: "paused",
              message: itemMessage("Paused", target, target.currentIndex),
            });
          } catch (_error: unknown) {
            void _error;
            failOperation(target);
          }
          return;
        case "paused":
          if (target.playlist === null) return;
          void target.playlist
            .play()
            .then(() => {
              if (
                operation.current === target &&
                !target.controller.signal.aborted
              ) {
                updatePresentation({
                  ...presentationRef.current,
                  kind: "playing",
                  message: itemMessage("Playing", target, target.currentIndex),
                });
              }
            })
            .catch((_error: unknown) => {
              void _error;
              failOperation(target);
            });
          return;
        case "finished":
          if (target.playlist === null) return;
          try {
            target.playlist.skipTo(0);
            target.currentIndex = 0;
          } catch (_error: unknown) {
            void _error;
            failOperation(target);
            return;
          }
          void target.playlist
            .seekTo(0)
            .then(() => target.playlist?.play())
            .then(() => {
              if (
                operation.current === target &&
                !target.controller.signal.aborted
              ) {
                updatePresentation({
                  currentIndex: 0,
                  currentTime: 0,
                  duration: presentationRef.current.duration,
                  kind: "playing",
                  message: itemMessage("Playing", target, 0),
                  mode: target.mode,
                  selectedKey: target.items[0]?.sectionKey ?? null,
                });
              }
            })
            .catch((_error: unknown) => {
              void _error;
              failOperation(target);
            });
          return;
        case "failure":
        case "idle":
          return;
      }
    },
    [cancelPreparation, failOperation, updatePresentation],
  );

  const replacePlayback = useCallback(
    (selectedItems: readonly NativeArticleAudioItem[], mode: PlaybackMode) => {
      const target = operation.current;
      if (target !== null) {
        operation.current = null;
        void disposeOperation(target);
      }
      void beginPlayback(selectedItems, mode);
    },
    [beginPlayback],
  );

  const handlePlayAll = () => {
    const target = operation.current;
    if (target !== null && target.mode === "all") {
      toggleTarget(target);
      return;
    }
    if (canPlayAll) replacePlayback(playAllItems, "all");
  };

  const handleItem = (item: NativeArticleAudioItem) => {
    const target = operation.current;
    if (
      target !== null &&
      presentationRef.current.kind === "preparing" &&
      presentationRef.current.selectedKey === item.sectionKey
    ) {
      toggleTarget(target);
      return;
    }
    if (
      target !== null &&
      target.mode === "all" &&
      presentationRef.current.kind === "finished" &&
      presentationRef.current.selectedKey === item.sectionKey
    ) {
      replacePlayback([item], "single");
      return;
    }
    if (
      target !== null &&
      target.items[target.currentIndex]?.sectionKey === item.sectionKey
    ) {
      toggleTarget(target);
      return;
    }
    replacePlayback([item], "single");
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const target = operation.current;
      operation.current = null;
      if (target !== null) void disposeOperation(target);
    };
  }, []);

  useLayoutEffect(() => {
    updatePresentation(initialPresentation(playAllItems.length));
    if (!active) stopCurrent("Article audio is ready when you are.", false);
    return () => stopCurrent("Article audio is ready when you are.", false);
  }, [
    access.accountEpoch,
    active,
    article.narrationVersion,
    article.revisionId,
    playAllItems.length,
    slug,
    stopCurrent,
    updatePresentation,
  ]);

  useEffect(() => {
    const reconcileAppState = (nextState: AppStateStatus | null) => {
      const nextForeground = nextState === "active";
      foreground.current = nextForeground;
      setIsForeground(nextForeground);
      const target = operation.current;
      if (nextForeground) {
        if (
          target?.playbackStarted === true &&
          target.playlist !== null &&
          target.playlist !== undefined
        ) {
          try {
            handlePlaybackStatus(target, target.playlist.getStatus());
          } catch (_error: unknown) {
            void _error;
            failOperation(target);
          }
        }
        return;
      }
      if (
        nextState === "background" &&
        target !== null &&
        !target.playbackStarted
      ) {
        stopCurrent(
          "Article audio preparation cancelled when the app left the foreground.",
          true,
        );
      }
    };
    const subscription = AppState.addEventListener("change", reconcileAppState);
    reconcileAppState(AppState.currentState);
    return () => subscription.remove();
  }, [failOperation, handlePlaybackStatus, stopCurrent]);

  const hasOperation =
    presentation.kind === "preparing" ||
    presentation.kind === "playing" ||
    presentation.kind === "paused" ||
    presentation.kind === "finished";
  const activePlaylist =
    presentation.kind === "playing" ||
    presentation.kind === "paused" ||
    presentation.kind === "finished";
  const mainLabel = mainControlLabel(presentation, playAllItems.length);
  const mainBusyWithSingle =
    presentation.kind === "preparing" && presentation.mode === "single";
  const mainDisabled =
    !active || !isForeground || !canPlayAll || mainBusyWithSingle;
  const currentItem =
    items.find((item) => item.sectionKey === presentation.selectedKey) ?? null;

  return (
    <GardenCard
      style={{
        backgroundColor: colors.surface3,
        borderColor: colors.controlBorder,
        borderWidth: 2,
      }}
      testID="article-audio-player"
    >
      <View accessible={false} style={{ gap: spacing.xs }}>
        <GardenText accessibilityRole="header" variant="cardTitle">
          Explore this article
        </GardenText>
        <GardenText color="muted" variant="metadata">
          {playAllItems.length === 1
            ? "1 audio item is available."
            : `${playAllItems.length} audio items are available.`}
        </GardenText>
      </View>

      <GardenButton
        disabled={mainDisabled}
        hint={mainControlHint(presentation, article.title, mainDisabled)}
        label={mainLabel}
        onPress={handlePlayAll}
        testID="article-audio-control"
      />

      {hasOperation && presentation.kind !== "preparing" ? (
        <GardenButton
          accessibilityLabel="Stop article audio"
          disabled={!active || !isForeground}
          label="Stop"
          onPress={() => cancelPreparation("Article audio stopped.")}
          testID="article-audio-stop"
          variant="secondary"
        />
      ) : null}

      {activePlaylist && presentation.mode === "all" ? (
        <View accessible={false} style={{ gap: spacing.sm }}>
          <GardenButton
            accessibilityLabel="Previous audio item"
            disabled={
              !active || !isForeground || presentation.currentIndex <= 0
            }
            label="Previous"
            onPress={() => {
              const target = operation.current;
              if (target?.playlist === null || target === null) return;
              try {
                target.playlist.previous();
              } catch (_error: unknown) {
                void _error;
                failOperation(target);
              }
            }}
            testID="article-audio-previous"
            retainFocusWhenUnavailable
            variant="secondary"
          />
          <GardenButton
            accessibilityLabel="Next audio item"
            disabled={
              !active ||
              !isForeground ||
              presentation.currentIndex >= playAllItems.length - 1
            }
            label="Next"
            onPress={() => {
              const target = operation.current;
              if (target?.playlist === null || target === null) return;
              try {
                target.playlist.next();
              } catch (_error: unknown) {
                void _error;
                failOperation(target);
              }
            }}
            testID="article-audio-next"
            retainFocusWhenUnavailable
            variant="secondary"
          />
        </View>
      ) : null}

      <GardenText
        accessibilityLabel={timeAccessibilityLabel(presentation)}
        color="muted"
        testID="article-audio-time"
        variant="metadata"
      >
        {presentation.duration > 0
          ? `${formatTime(presentation.currentTime)} of ${formatTime(presentation.duration)}`
          : "Current duration available after playback begins."}
      </GardenText>
      <GardenText
        color="muted"
        testID="article-audio-disclosure"
        variant="metadata"
      >
        Audio is generated with synthetic speech.
      </GardenText>
      <AccessibleStatus
        accessibilityRole={
          presentation.kind === "failure" ? "alert" : undefined
        }
        announcementMode={active && isForeground ? "automatic" : "none"}
        color={presentation.kind === "failure" ? "critical" : "foreground2"}
        message={presentation.message}
        testID="article-audio-status"
      />

      {summaryDisclosure}

      <View accessible={false} style={{ gap: spacing.sm }}>
        {items.map((item) => {
          const selected = currentItem?.sectionKey === item.sectionKey;
          const duplicateTitleCount =
            spokenTitleCounts.get(spokenTitleKey(item.title)) ?? 0;
          const playAllIndex = playAllIndexByKey.get(item.sectionKey) ?? -1;
          const control = item.individuallyPlayable
            ? itemControl(
                item,
                article.title,
                presentation,
                duplicateTitleCount > 1 && playAllIndex >= 0
                  ? {
                      current: playAllIndex + 1,
                      total: playAllItems.length,
                    }
                  : undefined,
              )
            : null;
          return (
            <View
              accessible={false}
              key={item.sectionKey}
              style={[
                styles.item,
                {
                  backgroundColor: selected ? colors.accentBg : colors.surface2,
                  borderColor: selected ? colors.accentBorder : colors.border,
                  borderRadius: radii.xl,
                  gap: spacing.sm,
                  padding: spacing.md,
                },
              ]}
              testID={`article-audio-item-${item.sectionKey}`}
            >
              <GardenText
                color={selected ? "accent" : "foreground"}
                style={{ fontFamily: fonts.bodySemiBold }}
              >
                {item.title}
              </GardenText>
              {item.kind === "transition" ? (
                <GardenText color="muted" variant="metadata">
                  Chapter transition
                </GardenText>
              ) : null}
              {item.kind === "unavailable" ? (
                <GardenText color="muted" variant="metadata">
                  No source text
                </GardenText>
              ) : null}
              {control !== null ? (
                <GardenButton
                  accessibilityLabel={control.accessibleLabel}
                  disabled={
                    !active ||
                    !isForeground ||
                    (presentation.kind === "preparing" &&
                      presentation.selectedKey !== item.sectionKey)
                  }
                  label={control.label}
                  onPress={() => handleItem(item)}
                  testID={`article-audio-item-control-${item.sectionKey}`}
                  variant={selected ? "secondary" : "primary"}
                />
              ) : null}
            </View>
          );
        })}
      </View>
    </GardenCard>
  );
}

/**
 * Chooses the established lightweight summary player for summary-only
 * revisions and the fixed native queue whenever article sections are present.
 */
export function NativeArticleAudioPlayer(
  props: NativeArticleAudioPlayerProps,
): ReactElement {
  const items = buildNativeArticleAudioItems({
    sections: props.article.sections,
    summary: props.article.summary,
  });
  if (items.length === 0) return <></>;

  if ((props.article.sections?.length ?? 0) === 0 && items.length === 1) {
    return (
      <>
        <NativeArticleSummaryAudioPlayer
          active={props.active}
          articleTitle={props.article.title}
          ephemeralStore={props.ephemeralStore}
          loadRuntime={props.loadRuntime}
          narrationVersion={props.article.narrationVersion}
          revisionId={props.article.revisionId}
          slug={props.slug}
        />
        {props.summaryDisclosure}
      </>
    );
  }

  return <NativeArticlePlaylistAudioPlayer {...props} items={items} />;
}

const styles = StyleSheet.create({
  item: {
    borderWidth: 1,
  },
});
