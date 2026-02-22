"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AudioPlayer } from "./AudioPlayer";

type SummaryPlayerProps = {
  wikiPageId: string;
  title: string;
};

export const SummaryPlayer = ({ wikiPageId, title }: SummaryPlayerProps) => {
  const getOrCreate = useAction(api.audio.getOrCreateSectionAudio);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasTriggered = useRef(false);

  const generate = useCallback(async () => {
    if (loading || audioUrl) return;
    setLoading(true);
    setError(null);

    try {
      const result = await getOrCreate({
        wikiPageId,
        sectionKey: "summary",
      });
      if (result?.audioUrl) {
        setAudioUrl(result.audioUrl);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Audio generation failed";
      if (message.includes("Rate limit")) {
        setError(
          "We're generating a lot of audio right now. Please try again shortly.",
        );
      } else {
        setError("Could not generate summary audio. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }, [wikiPageId, getOrCreate, loading, audioUrl]);

  useEffect(() => {
    if (!hasTriggered.current) {
      hasTriggered.current = true;
      generate();
    }
  }, [generate]);

  if (audioUrl) {
    return (
      <div aria-live="polite">
        <AudioPlayer
          audioUrl={audioUrl}
          title={title}
          label={`Now playing: ${title} — Summary`}
          autoFocus
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="garden-bed p-6"
        role="status"
        aria-label="Generating summary audio"
      >
        <div className="flex items-center gap-4">
          <div className="audio-pulse" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={28}
              height={28}
              className="text-accent"
            >
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
            </svg>
          </div>
          <div>
            <p className="font-display font-semibold text-foreground text-base">
              Preparing summary audio...
            </p>
            <p className="text-muted text-sm mt-1">
              The article summary will play automatically when ready
            </p>
          </div>
        </div>
        <p className="sr-only">
          Generating audio for the summary of {title}. It will play
          automatically when ready.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="garden-bed p-5">
        <div className="alert-banner alert-error" role="alert">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={20}
            height={20}
            aria-hidden="true"
            className="shrink-0 mt-0.5"
          >
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <div>
            <p className="text-sm">{error}</p>
            <button
              onClick={generate}
              className="btn-secondary mt-3 py-2 px-4 text-sm"
              aria-label="Try generating summary audio again"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
