"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import {
  PLAYBACK_RATES,
  type PlaybackRate,
  formatRate,
} from "@/hooks/usePlaybackRate";
import { useBrowserTtsVoice } from "@/hooks/useBrowserTtsVoice";

type BrowserTtsPlayerProps = {
  text: string;
  title: string;
  label?: string;
  autoFocus?: boolean;
  onEnded?: () => void;
  onPausedChange?: (paused: boolean) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  playbackRate?: PlaybackRate;
  onPlaybackRateChange?: (rate: PlaybackRate) => void;
};

/**
 * Chrome/Chromium silently kills SpeechSynthesis after ~15 s of
 * continuous speech. Chunking into sentence-sized pieces and queuing
 * them one at a time works around this reliably.
 */
const splitIntoChunks = (text: string, maxLen = 250): string[] => {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length > 0 ? chunks : [text];
};

export const BrowserTtsPlayer = ({
  text,
  title,
  label,
  autoFocus = false,
  onEnded,
  onPausedChange,
  onSpeakingChange,
  playbackRate = 1,
  onPlaybackRateChange,
}: BrowserTtsPlayerProps) => {
  const [speaking, setSpeakingRaw] = useState(false);
  const [paused, setPausedRaw] = useState(false);
  const onPausedChangeRef = useRef(onPausedChange);
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  const setPaused = useCallback((v: boolean) => {
    setPausedRaw(v);
    onPausedChangeRef.current?.(v);
  }, []);
  const setSpeaking = useCallback((v: boolean) => {
    setSpeakingRaw(v);
    onSpeakingChangeRef.current?.(v);
  }, []);
  const [supported] = useState(
    () => typeof window !== "undefined" && "speechSynthesis" in window,
  );
  const [rateAnnouncement, setRateAnnouncement] = useState("");
  const voiceRef = useBrowserTtsVoice();

  const playBtnRef = useRef<HTMLButtonElement>(null);
  const chunksRef = useRef<string[]>([]);
  const chunkIndexRef = useRef(0);
  const onEndedRef = useRef(onEnded);
  const rateRef = useRef(playbackRate);
  const speakingRef = useRef(false);
  const speakChunkRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    onPausedChangeRef.current = onPausedChange;
    onSpeakingChangeRef.current = onSpeakingChange;
    onEndedRef.current = onEnded;
    rateRef.current = playbackRate;
  });

  useEffect(() => {
    speakChunkRef.current = (index: number) => {
      const chunks = chunksRef.current;
      if (index >= chunks.length) {
        speakingRef.current = false;
        setSpeaking(false);
        setPaused(false);
        onEndedRef.current?.();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(chunks[index]);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.rate = rateRef.current;
      chunkIndexRef.current = index;

      utterance.onend = () => speakChunkRef.current(index + 1);
      utterance.onerror = (e) => {
        if (e.error === "canceled" || e.error === "interrupted") return;
        speakingRef.current = false;
        setSpeaking(false);
        setPaused(false);
      };

      window.speechSynthesis.speak(utterance);
    };
  });

  const startSpeaking = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    const chunks = splitIntoChunks(text);
    chunksRef.current = chunks;
    chunkIndexRef.current = 0;
    speakingRef.current = true;
    setSpeaking(true);
    setPaused(false);
    speakChunkRef.current(0);
  }, [text, supported, setSpeaking, setPaused]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      speakingRef.current = false;
    };
  }, []);

  const [prevText, setPrevText] = useState(text);
  if (text !== prevText) {
    setPrevText(text);
    setSpeakingRaw(false);
    setPausedRaw(false);
  }

  useEffect(() => {
    window.speechSynthesis?.cancel();
    speakingRef.current = false;

    if (autoFocus && supported) {
      playBtnRef.current?.focus({ preventScroll: true });
      const timer = setTimeout(() => startSpeaking(), 400);
      return () => clearTimeout(timer);
    }
  }, [text, autoFocus, startSpeaking, supported]);

  const togglePlay = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;

    if (speakingRef.current && !paused) {
      synth.pause();
      setPaused(true);
    } else if (speakingRef.current && paused) {
      synth.resume();
      setPaused(false);
    } else {
      startSpeaking();
    }
  }, [paused, startSpeaking, supported, setPaused]);

  const cycleSpeed = useCallback(() => {
    if (!onPlaybackRateChange) return;
    const idx = PLAYBACK_RATES.indexOf(playbackRate);
    const next = PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
    onPlaybackRateChange(next);
    setRateAnnouncement(`Playback speed ${formatRate(next)}`);

    if (speakingRef.current && supported) {
      window.speechSynthesis.cancel();
      rateRef.current = next;
      speakChunkRef.current(chunkIndexRef.current);
    }
  }, [playbackRate, onPlaybackRateChange, supported]);

  if (!supported) {
    return (
      <div
        className="alert-banner alert-error mt-2"
        role="alert"
      >
        <p className="text-sm">
          Your browser does not support text-to-speech.
        </p>
      </div>
    );
  }

  const isActive = speaking && !paused;
  const isIdle = !speaking && !paused;
  const displayLabel = isIdle
    ? title
    : (label ?? `Now playing: ${title}`);

  return (
    <div role="group" aria-label={`Audio player for ${title}`}>
      <div className="inline-flex items-center gap-3 bg-surface-3 border border-border rounded-full py-1.5 pr-1.5 pl-4">
        <p
          className="flex items-center gap-2 font-display font-semibold text-[0.8125rem] text-muted m-0 tracking-[0.01em] whitespace-nowrap overflow-hidden text-ellipsis min-w-0"
          aria-live="polite"
        >
          <span
            className={`${isActive ? "audio-pulse" : ""} w-[7px] h-[7px] rounded-full bg-accent shrink-0 transition-opacity duration-200`}
            style={{ opacity: isIdle ? 0.3 : 1 }}
            aria-hidden="true"
          />
          <span className="overflow-hidden text-ellipsis">
            {paused ? `Paused: ${title}` : displayLabel}
          </span>
        </p>

        {onPlaybackRateChange && (
          <button
            onClick={cycleSpeed}
            aria-label={`Playback speed ${formatRate(playbackRate)}. Click to change.`}
            className={`flex items-center justify-center py-[5px] px-2 bg-transparent border border-border rounded-lg cursor-pointer font-mono text-xs font-bold leading-none min-w-[40px] shrink-0 transition-colors duration-150 ${playbackRate !== 1 ? "text-accent" : "text-muted"}`}
          >
            {formatRate(playbackRate)}
          </button>
        )}

        <button
          ref={playBtnRef}
          onClick={togglePlay}
          aria-label={
            isActive
              ? `Pause: ${title}`
              : paused
                ? `Resume: ${title}`
                : `Play: ${title}`
          }
          className="search-submit flex items-center justify-center w-10 h-10 bg-accent text-white border-0 rounded-full cursor-pointer shrink-0 transition-all duration-150"
          style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.15)" }}
        >
          {isActive ? (
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width={16}
              height={16}
              aria-hidden="true"
            >
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              width={16}
              height={16}
              aria-hidden="true"
              className="ml-0.5"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          )}
        </button>
      </div>

      <div aria-live="assertive" className="sr-only" role="status">
        {rateAnnouncement}
      </div>
    </div>
  );
};
