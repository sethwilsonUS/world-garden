"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { fetchSafeRandomArticle } from "@/lib/random-article";
import { usePrefetch } from "@/hooks/usePrefetch";

export const RandomRerollButton = () => {
  const router = useRouter();
  const prefetch = usePrefetch();
  const [loading, setLoading] = useState(false);
  const prePicked = useRef<Promise<string> | null>(null);

  const prePick = useCallback(() => {
    if (prePicked.current) return;
    prePicked.current = fetchSafeRandomArticle()
      .then((title) => {
        prefetch(title);
        return title;
      })
      .catch(() => {
        prePicked.current = null;
        return "";
      });
  }, [prefetch]);

  const handleClick = useCallback(async () => {
    setLoading(true);
    try {
      let title = "";
      if (prePicked.current) {
        title = await prePicked.current;
      }
      if (!title) {
        title = await fetchSafeRandomArticle();
      }
      const slug = encodeURIComponent(title.replace(/ /g, "_"));
      prePicked.current = null;
      router.push(`/article/${slug}?from=random`);
    } catch {
      setLoading(false);
      prePicked.current = null;
    }
  }, [router]);

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={prePick}
      onFocus={prePick}
      disabled={loading}
      aria-label="Load another random article"
      aria-busy={loading}
      className={`inline-flex items-center gap-1.5 text-muted text-sm bg-transparent border-none p-0 transition-opacity duration-200 ${loading ? "cursor-wait opacity-60" : "cursor-pointer"}`}
    >
      {loading ? (
        <svg
          className="animate-spin"
          fill="none"
          viewBox="0 0 24 24"
          width={14}
          height={14}
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
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          width={14}
          height={14}
          aria-hidden="true"
        >
          <path d="M18 4l3 3-3 3" />
          <path d="M6 20l-3-3 3-3" />
          <path d="M21 7H9a5 5 0 000 10h12" />
          <path d="M3 17h12a5 5 0 000-10H3" />
        </svg>
      )}
      Give me another
      <span className="sr-only" aria-live="polite">
        {loading ? "Loading another random article…" : ""}
      </span>
    </button>
  );
};
