"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AudioPlayer } from "@/components/AudioPlayer";
import { usePlaybackRate } from "@/hooks/usePlaybackRate";

type DidYouKnowAudioState = {
  feedDate: string;
  title: string;
  status: "missing" | "pending" | "ready" | "failed";
  audioUrl: string | null;
  durationSeconds?: number;
  lastError?: string;
};

const POLL_INTERVAL_MS = 5000;

export const DidYouKnowAudioPlayer = ({
  feedDateIso,
}: {
  feedDateIso: string;
}) => {
  const { rate, setRate } = usePlaybackRate();
  const [state, setState] = useState<DidYouKnowAudioState | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const route = useMemo(
    () => `/api/did-you-know/audio?feedDate=${encodeURIComponent(feedDateIso)}`,
    [feedDateIso],
  );

  const loadState = useCallback(async (): Promise<DidYouKnowAudioState> => {
    const response = await fetch(route, { cache: "no-store" });
    const data = (await response.json()) as DidYouKnowAudioState & {
      error?: string;
    };

    if (!response.ok) {
      throw new Error(data.error || "Failed to load Did You Know audio state");
    }

    return data;
  }, [route]);

  const requestSync = useCallback(async (): Promise<DidYouKnowAudioState> => {
    setSyncing(true);
    try {
      const response = await fetch(route, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feedDate: feedDateIso }),
      });
      const data = (await response.json()) as DidYouKnowAudioState & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate Did You Know audio");
      }

      setState(data);
      return data;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to generate Did You Know audio";
      const failedState: DidYouKnowAudioState = {
        feedDate: feedDateIso,
        title: state?.title || "Did You Know audio",
        status: "failed",
        audioUrl: null,
        lastError: message,
      };
      setState(failedState);
      throw error;
    } finally {
      setSyncing(false);
    }
  }, [feedDateIso, route, state?.title]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const current = await loadState();
        if (cancelled) return;
        setState(current);
        if (current.status === "missing") {
          const next = await requestSync();
          if (!cancelled) {
            setState(next);
          }
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            feedDate: feedDateIso,
            title: "Did You Know audio",
            status: "failed",
            audioUrl: null,
            lastError:
              error instanceof Error
                ? error.message
                : "Failed to initialize Did You Know audio",
          });
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [feedDateIso, loadState, requestSync]);

  useEffect(() => {
    if (state?.status !== "pending") return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void loadState()
        .then((next) => {
          if (!cancelled) {
            setState(next);
          }
        })
        .catch(() => {
          // Keep polling quiet; failure state is handled elsewhere.
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loadState, state?.status]);

  const title = state?.title || "Listen to today’s Did You Know list";

  if (loading && !state) {
    return (
      <section aria-label="Loading Did You Know audio" className="garden-bed p-6 mb-8">
        <div className="skeleton mb-3" style={{ width: "36%", height: "18px" }} />
        <div className="skeleton mb-2" style={{ width: "100%", height: "14px" }} />
        <div className="skeleton" style={{ width: "260px", height: "56px" }} />
      </section>
    );
  }

  if (state?.status === "ready" && state.audioUrl) {
    return (
      <section
        aria-labelledby="did-you-know-audio-heading"
        className="garden-bed p-6 mb-8"
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.18em] text-muted font-semibold mb-2">
              Daily audio
            </p>
            <h2
              id="did-you-know-audio-heading"
              className="font-display text-[1.35rem] font-semibold text-foreground leading-[1.2]"
            >
              Listen to today&apos;s Did You Know list
            </h2>
            <p className="text-sm text-muted mt-2 leading-[1.7]">
              Usually prepared ahead of time each day and cached in Convex so
              most visits can play immediately. If Wikipedia updates late, this
              page can still generate the audio as a fallback.
            </p>
          </div>

          <AudioPlayer
            audioUrl={state.audioUrl}
            title={title}
            label="Listen: today’s Did You Know list"
            playbackRate={rate}
            onPlaybackRateChange={setRate}
          />
        </div>
      </section>
    );
  }

  if (state?.status === "failed") {
    return (
      <section
        aria-labelledby="did-you-know-audio-error-heading"
        className="garden-bed p-6 mb-8"
      >
        <h2
          id="did-you-know-audio-error-heading"
          className="font-display text-[1.2rem] font-semibold text-foreground"
        >
          Audio unavailable right now
        </h2>
        <p className="text-sm text-foreground-2 leading-[1.75] mt-3">
          {state.lastError || "The Did You Know audio could not be generated."}
        </p>
        <button
          type="button"
          onClick={() => {
            void requestSync().catch(() => {});
          }}
          disabled={syncing}
          className="btn-secondary mt-4 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {syncing ? "Retrying..." : "Retry audio generation"}
        </button>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="did-you-know-audio-pending-heading"
      className="garden-bed p-6 mb-8"
    >
      <h2
        id="did-you-know-audio-pending-heading"
        className="font-display text-[1.2rem] font-semibold text-foreground"
      >
        Generating today&apos;s audio
      </h2>
      <p className="text-sm text-foreground-2 leading-[1.75] mt-3">
        Today&apos;s audio is usually prepared on a daily cron. If that run is
        still catching up, this page will generate and cache the file once as a
        fallback.
      </p>
      <div className="mt-4">
        <div className="skeleton mb-2" style={{ width: "100%", height: "14px" }} />
        <div className="skeleton" style={{ width: "260px", height: "56px" }} />
      </div>
    </section>
  );
};
