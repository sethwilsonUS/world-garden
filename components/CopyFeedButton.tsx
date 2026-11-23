"use client";

import { useEffect, useState } from "react";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

/**
 * `label` is the accessible name and must contain `visibleLabel` so speech
 * input users can say what they see (WCAG 2.5.3 Label in Name).
 */
export const CopyFeedButton = ({
  value,
  label = "Copy feed URL",
  visibleLabel = "Copy feed URL",
}: {
  value: string;
  label?: string;
  visibleLabel?: string;
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
        className="inline-flex min-h-[44px] max-w-full cursor-pointer flex-wrap items-center justify-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-center text-sm font-medium leading-snug text-foreground transition-colors duration-200 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
        <span>{copied ? "Copied" : visibleLabel}</span>
      </button>
      <span className="sr-only" aria-live="polite" role="status">
        {copied ? "Feed URL copied to clipboard." : ""}
      </span>
    </>
  );
};
