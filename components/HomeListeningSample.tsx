"use client";

import { useCallback, useRef, useState } from "react";
import { AudioPlayer } from "@/components/AudioPlayer";
import { usePlaybackRate } from "@/hooks/usePlaybackRate";
import { analytics } from "@/lib/analytics";

export const HOME_LISTENING_SAMPLE_URL =
  "/audio/curio-garden-listening-sample-edge-v1.mp3";

export const HOME_LISTENING_SAMPLE_DURATION_SECONDS = 18.408;

export const HOME_LISTENING_SAMPLE_TRANSCRIPT =
  "Welcome to Curio Garden. A Wikipedia article becomes a listening path: start with the summary, choose any section, or play the whole article in order. The page keeps its headings, links, and sources, so you can listen without losing the structure that makes curiosity useful.";

const PLAYBACK_ERROR_MESSAGE = "The listening sample could not start.";

export const HomeListeningSample = () => {
  const hasTrackedStart = useRef(false);
  const hasTrackedCompletion = useRef(false);
  const [playbackError, setPlaybackError] = useState("");
  const { rate, setRate } = usePlaybackRate();

  const handlePlaying = useCallback(() => {
    setPlaybackError("");
    if (hasTrackedStart.current) return;
    hasTrackedStart.current = true;
    analytics.listeningSampleStarted();
  }, []);

  const handleEnded = useCallback(() => {
    if (hasTrackedCompletion.current) return;
    hasTrackedCompletion.current = true;
    analytics.listeningSampleCompleted();
  }, []);

  const handlePlaybackFailure = useCallback(() => {
    setPlaybackError(PLAYBACK_ERROR_MESSAGE);
  }, []);

  return (
    <section
      aria-labelledby="listening-sample-heading"
      className="home-workbench-player garden-bed mt-6 overflow-hidden text-left"
    >
      <div className="px-4 pt-4 sm:px-5 sm:pt-5 lg:px-7 lg:pt-7">
        <div className="flex items-start gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-full border border-accent-border bg-accent-bg text-accent"
            aria-hidden="true"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              width={21}
              height={21}
            >
              <path d="M4 12h2" />
              <path d="M9 8v8" />
              <path d="M13 5v14" />
              <path d="M17 9v6" />
              <path d="M21 11v2" />
            </svg>
          </span>

          <div className="min-w-0">
            <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.14em] text-accent">
              Listening sample
            </p>
            <h2
              id="listening-sample-heading"
              className="mt-0.5 font-display text-[1.14rem] font-semibold leading-[1.25] text-foreground"
            >
              Start with a short listen
            </h2>
            <p className="mt-1 text-sm leading-[1.6] text-foreground-2">
              Hear how a Wikipedia page becomes a clear listening path.
            </p>
          </div>
        </div>

        <AudioPlayer
          audioUrl={HOME_LISTENING_SAMPLE_URL}
          title="Curio Garden listening sample"
          label="Listen: Curio Garden in 18 seconds"
          fallbackDuration={HOME_LISTENING_SAMPLE_DURATION_SECONDS}
          playbackRate={rate}
          onPlaybackRateChange={setRate}
          onPlaying={handlePlaying}
          onEnded={handleEnded}
          onPlaybackError={handlePlaybackFailure}
          showSyntheticSpeechLabel={false}
          showDownload={false}
          showLabel={false}
          variant="compact"
          className="mt-4 max-w-full"
        />

        {playbackError ? (
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="mt-3 rounded-lg border border-critical/40 bg-surface px-3 py-2 text-sm leading-[1.6] text-critical"
          >
            {playbackError} Try again, or read the transcript below.
          </p>
        ) : null}
      </div>

      <details className="group mt-1 px-4 pb-4 text-center text-sm text-foreground-2 sm:px-5 lg:px-7">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-2 font-semibold text-muted transition-colors duration-150 hover:text-accent">
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={16}
            height={16}
            aria-hidden="true"
            focusable="false"
            className="shrink-0 transition-transform duration-150 group-open:rotate-90"
          >
            <path d="m7 4 6 6-6 6" />
          </svg>
          Read transcript
        </summary>
        <p className="mt-1 rounded-xl border border-border bg-surface px-3 py-3 text-left leading-[1.7]">
          {HOME_LISTENING_SAMPLE_TRANSCRIPT}
        </p>
      </details>
    </section>
  );
};
