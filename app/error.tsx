"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container mx-auto px-4 py-[100px]">
      <div className="max-w-xl mx-auto text-center animate-fade-in-up">
        <div className="inline-flex items-center gap-2 py-[6px] px-3.5 rounded-full bg-accent-bg border border-accent-border mb-7 text-[0.8125rem] text-accent font-semibold tracking-[0.01em]">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={15}
            height={15}
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          Error
        </div>

        <h1 className="font-display text-[clamp(2.25rem,6vw,4rem)] font-semibold leading-[1.05] mb-4 text-foreground tracking-[-0.02em]">
          Something went wrong
        </h1>

        <p className="text-lg leading-[1.7] text-foreground-2 max-w-[440px] mx-auto mb-10">
          An unexpected error occurred. You can try again, or head back to the
          home page.
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button onClick={reset} className="btn-primary">
            Try again
          </button>
          <a href="/" className="btn-secondary">
            Back to home
          </a>
        </div>
      </div>
    </div>
  );
}
