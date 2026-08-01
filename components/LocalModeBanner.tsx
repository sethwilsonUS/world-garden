"use client";

import { useState } from "react";

export const LocalModeBanner = () => {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="status"
      className="relative z-10 border-b border-accent-border bg-surface py-2 pl-4 pr-16 text-[0.8125rem] font-medium leading-relaxed text-accent shadow-sm"
    >
      <span className="block min-w-0 break-words text-center [overflow-wrap:anywhere]">
        Local mode &mdash; Wikipedia loads live; history and bookmarks stay in
        this browser.
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss local mode notice"
        className="absolute right-2 top-2 flex size-11 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 text-inherit"
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
