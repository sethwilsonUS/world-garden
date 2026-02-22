"use client";

import { useState, useEffect, useCallback } from "react";

const KEY_API = "world-garden-elevenlabs-key";
const KEY_VOICE = "world-garden-elevenlabs-voice";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel (free tier)

export type ElevenLabsSettings = {
  apiKey: string;
  voiceId: string;
  isConfigured: boolean;
};

const readSetting = (key: string, fallback: string): string => {
  if (typeof window === "undefined") return fallback;
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
};

export const useElevenLabsSettings = () => {
  const [apiKey, setApiKeyState] = useState("");
  const [voiceId, setVoiceIdState] = useState(DEFAULT_VOICE_ID);

  useEffect(() => {
    setApiKeyState(readSetting(KEY_API, ""));
    setVoiceIdState(readSetting(KEY_VOICE, DEFAULT_VOICE_ID));
  }, []);

  const setApiKey = useCallback((key: string) => {
    setApiKeyState(key);
    try {
      if (key) localStorage.setItem(KEY_API, key);
      else localStorage.removeItem(KEY_API);
    } catch {}
  }, []);

  const setVoiceId = useCallback((id: string) => {
    const value = id || DEFAULT_VOICE_ID;
    setVoiceIdState(value);
    try {
      localStorage.setItem(KEY_VOICE, value);
    } catch {}
  }, []);

  const clear = useCallback(() => {
    setApiKeyState("");
    setVoiceIdState(DEFAULT_VOICE_ID);
    try {
      localStorage.removeItem(KEY_API);
      localStorage.removeItem(KEY_VOICE);
    } catch {}
  }, []);

  return {
    apiKey,
    voiceId,
    isConfigured: apiKey.length > 0,
    setApiKey,
    setVoiceId,
    clear,
    DEFAULT_VOICE_ID,
  } as const;
};

const ELEVEN_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export const generateElevenLabsAudio = async (
  text: string,
  apiKey: string,
  voiceId: string,
): Promise<string> => {
  const { normalizeTtsText } = await import("@/convex/lib/elevenlabs");
  const normalizedText = normalizeTtsText(text);

  const response = await fetch(`${ELEVEN_TTS_URL}/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: normalizedText,
      model_id: "eleven_turbo_v2_5",
      output_format: "mp3_44100_128",
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Invalid ElevenLabs API key. Check your key in settings.");
    }
    if (response.status === 402) {
      throw new Error("ElevenLabs quota exceeded. Check your plan limits.");
    }
    throw new Error(`ElevenLabs TTS failed (${response.status})`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
};
