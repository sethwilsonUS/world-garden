"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { PlaybackRate } from "@/hooks/usePlaybackRate";
import { useBrowserTtsVoice } from "@/hooks/useBrowserTtsVoice";

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

type UseBrowserTtsOptions = {
  onEnded?: () => void;
  onPausedChange?: (paused: boolean) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  playbackRate?: PlaybackRate;
};

export const useBrowserTts = ({
  onEnded,
  onPausedChange,
  onSpeakingChange,
  playbackRate = 1,
}: UseBrowserTtsOptions) => {
  const [speaking, setSpeakingRaw] = useState(false);
  const [paused, setPausedRaw] = useState(false);

  const onPausedChangeRef = useRef(onPausedChange);
  const onSpeakingChangeRef = useRef(onSpeakingChange);
  const onEndedRef = useRef(onEnded);
  const rateRef = useRef(playbackRate);

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

  const voiceRef = useBrowserTtsVoice();
  const chunksRef = useRef<string[]>([]);
  const chunkIndexRef = useRef(0);
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

  const speak = useCallback(
    (text: string) => {
      if (!supported) return;
      window.speechSynthesis.cancel();
      const chunks = splitIntoChunks(text);
      chunksRef.current = chunks;
      chunkIndexRef.current = 0;
      speakingRef.current = true;
      setSpeaking(true);
      setPaused(false);
      speakChunkRef.current(0);
    },
    [supported, setSpeaking, setPaused],
  );

  const toggle = useCallback(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;

    if (speakingRef.current && !paused) {
      synth.pause();
      setPaused(true);
    } else if (speakingRef.current && paused) {
      synth.resume();
      setPaused(false);
    }
  }, [paused, supported, setPaused]);

  const cancel = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    speakingRef.current = false;
    setSpeaking(false);
    setPaused(false);
  }, [supported, setSpeaking, setPaused]);

  const restartAtCurrentChunk = useCallback(() => {
    if (!supported || !speakingRef.current) return;
    window.speechSynthesis.cancel();
    speakChunkRef.current(chunkIndexRef.current);
  }, [supported]);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      speakingRef.current = false;
    };
  }, []);

  return { speak, toggle, cancel, restartAtCurrentChunk, speaking, paused, supported };
};
