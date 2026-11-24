"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { PlaybackRate } from "@/hooks/usePlaybackRate";
import {
  applyPlaybackRate,
  keepPlaybackRate,
} from "@/lib/media-playback-rate";

type UseAudioElementOptions = {
  url: string | null;
  onEnded?: () => void;
  onPlayingChange?: (playing: boolean) => void;
  playbackRate?: PlaybackRate;
};

export const useAudioElement = ({
  url,
  onEnded,
  onPlayingChange,
  playbackRate = 1,
}: UseAudioElementOptions) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlayingRaw] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const onEndedRef = useRef(onEnded);
  const onPlayingChangeRef = useRef(onPlayingChange);
  useEffect(() => {
    onEndedRef.current = onEnded;
    onPlayingChangeRef.current = onPlayingChange;
  });

  const setPlaying = useCallback((v: boolean) => {
    setPlayingRaw(v);
    onPlayingChangeRef.current?.(v);
  }, []);

  const [prevUrl, setPrevUrl] = useState(url);
  if (url !== prevUrl) {
    setPrevUrl(url);
    setCurrentTime(0);
    setDuration(0);
    setPlayingRaw(false);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // Media events are queued. Another player may have interrupted this one
    // between the original play request and delivery of its event.
    const onPlay = () => {
      if (!audio.paused) setPlaying(true);
    };
    const onPause = () => {
      if (audio.paused) setPlaying(false);
    };
    const onEndedEvt = () => {
      setPlaying(false);
      onEndedRef.current?.();
    };
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
  }, [url, setPlaying]);

  const playbackRateRef = useRef(playbackRate);
  useEffect(() => {
    playbackRateRef.current = playbackRate;
    const audio = audioRef.current;
    if (audio) applyPlaybackRate(audio, playbackRate);
  }, [playbackRate, url]);

  // A new source, play, or seek can reset the element's speed behind the
  // displayed value; put it back whenever that might have happened.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    return keepPlaybackRate(audio, () => playbackRateRef.current);
  }, [url]);

  const play = useCallback(() => {
    audioRef.current?.play()?.catch(() => {
      // Playback may be interrupted or blocked by the browser.
    });
  }, []);

  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      play();
    } else {
      audio.pause();
    }
  }, [play]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(
      0,
      Math.min(audio.duration || 0, audio.currentTime + seconds),
    );
  }, []);

  return { audioRef, playing, currentTime, duration, play, pause, toggle, seek, skip };
};
