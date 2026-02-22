"use client";

import { useState, useRef } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { AudioPlayer } from "./AudioPlayer";

type GenerateAudioButtonProps = {
  wikiPageId: string;
  title: string;
};

export const GenerateAudioButton = ({
  wikiPageId,
  title,
}: GenerateAudioButtonProps) => {
  const getOrCreate = useAction(api.audio.getOrCreateForArticle);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await getOrCreate({ wikiPageId });
      if (result?.audioUrl) {
        setAudioUrl(result.audioUrl);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Audio generation failed";

      if (message.includes("Rate limit")) {
        setError(
          "We're generating a lot of audio right now. Please try again in a little while.",
        );
      } else {
        setError(
          "Something went wrong generating the audio. Please try again later.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  if (audioUrl) {
    return <AudioPlayer audioUrl={audioUrl} title={title} />;
  }

  return (
    <div>
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="btn-primary w-full px-6 py-4 text-lg"
        aria-describedby="audio-status"
      >
        {loading ? (
          <>
            <svg
              className="animate-spin"
              fill="none"
              viewBox="0 0 24 24"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Cultivating audio...
          </>
        ) : (
          <>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width="20"
              height="20"
              aria-hidden="true"
            >
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            Generate audio
          </>
        )}
      </button>

      <div ref={statusRef} id="audio-status" aria-live="assertive" className="sr-only">
        {loading && "Generating audio, please wait..."}
        {error && error}
      </div>

      {error && (
        <div
          className="alert-banner alert-error mt-4"
          role="alert"
        >
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
          <p className="text-sm">{error}</p>
        </div>
      )}
    </div>
  );
};
