"use client";

import { useEffect, useRef } from "react";

const PREFERRED_PATTERNS = [
  /\bsamantha\b/i,
  /\bkaren\b/i,
  /\bdaniel\b/i,
  /\bgoogle\b.*\b(us|uk)\b/i,
  /\bgoogle\b/i,
  /\bnatural\b/i,
  /\benhanced\b/i,
  /\bpremium\b/i,
  /\bneural\b/i,
];

const pickBestVoice = (
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined => {
  const lang = navigator.language || "en";
  const langPrefix = lang.split("-")[0];
  const localVoices = voices.filter((v) => v.lang.startsWith(langPrefix));
  const pool = localVoices.length > 0 ? localVoices : voices;

  for (const pattern of PREFERRED_PATTERNS) {
    const match = pool.find((v) => pattern.test(v.name));
    if (match) return match;
  }

  return pool.find((v) => v.default) || pool[0];
};

/**
 * Returns a ref to the best available SpeechSynthesisVoice for the
 * user's locale. Updates automatically when Chrome fires voiceschanged.
 */
export const useBrowserTtsVoice = () => {
  const voiceRef = useRef<SpeechSynthesisVoice | undefined>(undefined);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const update = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) voiceRef.current = pickBestVoice(voices);
    };

    update();
    window.speechSynthesis.addEventListener("voiceschanged", update);
    return () =>
      window.speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);

  return voiceRef;
};
