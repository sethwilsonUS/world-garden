"use client";

import {
  useRef,
  useEffect,
  useEffectEvent,
  useState,
  useCallback,
} from "react";
import {
  PLAYBACK_RATES,
  type PlaybackRate,
  formatRate,
} from "@/hooks/usePlaybackRate";
import { formatTime } from "@/lib/formatTime";

type AudioPlayerProps = {
  audioUrl: string;
  title: string;
  label?: string;
  autoFocus?: boolean;
  onEnded?: () => void;
  playbackRate?: PlaybackRate;
  onPlaybackRateChange?: (rate: PlaybackRate) => void;
  variant?: "default" | "compact";
  className?: string;
  fallbackDuration?: number;
  onPlaying?: () => void;
  onPlaybackError?: () => void;
  showSyntheticSpeechLabel?: boolean;
  showDownload?: boolean;
  showLabel?: boolean;
};

export { formatTime } from "@/lib/formatTime";

export const AudioPlayer = ({
  audioUrl,
  title,
  label,
  autoFocus = false,
  onEnded,
  playbackRate = 1,
  onPlaybackRateChange,
  variant = "default",
  className = "",
  fallbackDuration = 0,
  onPlaying,
  onPlaybackError,
  showSyntheticSpeechLabel = true,
  showDownload = true,
  showLabel = true,
}: AudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playBtnRef = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rateAnnouncement, setRateAnnouncement] = useState("");
  const playbackRateRef = useRef(playbackRate);
  const handlePlaying = useEffectEvent(() => onPlaying?.());
  const handleEnded = useEffectEvent(() => onEnded?.());
  const handlePlaybackError = useEffectEvent(() => onPlaybackError?.());

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => {
      setPlaying(true);
      setEnded(false);
      setHasPlayed(true);
    };
    const onPlayingEvent = () => handlePlaying();
    const onPause = () => setPlaying(false);
    const onEndedEvt = () => {
      setPlaying(false);
      setEnded(true);
      handleEnded();
    };
    const onError = () => {
      setPlaying(false);
      handlePlaybackError();
    };
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onMeta = () => {
      if (isFinite(audio.duration)) setDuration(audio.duration);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("playing", onPlayingEvent);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEndedEvt);
    audio.addEventListener("error", onError);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("loadedmetadata", onMeta);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("playing", onPlayingEvent);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEndedEvt);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("loadedmetadata", onMeta);
    };
  }, [audioUrl]);

  const [prevAudioUrl, setPrevAudioUrl] = useState(audioUrl);
  if (audioUrl !== prevAudioUrl) {
    setPrevAudioUrl(audioUrl);
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
    setEnded(false);
    setHasPlayed(false);
  }

  useEffect(() => {
    if (!autoFocus) return;

    playBtnRef.current?.focus();

    const timer = setTimeout(() => {
      const audio = audioRef.current;
      if (!audio) return;
      try {
        const playResult = audio.play();
        if (playResult && typeof playResult.catch === "function") {
          void playResult.catch(() => handlePlaybackError());
        }
      } catch {
        handlePlaybackError();
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [autoFocus, audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    playbackRateRef.current = playbackRate;
    if (audio) audio.playbackRate = playbackRate;
  }, [playbackRate, audioUrl]);

  const cycleSpeed = useCallback(() => {
    if (!onPlaybackRateChange) return;
    const idx = PLAYBACK_RATES.indexOf(playbackRateRef.current);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    playbackRateRef.current = next;
    onPlaybackRateChange(next);
    setRateAnnouncement(`Playback speed ${formatRate(next)}`);
  }, [onPlaybackRateChange]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      return;
    }

    if (ended) {
      audio.currentTime = 0;
      setCurrentTime(0);
      setEnded(false);
    }

    try {
      const playResult = audio.play();
      if (playResult && typeof playResult.catch === "function") {
        void playResult.catch(() => onPlaybackError?.());
      }
    } catch {
      onPlaybackError?.();
    }
  }, [ended, onPlaybackError, playing]);

  const effectiveDuration =
    duration > 0 && Number.isFinite(duration)
      ? duration
      : Number.isFinite(fallbackDuration)
        ? Math.max(0, fallbackDuration)
        : 0;
  const normalizedCurrentTime = Number.isFinite(currentTime)
    ? Math.min(effectiveDuration, Math.max(0, currentTime))
    : 0;

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio) return;
      const requestedTime = parseFloat(e.target.value);
      const t = Number.isFinite(requestedTime)
        ? Math.min(effectiveDuration, Math.max(0, requestedTime))
        : 0;
      audio.currentTime = t;
      setCurrentTime(t);
      if (t < effectiveDuration) setEnded(false);
      if (t > 0) setHasPlayed(true);
    },
    [effectiveDuration],
  );

  const skip = useCallback(
    (s: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      const fromTime = Number.isFinite(audio.currentTime)
        ? audio.currentTime
        : 0;
      const nextTime = Math.max(0, Math.min(effectiveDuration, fromTime + s));
      audio.currentTime = nextTime;
      setCurrentTime(nextTime);
      if (nextTime < effectiveDuration) setEnded(false);
      if (nextTime > 0) setHasPlayed(true);
    },
    [effectiveDuration],
  );

  const displayLabel = label ?? `Now playing: ${title}`;
  const progress =
    effectiveDuration > 0
      ? (normalizedCurrentTime / effectiveDuration) * 100
      : 0;
  const compact = variant === "compact";

  return (
    <div
      role="group"
      aria-label={`Audio player for ${title}`}
      className={`min-w-0 w-full max-w-[480px] ${className}`}
    >
      {showLabel ? (
        <p
          className="mb-2 flex min-w-0 items-start gap-2 font-display text-[0.8125rem] font-semibold leading-relaxed tracking-[0.01em] text-muted"
          aria-live="polite"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              playing ? "audio-pulse bg-accent" : "bg-control-border"
            }`}
            aria-hidden="true"
          />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {displayLabel}
          </span>
        </p>
      ) : null}

      {/* Main player surface */}
      <div
        data-audio-player-surface=""
        className={`border border-border bg-surface-3 ${
          compact
            ? "rounded-xl px-[14px] py-[12px]"
            : "rounded-2xl px-[clamp(14px,4vw,20px)] py-[16px]"
        }`}
      >
        {/* Controls: skip-back, play/pause, skip-forward */}
        <div
          className={`mb-[14px] flex flex-wrap items-center justify-center ${
            compact ? "gap-[12px]" : "gap-[clamp(10px,3vw,20px)]"
          }`}
        >
          <button
            type="button"
            onClick={() => skip(-10)}
            aria-label="Skip back 10 seconds"
            className="flex min-h-[44px] min-w-[44px] cursor-pointer flex-col items-center justify-center gap-px rounded-[10px] border-0 bg-transparent p-[8px] font-mono text-[0.5625rem] font-bold leading-none text-foreground-2 transition-colors duration-150 hover:bg-accent-bg hover:text-accent"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={18}
              height={18}
              aria-hidden="true"
            >
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            <span>10</span>
          </button>

          <button
            type="button"
            ref={playBtnRef}
            onClick={togglePlay}
            aria-label={
              playing
                ? `Pause: ${title}`
                : ended
                  ? `Replay: ${title}`
                  : hasPlayed
                    ? `Resume: ${title}`
                    : `Play: ${title}`
            }
            className={`search-submit flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-btn-primary text-btn-primary-text transition-all duration-150 hover:bg-btn-primary-hover ${
              compact ? "h-[44px] w-[44px]" : "h-[52px] w-[52px]"
            }`}
            style={{
              boxShadow:
                "0 4px 14px rgba(0,0,0,0.2), 0 0 0 4px var(--color-accent-glow)",
            }}
          >
            {playing ? (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width={22}
                height={22}
                aria-hidden="true"
              >
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width={22}
                height={22}
                aria-hidden="true"
                className="ml-0.5"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>

          <button
            type="button"
            onClick={() => skip(10)}
            aria-label="Skip forward 10 seconds"
            className="flex min-h-[44px] min-w-[44px] cursor-pointer flex-col items-center justify-center gap-px rounded-[10px] border-0 bg-transparent p-[8px] font-mono text-[0.5625rem] font-bold leading-none text-foreground-2 transition-colors duration-150 hover:bg-accent-bg hover:text-accent"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={18}
              height={18}
              aria-hidden="true"
            >
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            <span>10</span>
          </button>

          {onPlaybackRateChange && (
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label={`Playback speed ${formatRate(playbackRate)}. Activate to change.`}
              className={`flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-lg border border-border bg-transparent px-[10px] py-[6px] font-mono text-[0.8125rem] font-bold leading-none transition-colors duration-150 hover:bg-accent-bg hover:text-accent ${playbackRate !== 1 ? "text-accent" : "text-muted"}`}
            >
              {formatRate(playbackRate)}
            </button>
          )}
        </div>

        <div aria-live="assertive" className="sr-only" role="status">
          {rateAnnouncement}
        </div>

        {/* Progress: time — scrubber — time */}
        <div
          className={`grid min-w-0 grid-cols-2 items-center ${
            compact ? "gap-x-[10px]" : "gap-x-[14px]"
          }`}
        >
          <div className="col-span-2 min-w-0">
            <input
              type="range"
              min={0}
              max={effectiveDuration}
              step={0.1}
              value={normalizedCurrentTime}
              onChange={handleSeek}
              aria-label="Playback position"
              aria-valuemin={0}
              aria-valuemax={effectiveDuration}
              aria-valuenow={normalizedCurrentTime}
              aria-valuetext={`${formatTime(normalizedCurrentTime)} of ${formatTime(effectiveDuration)}`}
              className="article-audio-progress-range block min-h-[44px] w-full"
              style={
                {
                  "--progress": `${progress}%`,
                } as React.CSSProperties
              }
            />
          </div>

          <span
            className="min-w-0 select-none font-mono text-xs font-medium text-muted tabular-nums"
            aria-hidden="true"
          >
            {formatTime(normalizedCurrentTime)}
          </span>
          <span
            className="min-w-0 select-none text-right font-mono text-xs font-medium text-muted tabular-nums"
            aria-hidden="true"
          >
            {effectiveDuration > 0 ? formatTime(effectiveDuration) : "--:--"}
          </span>
        </div>
      </div>

      {showSyntheticSpeechLabel ? (
        <p className="mt-2 text-center text-[0.6875rem] leading-normal text-muted">
          Synthetic speech audio.
        </p>
      ) : null}

      {showDownload ? (
        <div className="mt-2 text-center">
          <a
            href={audioUrl}
            download
            aria-label={`Download audio for ${title}`}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-[14px] py-[6px] text-xs text-muted no-underline"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={13}
              height={13}
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Download
          </a>
        </div>
      ) : null}

      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        hidden
        aria-hidden="true"
      />
    </div>
  );
};
