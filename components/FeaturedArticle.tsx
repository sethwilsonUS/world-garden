"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePrefetch } from "@/hooks/usePrefetch";

const WIKI_FEATURED_API = "https://en.wikipedia.org/api/rest_v1/feed/featured";

type FeaturedData = {
  title: string;
  extract: string;
  thumbnail?: { source: string; width: number; height: number };
};

const todayString = (): string => {
  const d = new Date();
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

export const FeaturedArticle = () => {
  const prefetch = usePrefetch();
  const [featured, setFeatured] = useState<FeaturedData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${WIKI_FEATURED_API}/${todayString()}`);
        if (!response.ok) return;
        const data = await response.json();
        const tfa = data.tfa;
        if (!tfa || cancelled) return;
        const title = tfa.titles?.normalized ?? tfa.title ?? "";
        setFeatured({
          title,
          extract: tfa.extract ?? "",
          thumbnail: tfa.thumbnail as FeaturedData["thumbnail"],
        });
        prefetch(title);
      } catch {
        // Featured article is a nice-to-have; fail silently
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [prefetch]);

  if (!loading && !featured) return null;

  if (loading) {
    return (
      <section aria-label="Loading featured article" className="mt-10">
        <div className="py-4 px-5 bg-surface-2 border border-border rounded-2xl">
          <div className="skeleton" style={{ width: "60%", height: "20px", marginBottom: "10px" }} />
          <div className="skeleton" style={{ width: "100%", height: "14px", marginBottom: "6px" }} />
          <div className="skeleton" style={{ width: "80%", height: "14px" }} />
        </div>
      </section>
    );
  }

  const slug = encodeURIComponent(featured!.title.replace(/ /g, "_"));
  const truncatedExtract =
    featured!.extract.length > 200
      ? featured!.extract.slice(0, 200).replace(/\s+\S*$/, "") + "\u2026"
      : featured!.extract;

  return (
    <section
      aria-labelledby="featured-heading"
      className="mt-10"
    >
      <h2
        id="featured-heading"
        className="font-display font-semibold text-lg text-foreground mb-4 text-center"
      >
        Today&rsquo;s featured article
      </h2>
      <Link
        href={`/article/${slug}`}
        className="result-link block bg-surface-2 border border-border rounded-2xl no-underline overflow-hidden transition-all duration-200"
      >
        <div className={featured!.thumbnail ? "flex flex-col sm:flex-row" : ""}>
          {featured!.thumbnail && (
            <div className="relative sm:w-40 sm:min-h-[120px] aspect-[16/9] sm:aspect-auto shrink-0 bg-surface-3 overflow-hidden">
              <img
                src={featured!.thumbnail.source}
                alt=""
                className="absolute inset-0 w-full h-full object-cover"
                loading="eager"
              />
            </div>
          )}
          <div className="px-5 py-4 min-w-0">
            <span className="flex items-center gap-2 mb-2">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                width={16}
                height={16}
                aria-hidden="true"
                className="text-accent shrink-0"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
              <span className="font-display font-bold text-[1.0625rem] text-foreground">
                {featured!.title}
              </span>
            </span>
            <span className="block text-[0.8125rem] leading-[1.6] text-muted">
              {truncatedExtract}
            </span>
          </div>
        </div>
      </Link>
    </section>
  );
};
