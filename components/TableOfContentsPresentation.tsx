"use client";

import { ArticleLink } from "@/components/ArticleLink";
import { useArticleSectionDetails } from "@/hooks/useArticleSectionMetadata";
import type { WikipediaRevisionIdentity } from "@/lib/data-context";

export const SectionDetailsBadge = ({
  linkCount,
  citationCount,
  isOpen,
  onToggle,
}: {
  linkCount?: number;
  citationCount?: number;
  isOpen: boolean;
  onToggle: () => void;
}) => {
  const links = linkCount ?? 0;
  const citations = citationCount ?? 0;
  if (links === 0 && citations === 0) return null;

  const parts: string[] = [];
  if (links > 0) parts.push(`${links} link${links === 1 ? "" : "s"}`);
  if (citations > 0)
    parts.push(`${citations} citation${citations === 1 ? "" : "s"}`);
  const label = parts.join(" · ");

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={isOpen}
      aria-label={label}
      className="linked-article-link inline-flex items-center gap-[3px] px-[7px] py-px bg-transparent border border-border rounded-full text-[0.6875rem] sm:text-[0.625rem] text-muted cursor-pointer font-medium leading-[1.4] pointer-events-auto transition-colors duration-150"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0 transition-transform duration-200 size-[10px] sm:size-2"
        style={{ transform: isOpen ? "rotate(90deg)" : "none" }}
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
      {label}
    </button>
  );
};

export const SectionDetailsPanel = ({
  identity,
  sectionTitle,
  sectionIndex,
  hasLinks,
  hasCitations,
}: {
  identity: WikipediaRevisionIdentity;
  sectionTitle: string | null;
  sectionIndex?: string;
  hasLinks: boolean;
  hasCitations: boolean;
}) => {
  const {
    links,
    citations,
    linksLoading,
    citationsLoading: citesLoading,
  } = useArticleSectionDetails({
    identity,
    sectionTitle,
    sectionIndex,
    hasLinks,
    hasCitations,
  });

  const loading = linksLoading || citesLoading;
  const showBoth = hasLinks && hasCitations;
  const sectionLabel = sectionTitle ?? "summary";

  return (
    <div className="px-3 pt-1 pb-2">
      {loading && <p className="text-[0.6875rem] text-muted m-0">Loading...</p>}

      {!linksLoading && links !== null && links.length > 0 && (
        <nav aria-label={`Links in ${sectionLabel}`}>
          {showBoth && (
            <p className="text-[0.65625rem] sm:text-[0.5625rem] font-semibold text-muted uppercase tracking-[0.05em] ml-1.5 mb-0.5">
              Links
            </p>
          )}
          <ul
            className="list-none m-0 p-0"
            style={{ columnWidth: "180px", columnGap: "8px" }}
          >
            {links.map((article) => (
              <li key={article.wikiPageId} className="break-inside-avoid">
                <ArticleLink
                  articleTitle={article.title}
                  title={article.description ?? article.title}
                  className="linked-article-link block px-1.5 py-0.5 rounded text-[0.8125rem] sm:text-xs text-foreground-2 no-underline transition-colors duration-100"
                >
                  {article.title}
                </ArticleLink>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {!citesLoading && citations !== null && citations.length > 0 && (
        <nav
          aria-label={`Citations in ${sectionLabel}`}
          className={showBoth && links && links.length > 0 ? "mt-2" : ""}
        >
          {showBoth && (
            <p className="text-[0.65625rem] sm:text-[0.5625rem] font-semibold text-muted uppercase tracking-[0.05em] ml-1.5 mb-0.5">
              Citations
            </p>
          )}
          <ol className="list-none m-0 p-0">
            {citations.map((citation) => (
              <li
                key={citation.id}
                className="flex gap-2 px-1.5 py-[3px] rounded items-start"
              >
                <span
                  aria-hidden="true"
                  className="shrink-0 w-6 font-mono text-[0.6875rem] sm:text-[0.625rem] font-semibold text-muted text-right leading-[1.65]"
                >
                  {citation.index}
                </span>
                <span className="flex-1 min-w-0 text-[0.8125rem] sm:text-[0.6875rem] leading-[1.65] text-foreground-2 break-words">
                  {citation.text}
                  {citation.url && (
                    <>
                      {" "}
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Source for citation ${citation.index} (opens in new tab)`}
                        className="linked-article-link inline-flex items-center gap-0.5 text-[0.6875rem] sm:text-[0.625rem] text-muted no-underline px-[3px] rounded align-baseline transition-colors duration-150"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          className="shrink-0 size-[10px] sm:size-2"
                        >
                          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        link
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </nav>
      )}

      {!loading &&
        (links === null || links.length === 0) &&
        (citations === null || citations.length === 0) && (
          <p className="text-[0.6875rem] text-muted m-0">
            No details available for this section.
          </p>
        )}
    </div>
  );
};
