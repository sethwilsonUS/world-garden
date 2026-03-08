"use client";

import { useEffect, useState } from "react";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

export const CopyFeedButton = ({
  value,
  label = "Copy feed URL",
}: {
  value: string;
  label?: string;
}) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const handleCopy = async () => {
    const success = await copyTextToClipboard(value);
    if (success) {
      setCopied(true);
    } else {
      setCopied(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Feed URL copied" : label}
        title={copied ? "Copied" : label}
        className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-border bg-surface-2 text-foreground hover:bg-surface cursor-pointer transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {copied ? (
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
            <path d="M20 6 9 17l-5-5" />
          </svg>
        ) : (
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
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
      <span className="sr-only" aria-live="polite" role="status">
        {copied ? "Feed URL copied to clipboard." : ""}
      </span>
    </>
  );
};
