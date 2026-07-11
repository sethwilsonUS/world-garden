"use client";

import { useState } from "react";

export const LocalModeBanner = () => {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-12 z-[60] flex items-center justify-center gap-3 border-b border-accent-border bg-surface px-4 py-2 text-[0.8125rem] font-medium text-accent shadow-sm"
    >
      <span>
        Running in local mode &mdash; articles are fetched live from Wikipedia.
        Your history and bookmarks are saved locally in your browser.
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss local mode notice"
        className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-inherit"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          width={14}
          height={14}
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
};
