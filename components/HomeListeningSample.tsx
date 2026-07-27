"use client";

import { useCallback, useRef, useState } from "react";
import {
  InlineProgressBar,
  PauseIcon,
  PlayIcon,
  SpeedButton,
} from "@/components/AudioPlaybackPresentation";
import { useAudioElement } from "@/hooks/useAudioElement";
import {
  formatRate,
  PLAYBACK_RATES,
  usePlaybackRate,
} from "@/hooks/usePlaybackRate";
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
  const [hasPlayed, setHasPlayed] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [playbackError, setPlaybackError] = useState("");
  const [rateAnnouncement, setRateAnnouncement] = useState("");
  const { rate, setRate } = usePlaybackRate();

  const handlePlaying = useCallback(() => {
    setHasPlayed(true);
    setHasEnded(false);
    setPlaybackError("");
    if (hasTrackedStart.current) return;
    hasTrackedStart.current = true;
    analytics.listeningSampleStarted();
  }, []);

  const handleEnded = useCallback(() => {
    setHasEnded(true);
    if (hasTrackedCompletion.current) return;
    hasTrackedCompletion.current = true;
    analytics.listeningSampleCompleted();
  }, []);

  const { audioRef, playing, currentTime, duration, seek } = useAudioElement({
    url: HOME_LISTENING_SAMPLE_URL,
    onEnded: handleEnded,
    playbackRate: rate,
  });

  const effectiveDuration =
    duration > 0 ? duration : HOME_LISTENING_SAMPLE_DURATION_SECONDS;
  const playAction = playing
    ? "Pause"
    : hasEnded
      ? "Play sample again"
      : hasPlayed
        ? "Resume"
        : "Play";
  const playButtonLabel = playing
    ? "Pause listening sample"
    : hasEnded
      ? "Play sample again"
      : hasPlayed
        ? "Resume listening sample"
        : "Play listening sample";

  const handlePlaybackFailure = useCallback(() => {
    setPlaybackError(PLAYBACK_ERROR_MESSAGE);
  }, []);

  const handlePlayToggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (playing) {
      audio.pause();
      return;
    }

    if (hasEnded) seek(0);
    setPlaybackError("");

    try {
      const playResult = audio.play();
      if (playResult && typeof playResult.catch === "function") {
        void playResult.catch(handlePlaybackFailure);
      }
    } catch {
      handlePlaybackFailure();
    }
  }, [audioRef, handlePlaybackFailure, hasEnded, playing, seek]);

  const handleSeek = useCallback(
    (time: number) => {
      if (time < effectiveDuration) setHasEnded(false);
      seek(time);
    },
    [effectiveDuration, seek],
  );

  const handleSpeedChange = useCallback(() => {
    const currentIndex = PLAYBACK_RATES.indexOf(rate);
    const nextRate = PLAYBACK_RATES[(currentIndex + 1) % PLAYBACK_RATES.length];
    setRate(nextRate);
    setRateAnnouncement(`Playback speed ${formatRate(nextRate)}`);
  }, [rate, setRate]);

  return (
    <section
      aria-labelledby="listening-sample-heading"
      className="garden-bed mt-6 overflow-hidden text-left"
    >
      <div className="px-4 pt-4 sm:px-5 sm:pt-5">
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

        <div
          role="group"
          aria-label="Curio Garden listening sample player"
          className="mt-4 overflow-hidden rounded-xl border border-border bg-surface-2"
        >
          <div className="flex flex-wrap items-center gap-2 px-3 pb-2 pt-3">
            <button
              type="button"
              onClick={handlePlayToggle}
              aria-label={playButtonLabel}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-transparent bg-btn-primary px-3 py-2 font-semibold text-btn-primary-text transition-colors duration-150 hover:bg-btn-primary-hover"
            >
              {playing ? <PauseIcon /> : <PlayIcon />}
              <span>{playAction}</span>
            </button>

            <SpeedButton rate={rate} onClick={handleSpeedChange} />
          </div>

          <InlineProgressBar
            currentTime={currentTime}
            duration={effectiveDuration}
            onSeek={handleSeek}
          />

          {playbackError ? (
            <p
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className="mx-3 mb-3 rounded-lg border border-critical/40 bg-surface px-3 py-2 text-sm leading-[1.6] text-critical"
            >
              {playbackError} Try again, or{" "}
              <a
                href={HOME_LISTENING_SAMPLE_URL}
                download
                className="font-semibold text-accent underline underline-offset-2"
              >
                download sample audio
              </a>
              .
            </p>
          ) : null}

          <div
            className="sr-only"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {rateAnnouncement}
          </div>
        </div>

        <audio
          ref={audioRef}
          src={HOME_LISTENING_SAMPLE_URL}
          preload="metadata"
          hidden
          aria-hidden="true"
          onError={handlePlaybackFailure}
          onPlaying={handlePlaying}
        />

        <p className="mt-2 font-mono text-[0.6875rem] leading-[1.5] text-muted">
          Synthetic voice · 18 seconds
        </p>
      </div>

      <details className="mt-3 border-t border-border px-4 pb-3 text-sm text-foreground-2 sm:px-5">
        <summary className="flex min-h-11 cursor-pointer items-center rounded-lg py-2 font-semibold text-foreground transition-colors duration-150 hover:text-accent">
          Transcript
        </summary>
        <p className="pb-2 leading-[1.7]">{HOME_LISTENING_SAMPLE_TRANSCRIPT}</p>
      </details>
    </section>
  );
};
