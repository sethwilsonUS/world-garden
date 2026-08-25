import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { AppState, type AppStateStatus } from "react-native";

import { AccessibleStatus } from "../components/AccessibleStatus";
import { GardenButton } from "../components/GardenButton";
import { GardenCard } from "../components/GardenCard";
import { GardenText } from "../theme/GardenText";
import { useGardenTheme } from "../theme/useGardenTheme";
import {
  type BackgroundAudioPlaybackStatus,
  type BackgroundAudioPlayer,
  type BackgroundAudioRuntime,
  loadExpoBackgroundAudioRuntime,
} from "./ExpoBackgroundAudioRuntime";
import { useNativeArticleAudioAccess } from "./NativeArticleAudioAccessContext";
import {
  defaultNativeArticleAudioEphemeralStore,
  type NativeArticleAudioEphemeralLease,
  type NativeArticleAudioEphemeralStore,
} from "./NativeArticleAudioEphemeralStore";
import type { NativePlaybackRate } from "./NativePlaybackRate";
import { useNativePlaybackRate } from "./NativePlaybackRateContext";
import { NativePlaybackSpeedControl } from "./NativePlaybackSpeedControl";

export const NATIVE_ARTICLE_AUDIO_OPERATION_TIMEOUT_MS = 240_000;

const OPERATION_ABORTED = Symbol("native-article-audio-operation-aborted");

type PlayerKind =
  | "idle"
  | "preparing"
  | "playing"
  | "paused"
  | "finished"
  | "failure";

type PlayerPresentation = Readonly<{
  currentTime: number;
  duration: number;
  kind: PlayerKind;
  message: string;
}>;

type ActiveOperation = {
  appliedPlaybackRate: NativePlaybackRate | null;
  cancelReason: "none" | "user" | "lifecycle" | "timeout" | "failure";
  controller: AbortController;
  lease: NativeArticleAudioEphemeralLease | null;
  playbackStarted: boolean;
  player: BackgroundAudioPlayer | null;
  responseRelease: (() => void) | null;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

export interface NativeArticleSummaryAudioPlayerProps {
  readonly active: boolean;
  readonly articleTitle: string;
  readonly ephemeralStore?: NativeArticleAudioEphemeralStore;
  readonly loadRuntime?: () => Promise<BackgroundAudioRuntime>;
  readonly narrationVersion: number;
  readonly revisionId: string;
  readonly slug: string;
}

const initialPresentation: PlayerPresentation = {
  currentTime: 0,
  duration: 0,
  kind: "idle",
  message: "Summary audio is ready when you are.",
};

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

function clearOperationTimeout(operation: ActiveOperation): void {
  if (operation.timeoutId === null) return;
  clearTimeout(operation.timeoutId);
  operation.timeoutId = null;
}

async function disposeOperation(operation: ActiveOperation): Promise<void> {
  clearOperationTimeout(operation);
  operation.controller.abort();
  releaseResponse(operation);
  if (operation.player !== null) {
    const player = operation.player;
    operation.player = null;
    await safeAwait(player.release());
  }
  if (operation.lease !== null) {
    const lease = operation.lease;
    operation.lease = null;
    await safeAwait(lease.release());
  }
}

function trackDisposal(operation: ActiveOperation): Promise<void> {
  return disposeOperation(operation);
}

function normalizeTime(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
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
    return "Audio duration is available after audio loads.";
  }
  return `Elapsed time ${formatAccessibleTime(presentation.currentTime)}. Total duration ${formatAccessibleTime(presentation.duration)}.`;
}

function controlLabel(kind: PlayerKind): string {
  switch (kind) {
    case "preparing":
      return "Cancel preparing summary audio";
    case "playing":
      return "Pause full summary audio";
    case "paused":
      return "Resume full summary audio";
    case "finished":
      return "Replay full summary audio";
    case "failure":
      return "Try summary audio again";
    case "idle":
      return "Play full summary audio";
  }
}

