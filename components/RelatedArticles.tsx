"use client";

import { useState, useEffect } from "react";
import { useData, type WikipediaRevisionIdentity } from "@/lib/data-context";
import { ArticleLink } from "@/components/ArticleLink";
import { PlaylistActionButton } from "@/components/PlaylistActionButton";
import { wikipediaRevisionKey } from "@/lib/wikipedia-utils";

type LinkedArticle = {
  wikiPageId: string;
  title: string;
  description?: string;
};

type RelatedArticlesState = {
  key: string;
  articles: LinkedArticle[];
  loading: boolean;
};

const loadingState = (key: string): RelatedArticlesState => ({
  key,
  articles: [],
  loading: true,
});

export const RelatedArticles = ({
  identity,
}: {
  identity: WikipediaRevisionIdentity;
}) => {
  const { getSectionLinks } = useData();
  const { wikiPageId, revisionId, title, language } = identity;
  const identityKey = wikipediaRevisionKey(identity);
  const [state, setState] = useState<RelatedArticlesState>(() =>
    loadingState(identityKey),
  );

  useEffect(() => {
    const controller = new AbortController();
    const requestIdentity = { wikiPageId, revisionId, title, language };

    getSectionLinks({
      identity: requestIdentity,
      sectionTitle: null,
      signal: controller.signal,
    })
      .then((links) => {
        if (controller.signal.aborted) return;
        const filtered = links
          .filter((link) => link.title !== title)
          .slice(0, 5);
        setState({ key: identityKey, articles: filtered, loading: false });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setState({ key: identityKey, articles: [], loading: false });
      });

    return () => controller.abort();
  }, [getSectionLinks, identityKey, language, revisionId, title, wikiPageId]);

  const { articles, loading } =
    state.key === identityKey ? state : loadingState(identityKey);
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
      <ul className="list-none p-0 m-0 grid gap-2" role="list">
        {articles.map((article) => {
          const slug = encodeURIComponent(article.title.replace(/ /g, "_"));
          return (
            <li key={article.wikiPageId}>
              <div className="flex items-center gap-3 rounded-[10px] border border-border bg-surface px-3.5 py-2.5 transition-all duration-200">
                <ArticleLink
                  articleTitle={article.title}
                  href={`/article/${slug}`}
                  className="result-link min-w-0 flex-1 no-underline"
                >
                  <span className="block text-sm font-semibold leading-[1.4] text-foreground">
                    {article.title}
                  </span>
                  {article.description && (
                    <span className="mt-0.5 block text-xs leading-[1.4] text-muted">
                      {article.description}
                    </span>
                  )}
                </ArticleLink>
                <PlaylistActionButton
                  slug={article.title.replace(/ /g, "_")}
                  title={article.title}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
