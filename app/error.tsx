"use client";

import { useEffect } from "react";
import Link from "next/link";

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
          <Link href="/" className="btn-secondary">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
