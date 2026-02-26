"use client";

import { useEffect, useRef, useCallback } from "react";

type UseMediaSessionOptions = {
  title: string | null;
  artist?: string;
  album?: string;
  artworkUrl?: string | null;
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  onPlay: () => void;
  onPause: () => void;
  onSeekForward: () => void;
  onSeekBackward: () => void;
  onSeekTo: (time: number) => void;
  onStop: () => void;
};

export const useMediaSession = ({
  title,
  artist = "Wikipedia",
  album = "World Garden",
  artworkUrl,
  playing,
  currentTime,
  duration,
  playbackRate,
  onPlay,
  onPause,
  onSeekForward,
  onSeekBackward,
  onSeekTo,
  onStop,
}: UseMediaSessionOptions) => {
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onSeekForwardRef = useRef(onSeekForward);
  const onSeekBackwardRef = useRef(onSeekBackward);
  const onSeekToRef = useRef(onSeekTo);
  const onStopRef = useRef(onStop);

  useEffect(() => {
    onPlayRef.current = onPlay;
    onPauseRef.current = onPause;
    onSeekForwardRef.current = onSeekForward;
    onSeekBackwardRef.current = onSeekBackward;
    onSeekToRef.current = onSeekTo;
    onStopRef.current = onStop;
  });

  const stablePlay = useCallback(() => onPlayRef.current(), []);
  const stablePause = useCallback(() => onPauseRef.current(), []);
  const stableSeekForward = useCallback(() => onSeekForwardRef.current(), []);
  const stableSeekBackward = useCallback(
    () => onSeekBackwardRef.current(),
    [],
  );
  const stableSeekTo = useCallback(
    (details: MediaSessionActionDetails) => {
      if (details.seekTime != null) onSeekToRef.current(details.seekTime);
    },
    [],
  );
  const stableStop = useCallback(() => onStopRef.current(), []);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    navigator.mediaSession.setActionHandler("play", stablePlay);
    navigator.mediaSession.setActionHandler("pause", stablePause);
    navigator.mediaSession.setActionHandler("seekforward", stableSeekForward);
    navigator.mediaSession.setActionHandler("seekbackward", stableSeekBackward);
    navigator.mediaSession.setActionHandler("seekto", stableSeekTo);
    navigator.mediaSession.setActionHandler("stop", stableStop);

    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("seekforward", null);
      navigator.mediaSession.setActionHandler("seekbackward", null);
      navigator.mediaSession.setActionHandler("seekto", null);
      navigator.mediaSession.setActionHandler("stop", null);
    };
  }, [
    stablePlay,
    stablePause,
    stableSeekForward,
    stableSeekBackward,
    stableSeekTo,
    stableStop,
  ]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !title) return;

    const artwork: MediaImage[] = artworkUrl
      ? [{ src: artworkUrl }]
      : [];

    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist,
      album,
      artwork,
    });
  }, [title, artist, album, artworkUrl]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    if (!title) {
      navigator.mediaSession.playbackState = "none";
    } else {
      navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    }
  }, [playing, title]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !duration || !isFinite(duration))
      return;

    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate,
        position: Math.min(currentTime, duration),
      });
    } catch {
      // Some browsers throw if position > duration during transitions
    }
  }, [currentTime, duration, playbackRate]);
};
