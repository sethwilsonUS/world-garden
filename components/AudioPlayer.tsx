"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import {
  PLAYBACK_RATES,
  type PlaybackRate,
  formatRate,
} from "@/hooks/usePlaybackRate";

type AudioPlayerProps = {
  audioUrl: string;
  title: string;
  label?: string;
  autoFocus?: boolean;
  onEnded?: () => void;
  playbackRate?: PlaybackRate;
  onPlaybackRateChange?: (rate: PlaybackRate) => void;
};

export const formatTime = (seconds: number): string => {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const AudioPlayer = ({
  audioUrl,
  title,
  label,
  autoFocus = false,
  onEnded,
  playbackRate = 1,
  onPlaybackRateChange,
}: AudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playBtnRef = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rateAnnouncement, setRateAnnouncement] = useState("");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEndedEvt = () => setPlaying(false);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onMeta = () => {
      if (isFinite(audio.duration)) setDuration(audio.duration);
    };
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEndedEvt);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("loadedmetadata", onMeta);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEndedEvt);
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
  }

  useEffect(() => {
    if (!autoFocus) return;

    playBtnRef.current?.focus();

    const timer = setTimeout(() => {
      const audio = audioRef.current;
      if (!audio) return;
      const p = audio.play();
      if (p && typeof p.catch === "function") {
        p.then(() => setPlaying(true)).catch(() => {});
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [autoFocus, audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = playbackRate;
  }, [playbackRate, audioUrl]);

  const cycleSpeed = useCallback(() => {
    if (!onPlaybackRateChange) return;
    const idx = PLAYBACK_RATES.indexOf(playbackRate);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    onPlaybackRateChange(next);
    setRateAnnouncement(`Playback speed ${formatRate(next)}`);
  }, [playbackRate, onPlaybackRateChange]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play();
    else audio.pause();
  }, []);

  const handleSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const audio = audioRef.current;
      if (!audio) return;
      const t = parseFloat(e.target.value);
      audio.currentTime = t;
      setCurrentTime(t);
    },
    [],
  );

  const skip = useCallback((s: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration || 0, audio.currentTime + s),
    );
  }, []);

  const displayLabel = label ?? `Now playing: ${title}`;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div role="group" aria-label={`Audio player for ${title}`}>
      {/* Now playing label */}
      <p
        className="flex items-center gap-2 font-display font-semibold text-[0.8125rem] text-muted m-0 mb-2 tracking-[0.01em]"
        aria-live="polite"
      >
        <span
          className="audio-pulse shrink-0 w-2 h-2 rounded-full bg-accent"
          aria-hidden="true"
        />
        {displayLabel}
      </p>

      {/* Main player surface */}
      <div className="bg-surface-3 border border-border rounded-2xl px-5 py-4">
        {/* Controls: skip-back, play/pause, skip-forward */}
        <div className="flex items-center justify-center gap-5 mb-3.5">
          <button
            onClick={() => skip(-10)}
            aria-label="Skip back 10 seconds"
            className="flex flex-col items-center gap-[1px] p-2 bg-transparent border-0 rounded-[10px] cursor-pointer text-muted font-mono text-[0.5625rem] font-bold leading-none"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
              <path d="M1 4v6h6" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            <span>10</span>
          </button>

          <button
            ref={playBtnRef}
            onClick={togglePlay}
            aria-label={playing ? `Pause: ${title}` : `Play: ${title}`}
            className="search-submit flex items-center justify-center w-[52px] h-[52px] bg-accent text-white border-0 rounded-full cursor-pointer shrink-0 transition-all duration-150"
            style={{
              boxShadow:
                "0 4px 14px rgba(0,0,0,0.2), 0 0 0 4px var(--accent-glow)",
            }}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" fill="currentColor" width={22} height={22} aria-hidden="true">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" width={22} height={22} aria-hidden="true" className="ml-0.5">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
            )}
          </button>

          <button
            onClick={() => skip(10)}
            aria-label="Skip forward 10 seconds"
            className="flex flex-col items-center gap-[1px] p-2 bg-transparent border-0 rounded-[10px] cursor-pointer text-muted font-mono text-[0.5625rem] font-bold leading-none"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
              <path d="M23 4v6h-6" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            <span>10</span>
          </button>

          {onPlaybackRateChange && (
            <button
              onClick={cycleSpeed}
              aria-label={`Playback speed ${formatRate(playbackRate)}. Click to change.`}
              className={`flex items-center justify-center py-1.5 px-[10px] bg-transparent border border-border rounded-lg cursor-pointer font-mono text-[0.8125rem] font-bold leading-none min-w-[44px] transition-colors duration-150 ${playbackRate !== 1 ? "text-accent" : "text-muted"}`}
            >
              {formatRate(playbackRate)}
            </button>
          )}
        </div>

        <div aria-live="assertive" className="sr-only" role="status">
          {rateAnnouncement}
        </div>

        {/* Progress: time — scrubber — time */}
        <div className="flex items-center gap-3.5">
          <span
            className="font-mono text-xs font-medium text-muted min-w-[38px] select-none"
            aria-hidden="true"
          >
            {formatTime(currentTime)}
          </span>

          <div className="flex-1 min-w-0">
            <style>{`
              input[data-player-range] {
                -webkit-appearance: none !important;
                appearance: none !important;
                width: 100% !important;
                height: 8px !important;
                border-radius: 4px !important;
                background: linear-gradient(
                  to right,
                  var(--accent) 0%,
                  var(--accent) var(--progress, 0%),
                  rgba(255,255,255,0.1) var(--progress, 0%),
                  rgba(255,255,255,0.1) 100%
                ) !important;
                cursor: pointer !important;
                outline: none !important;
                border: none !important;
                margin: 0 !important;
                padding: 0 !important;
              }
              input[data-player-range]:focus-visible {
                outline: 2px solid var(--accent) !important;
                outline-offset: 4px !important;
              }
              input[data-player-range]::-webkit-slider-thumb {
                -webkit-appearance: none !important;
                appearance: none !important;
                width: 18px !important;
                height: 18px !important;
                border-radius: 50% !important;
                background: #fff !important;
                border: none !important;
                box-shadow: 0 1px 6px rgba(0,0,0,0.35) !important;
                cursor: pointer !important;
              }
              input[data-player-range]::-moz-range-thumb {
                width: 18px !important;
                height: 18px !important;
                border-radius: 50% !important;
                background: #fff !important;
                border: none !important;
                box-shadow: 0 1px 6px rgba(0,0,0,0.35) !important;
                cursor: pointer !important;
              }
              input[data-player-range]::-moz-range-track {
                height: 8px !important;
                border-radius: 4px !important;
                background: rgba(255,255,255,0.1) !important;
              }
              input[data-player-range]::-moz-range-progress {
                height: 8px !important;
                border-radius: 4px !important;
                background: var(--accent) !important;
              }
            `}</style>
            <input
              type="range"
              data-player-range=""
              min={0}
              max={duration || 0}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              aria-label={`Playback position. ${formatTime(currentTime)} of ${formatTime(duration)}`}
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={currentTime}
              aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
              className="block w-full"
              style={
                {
                  "--progress": `${progress}%`,
                } as React.CSSProperties
              }
            />
          </div>

          <span
            className="font-mono text-xs font-medium text-muted min-w-[38px] text-right select-none"
            aria-hidden="true"
          >
            {duration > 0 ? formatTime(duration) : "--:--"}
          </span>
        </div>
      </div>

      {/* Download */}
      <div className="text-center mt-2">
        <a
          href={audioUrl}
          download
          aria-label={`Download audio for ${title}`}
          className="inline-flex items-center gap-1.5 py-1.5 px-[14px] text-xs text-muted no-underline rounded-lg"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={13} height={13} aria-hidden="true">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download
        </a>
      </div>

      <audio ref={audioRef} src={audioUrl} onEnded={onEnded} preload="metadata" aria-label={`Audio for ${title}`} />
    </div>
  );
};
