"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useElevenLabsSettings } from "@/hooks/useElevenLabsSettings";

export const SettingsButton = () => {
  const { isConfigured } = useElevenLabsSettings();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const open = useCallback(() => {
    dialogRef.current?.showModal();
  }, []);

  const close = useCallback(() => {
    dialogRef.current?.close();
    btnRef.current?.focus();
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClick = (e: MouseEvent) => {
      if (e.target === dialog) close();
    };
    dialog.addEventListener("click", handleClick);
    return () => dialog.removeEventListener("click", handleClick);
  }, [close]);

  return (
    <>
      <button
        ref={btnRef}
        onClick={open}
        aria-label="Settings"
        aria-haspopup="dialog"
        className={`flex items-center justify-center w-8 h-8 bg-transparent border-0 rounded-lg cursor-pointer transition-colors duration-200 ${isConfigured ? "text-accent" : "text-muted"}`}
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
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="Audio settings"
        className="settings-dialog"
      >
        <SettingsContent onClose={close} />
      </dialog>
    </>
  );
};

const SettingsContent = ({ onClose }: { onClose: () => void }) => {
  const { apiKey, voiceId, isConfigured, setApiKey, setVoiceId, clear, DEFAULT_VOICE_ID } =
    useElevenLabsSettings();
  const [localKey, setLocalKey] = useState(apiKey);
  const [localVoice, setLocalVoice] = useState(voiceId);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    setLocalKey(apiKey);
    setLocalVoice(voiceId);
  }, [apiKey, voiceId]);

  const handleSave = () => {
    setApiKey(localKey.trim());
    setVoiceId(localVoice.trim());
    setAnnouncement("Settings saved");
    setTimeout(() => onClose(), 100);
  };

  const handleClear = () => {
    clear();
    setLocalKey("");
    setLocalVoice(DEFAULT_VOICE_ID);
    setAnnouncement("ElevenLabs settings removed");
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="font-display font-bold text-base text-foreground">
          Audio settings
        </h3>
        <button
          onClick={onClose}
          aria-label="Close settings"
          className="flex items-center justify-center w-7 h-7 -mt-1 -mr-1 rounded-lg text-muted bg-transparent border-0 cursor-pointer transition-colors duration-200"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            width={16}
            height={16}
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <p className="text-xs text-muted leading-normal mb-4">
        Add your{" "}
        <a
          href="https://elevenlabs.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent underline"
        >
          ElevenLabs
          <span className="sr-only"> (opens in new tab)</span>
        </a>{" "}
        API key for higher-quality voices. Your key stays in your browser&mdash;it&rsquo;s
        never sent to our servers.
      </p>

      <label
        htmlFor="eleven-key"
        className="block text-xs font-semibold text-foreground-2 mb-1"
      >
        API key
      </label>
      <input
        id="eleven-key"
        type="text"
        autoComplete="off"
        value={localKey}
        onChange={(e) => setLocalKey(e.target.value)}
        placeholder="xi-..."
        className="w-full py-2 px-3 bg-surface text-foreground border border-border rounded-lg text-[0.8125rem] font-mono mb-3"
        style={{ WebkitTextSecurity: "disc" } as React.CSSProperties}
      />

      <label
        htmlFor="eleven-voice"
        className="block text-xs font-semibold text-foreground-2 mb-1"
      >
        Voice ID{" "}
        <span className="font-normal text-muted">(optional)</span>
      </label>
      <input
        id="eleven-voice"
        type="text"
        autoComplete="off"
        value={localVoice}
        onChange={(e) => setLocalVoice(e.target.value)}
        placeholder={DEFAULT_VOICE_ID}
        className="w-full py-2 px-3 bg-surface text-foreground border border-border rounded-lg text-[0.8125rem] font-mono mb-4"
      />

      <div className="flex gap-2">
        <button onClick={handleSave} className="btn-primary flex-1 px-4 py-2 text-[0.8125rem]">
          {isConfigured ? "Update" : "Save"}
        </button>
        {isConfigured && (
          <button onClick={handleClear} className="btn-secondary px-4 py-2 text-[0.8125rem]">
            Remove
          </button>
        )}
      </div>

      <div aria-live="polite" className="sr-only" role="status">
        {announcement}
      </div>

      {isConfigured && (
        <p className="mt-3 text-[0.6875rem] text-accent flex items-center gap-1">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={12}
            height={12}
            aria-hidden="true"
          >
            <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          ElevenLabs voices active
        </p>
      )}
    </div>
  );
};
