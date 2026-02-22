"use client";

import { useState } from "react";

export const LocalModeBanner = () => {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 py-2 px-4 bg-accent-bg border-b border-accent-border text-[0.8125rem] text-accent font-medium"
    >
      <span>
        Running in local mode &mdash; articles are fetched live from Wikipedia.
        Your history and bookmarks are saved locally in your browser.
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss local mode notice"
        className="flex items-center justify-center w-5 h-5 p-0 bg-transparent border-0 cursor-pointer text-inherit rounded shrink-0"
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
