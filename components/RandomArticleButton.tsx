"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/data-context";
import { warmSummaryAudio, warmArticleImage } from "@/lib/audio-prefetch";
import { isCategoryNsfw, isDisambiguation } from "@/lib/nsfw-filter";

const WIKI_API = "https://en.wikipedia.org/w/api.php";

const fetchSafeRandomArticle = async (maxAttempts = 2): Promise<string> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const randomParams = new URLSearchParams({
      action: "query",
      format: "json",
      list: "random",
      rnnamespace: "0",
      rnlimit: "8",
      origin: "*",
    });
    const randomRes = await fetch(`${WIKI_API}?${randomParams}`);
    if (!randomRes.ok) throw new Error("Failed to fetch random articles");
    const randomData = await randomRes.json();
    const candidates: { title: string }[] = randomData.query?.random ?? [];
    if (candidates.length === 0) throw new Error("No articles found");

    const titles = candidates.map((c) => c.title);
    const catParams = new URLSearchParams({
      action: "query",
      format: "json",
      prop: "categories",
      titles: titles.join("|"),
      cllimit: "50",
      origin: "*",
    });
    const catRes = await fetch(`${WIKI_API}?${catParams}`);
    if (!catRes.ok) throw new Error("Failed to check categories");
    const catData = await catRes.json();
    const pages: Record<string, { title: string; categories?: { title: string }[] }> =
      catData.query?.pages ?? {};

    for (const page of Object.values(pages)) {
      const cats = page.categories ?? [];
      const unsuitable = cats.some(
        (c) => isCategoryNsfw(c.title) || isDisambiguation(c.title),
      );
      if (!unsuitable) return page.title;
    }
  }

  throw new Error("Could not find a suitable article");
};

export const RandomArticleButton = () => {
  const router = useRouter();
  const { fetchArticle } = useData();
  const [loading, setLoading] = useState(false);
  const prePicked = useRef<Promise<string> | null>(null);

  const prePick = useCallback(() => {
    if (prePicked.current) return;
    prePicked.current = fetchSafeRandomArticle().then((title) => {
      const slug = title.replace(/ /g, "_");
      warmSummaryAudio(slug, fetchArticle);
      warmArticleImage(slug, fetchArticle);
      return title;
    }).catch(() => {
      prePicked.current = null;
      return "";
    });
  }, [fetchArticle]);

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
      router.push(`/article/${slug}`);
    } catch {
      setLoading(false);
      prePicked.current = null;
    }
  }, [router]);

  return (
    <button
      onClick={handleClick}
      onMouseEnter={prePick}
      onFocus={prePick}
      disabled={loading}
      aria-label="Listen to a random Wikipedia article"
      className={`linked-article-link inline-flex items-center gap-1.5 py-2 px-[18px] bg-transparent text-foreground-2 border border-border rounded-full font-medium text-[0.8125rem] font-[inherit] transition-all duration-200 ${loading ? "cursor-wait opacity-60" : "cursor-pointer"}`}
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
      Surprise me
    </button>
  );
};
