"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/lib/data-context";

type LinkedArticle = {
  wikiPageId: string;
  title: string;
  description?: string;
};

export const RelatedArticles = ({
  wikiPageId,
  currentTitle,
}: {
  wikiPageId: string;
  currentTitle: string;
}) => {
  const { getSectionLinks } = useData();
  const [articles, setArticles] = useState<LinkedArticle[]>([]);
  const [loading, setLoading] = useState(true);

  const [prevWikiPageId, setPrevWikiPageId] = useState(wikiPageId);
  if (wikiPageId !== prevWikiPageId) {
    setPrevWikiPageId(wikiPageId);
    setLoading(true);
    setArticles([]);
  }

  useEffect(() => {
    let cancelled = false;

    getSectionLinks({ wikiPageId, sectionTitle: null })
      .then((links) => {
        if (cancelled) return;
        const filtered = links
          .filter((l) => l.title !== currentTitle)
          .slice(0, 5);
        setArticles(filtered);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [wikiPageId, currentTitle, getSectionLinks]);

  if (loading || articles.length === 0) return null;

  return (
    <section
      aria-labelledby="related-heading"
      className="toc-section px-6 py-5"
    >
      <h2
        id="related-heading"
        className="font-display font-bold text-lg text-foreground mb-3.5 flex items-center gap-2"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          width={20}
          height={20}
          aria-hidden="true"
          className="text-accent"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
        </svg>
        Listen next
      </h2>
      <ul
        className="list-none p-0 m-0 grid gap-2"
        role="list"
      >
        {articles.map((article) => {
          const slug = encodeURIComponent(article.title.replace(/ /g, "_"));
          return (
            <li key={article.wikiPageId}>
              <Link
                href={`/article/${slug}`}
                className="result-link block py-2.5 px-3.5 bg-surface border border-border rounded-[10px] no-underline transition-all duration-200"
              >
                <span className="block font-semibold text-foreground text-sm leading-[1.4]">
                  {article.title}
                </span>
                {article.description && (
                  <span className="block text-xs text-muted mt-0.5 leading-[1.4]">
                    {article.description}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