export function NativeArticleSummaryAudioPlayer({
  active,
  articleTitle,
  ephemeralStore,
  loadRuntime = loadExpoBackgroundAudioRuntime,
  narrationVersion,
  revisionId,
  slug,
}: NativeArticleSummaryAudioPlayerProps): ReactElement {
  const access = useNativeArticleAudioAccess();
  const { rate: playbackRate, setRate: setPlaybackRate } =
    useNativePlaybackRate();
  const { colors } = useGardenTheme();
  const store = ephemeralStore ?? defaultNativeArticleAudioEphemeralStore;
  const mounted = useRef(true);
  const initiallyForeground = AppState.currentState === "active";
  const foreground = useRef(initiallyForeground);
  const operation = useRef<ActiveOperation | null>(null);
  const currentAccountEpoch = useRef(access.accountEpoch);
  const [isForeground, setIsForeground] = useState(initiallyForeground);
  const [presentation, setPresentation] =
    useState<PlayerPresentation>(initialPresentation);
  const presentationRef = useRef(presentation);
  const playbackRateRef = useRef(playbackRate);

  useLayoutEffect(() => {
    currentAccountEpoch.current = access.accountEpoch;
  }, [access.accountEpoch]);

  const updatePresentation = useCallback((next: PlayerPresentation) => {
    presentationRef.current = next;
    if (mounted.current) setPresentation(next);
  }, []);

  const failOperation = useCallback(
    (target: ActiveOperation) => {
      if (operation.current !== target) return;
      operation.current = null;
      target.cancelReason = "failure";
      updatePresentation({
        currentTime: 0,
        duration: 0,
        kind: "failure",
        message: "Could not play the summary audio. Please try again.",
      });
      void trackDisposal(target);
    },
    [updatePresentation],
  );

  const applyPlaybackRate = useCallback(
    (target: ActiveOperation, nextRate: NativePlaybackRate): boolean => {
      if (target.player === null || target.appliedPlaybackRate === nextRate) {
        return true;
      }

      try {
        target.player.setPlaybackRate(nextRate);
        target.appliedPlaybackRate = nextRate;
        return true;
      } catch (_error: unknown) {
        void _error;
        failOperation(target);
        return false;
      }
    },
    [failOperation],
  );

  useLayoutEffect(() => {
    playbackRateRef.current = playbackRate;
    const target = operation.current;
    if (target !== null) applyPlaybackRate(target, playbackRate);
  }, [applyPlaybackRate, playbackRate]);

  const stopCurrent = useCallback(
    (message: string, announce: boolean) => {
      const target = operation.current;
      const hadOperation = target !== null;
      if (target !== null) {
        operation.current = null;
        target.cancelReason = "lifecycle";
        void trackDisposal(target);
      }
      if (announce && hadOperation) {
        updatePresentation({
          currentTime: 0,
          duration: 0,
          kind: "idle",
          message,
        });
      }
    },
    [updatePresentation],
  );

  const handlePlaybackStatus = useCallback(
    (target: ActiveOperation, status: BackgroundAudioPlaybackStatus) => {
      if (operation.current !== target || target.controller.signal.aborted) {
        return;
      }
      if (status.error !== null) {
        failOperation(target);
        return;
      }

      const currentTime = normalizeTime(status.currentTime);
      const duration = normalizeTime(status.duration);
      const finished =
        status.didJustFinish ||
        (status.isLoaded &&
          !status.isBuffering &&
          !status.playing &&
          duration > 0 &&
          currentTime >= duration - 0.25);
      if (finished) {
        updatePresentation({
          currentTime,
          duration,
          kind: "finished",
          message: "The full summary finished playing.",
        });
      } else if (status.playing) {
        const current = presentationRef.current;
        updatePresentation({
          currentTime,
          duration,
          kind: "playing",
          message:
            current.kind === "playing"
              ? current.message
              : "Playing the full summary.",
        });
      } else if (
        status.isLoaded &&
        !status.isBuffering &&
        presentationRef.current.kind === "playing"
      ) {
        updatePresentation({
          currentTime,
          duration,
          kind: "paused",
          message: "The full summary is paused.",
        });
      } else {
        const current = presentationRef.current;
        updatePresentation({ ...current, currentTime, duration });
      }
    },
    [failOperation, updatePresentation],
  );

  const beginPlayback = async () => {
    if (!active || !foreground.current || operation.current !== null) {
      return;
    }

    const controller = new AbortController();
    const target: ActiveOperation = {
      appliedPlaybackRate: null,
      cancelReason: "none",
      controller,
      lease: null,
      playbackStarted: false,
      player: null,
      responseRelease: null,
      timeoutId: null,
    };
    target.timeoutId = setTimeout(() => {
      if (operation.current !== target) return;
      target.cancelReason = "timeout";
      operation.current = null;
      updatePresentation({
        currentTime: 0,
        duration: 0,
        kind: "failure",
        message: "Summary audio took too long to prepare. Please try again.",
      });
      void trackDisposal(target);
    }, NATIVE_ARTICLE_AUDIO_OPERATION_TIMEOUT_MS);
    operation.current = target;
    const startingEpoch = access.accountEpoch;
    updatePresentation({
      currentTime: 0,
      duration: 0,
      kind: "preparing",
      message: "Preparing the full summary audio.",
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

      const requestPromise = access.requestSection({
        narrationVersion,
        provider: "openai",
        revisionId,
        sectionKey: "summary",
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
        (_error: unknown) => {
          void _error;
        },
      );
      const requestResult = await raceWithAbort(
        requestPromise,
        controller.signal,
      );
      if (requestResult === OPERATION_ABORTED || operation.current !== target) {
        return;
      }
      if (requestResult.status !== "ready") {
        failOperation(target);
        return;
      }
      target.responseRelease = requestResult.release;
      if (
        requestResult.accountEpoch !== startingEpoch ||
        currentAccountEpoch.current !== startingEpoch
      ) {
        failOperation(target);
        return;
      }

      const stagePromise = store.stage(
        requestResult.response,
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
        (_error: unknown) => {
          void _error;
        },
      );
      const staged = await raceWithAbort(stagePromise, controller.signal);
      if (staged === OPERATION_ABORTED || operation.current !== target) return;
      releaseResponse(target);
      if (staged.status !== "ready") {
        if (staged.status === "cancelled" && controller.signal.aborted) return;
        failOperation(target);
        return;
      }
      if (currentAccountEpoch.current !== startingEpoch) {
        await safeAwait(staged.lease.release());
        failOperation(target);
        return;
      }
      target.lease = staged.lease;

      const runtimePromise = loadRuntime();
      const runtime = await raceWithAbort(runtimePromise, controller.signal);
      if (runtime === OPERATION_ABORTED || operation.current !== target) return;
      const configuration = runtime.configureBackgroundMode();
      const configured = await raceWithAbort(configuration, controller.signal);
      if (
        configured === OPERATION_ABORTED ||
        operation.current !== target ||
        currentAccountEpoch.current !== startingEpoch
      ) {
        return;
      }

      const player = runtime.createPlayer(
        {
          metadata: {
            albumTitle: "Curio Garden",
            artist: "Wikipedia",
            title: `Summary — ${articleTitle}`,
          },
          uri: staged.lease.uri,
        },
        (status) => handlePlaybackStatus(target, status),
      );
      if (operation.current !== target || controller.signal.aborted) {
        await safeAwait(player.release());
        return;
      }
      target.player = player;
      if (!applyPlaybackRate(target, playbackRateRef.current)) return;
      const started = await raceWithAbort(player.play(), controller.signal);
      if (
        started === OPERATION_ABORTED ||
        operation.current !== target ||
        currentAccountEpoch.current !== startingEpoch
      ) {
        return;
      }
      target.playbackStarted = true;
      clearOperationTimeout(target);
      updatePresentation({
        currentTime: 0,
        duration: 0,
        kind: "playing",
        message: "Playing the full summary.",
      });
    } catch (_error: unknown) {
      void _error;
      if (operation.current === target && !controller.signal.aborted) {
        failOperation(target);
      }
    }
  };

  const handlePlaybackRateChange = useCallback(
    (nextRate: NativePlaybackRate): boolean => {
      const target = operation.current;
      if (target !== null && !applyPlaybackRate(target, nextRate)) return false;

      playbackRateRef.current = nextRate;
      setPlaybackRate(nextRate);
      return true;
    },
    [applyPlaybackRate, setPlaybackRate],
  );

  const handleControlPress = () => {
    const target = operation.current;
    switch (presentation.kind) {
      case "idle":
      case "failure":
        void beginPlayback();
        return;
      case "preparing":
        if (target !== null) {
          operation.current = null;
          target.cancelReason = "user";
          void trackDisposal(target);
        }
        updatePresentation({
          currentTime: 0,
          duration: 0,
          kind: "idle",
          message: "Summary audio preparation cancelled.",
        });
        return;
      case "playing":
        if (target?.player === null || target === null) return;
        try {
          target.player.pause();
          updatePresentation({
            ...presentation,
            kind: "paused",
            message: "The full summary is paused.",
          });
        } catch (_error: unknown) {
          void _error;
          failOperation(target);
        }
        return;
      case "paused":
        if (target?.player === null || target === null) return;
        void target.player
          .play()
          .then(() => {
            if (
              operation.current === target &&
              !target.controller.signal.aborted
            ) {
              updatePresentation({
                ...presentationRef.current,
                kind: "playing",
                message: "Playing the full summary.",
              });
            }
          })
          .catch((_error: unknown) => {
            void _error;
            failOperation(target);
          });
        return;
      case "finished":
        if (target?.player === null || target === null) return;
        void target.player
          .seekTo(0)
          .then(async () => {
            if (
              operation.current !== target ||
              target.controller.signal.aborted ||
              target.player === null
            ) {
              return;
            }
            await target.player.play();
            if (
              operation.current === target &&
              !target.controller.signal.aborted
            ) {
              updatePresentation({
                ...presentationRef.current,
                currentTime: 0,
                kind: "playing",
                message: "Playing the full summary from the beginning.",
              });
            }
          })
          .catch((_error: unknown) => {
            void _error;
            failOperation(target);
          });
        return;
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const target = operation.current;
      operation.current = null;
      if (target !== null) {
        target.cancelReason = "lifecycle";
        void trackDisposal(target);
      }
    };
  }, []);

  useLayoutEffect(() => {
    updatePresentation(initialPresentation);
    if (!active) stopCurrent(initialPresentation.message, false);
    return () => stopCurrent(initialPresentation.message, false);
  }, [
    access.accountEpoch,
    active,
    narrationVersion,
    revisionId,
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
          target !== null &&
          target.player !== null &&
          target.playbackStarted
        ) {
          try {
            handlePlaybackStatus(target, target.player.getStatus());
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
          "Summary audio preparation cancelled when the app left the foreground.",
          true,
        );
      }
    };
    const subscription = AppState.addEventListener("change", reconcileAppState);
    // currentState can be null during launch, and the first transition can
    // occur before this passive effect subscribes. Subscribe first, then read
    // the authoritative state so that missed foreground/background events are
    // reconciled without waiting for a second transition.
    reconcileAppState(AppState.currentState);
    return () => subscription.remove();
  }, [failOperation, handlePlaybackStatus, stopCurrent]);

  return (
    <GardenCard
      style={{
        backgroundColor: colors.surface3,
        borderColor: colors.controlBorder,
        borderWidth: 2,
      }}
      testID="article-summary-audio-player"
    >
      <GardenText accessibilityRole="header" variant="cardTitle">
        Listen to the full summary
      </GardenText>
      <GardenButton
        disabled={!active || !isForeground}
        hint={`Continues in the background and provides lock-screen controls for ${articleTitle}.`}
        label={controlLabel(presentation.kind)}
        onPress={handleControlPress}
        testID="summary-audio-control"
      />
      <NativePlaybackSpeedControl
        disabled={!active || !isForeground}
        onChange={handlePlaybackRateChange}
        rate={playbackRate}
        testID="summary-audio-speed"
      />
      <GardenText
        accessibilityLabel={timeAccessibilityLabel(presentation)}
        color="muted"
        testID="summary-audio-time"
        variant="metadata"
      >
        {presentation.duration > 0
          ? `${formatTime(presentation.currentTime)} of ${formatTime(presentation.duration)}`
          : "Duration available after audio loads."}
      </GardenText>
      <GardenText
        color="muted"
        testID="summary-audio-disclosure"
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
        testID="summary-audio-status"
      />
    </GardenCard>
  );
}
