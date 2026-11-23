"use client";

import { ArticleLink } from "@/components/ArticleLink";
import { useArticleSectionDetails } from "@/hooks/useArticleSectionMetadata";
import type { WikipediaRevisionIdentity } from "@/lib/data-context";

/**
 * Quiet, secondary disclosure for a row's links and citations. It sits on the
 * row's second line so the row's main line has a single action (Listen).
 */
export const SectionDetailsBadge = ({
  sectionLabel,
  linkCount,
  citationCount,
  isOpen,
  onToggle,
}: {
  sectionLabel: string;
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
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={isOpen}
      aria-label={`${label} in ${sectionLabel}`}
      className="linked-article-link pointer-events-auto inline-flex min-h-[44px] max-w-full cursor-pointer flex-wrap items-center gap-[6px] rounded-lg border-0 bg-transparent px-[4px] py-[4px] text-left text-sm font-medium leading-snug text-muted underline decoration-dotted underline-offset-4 transition-colors duration-150 [overflow-wrap:anywhere] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={`size-3 shrink-0 transition-transform duration-200 motion-reduce:transition-none ${isOpen ? "rotate-90" : ""}`}
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
      {loading && <p className="text-sm text-muted m-0">Loading...</p>}

      {!linksLoading && links !== null && links.length > 0 && (
        <nav aria-label={`Links in ${sectionLabel}`}>
          {showBoth && (
            <p className="text-sm font-semibold text-muted ml-1.5 mb-0.5">
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
                  className="linked-article-link flex min-h-[44px] items-center break-words rounded px-[6px] py-[4px] text-sm text-foreground-2 no-underline transition-colors duration-100 [overflow-wrap:anywhere]"
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
            <p className="text-sm font-semibold text-muted ml-1.5 mb-0.5">
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
                  className="shrink-0 w-6 font-mono text-xs font-semibold text-muted text-right leading-[1.65]"
                >
                  {citation.index}
                </span>
                <span className="flex-1 min-w-0 text-sm leading-[1.65] text-foreground-2 break-words">
                  {citation.text}
                  {citation.url && (
                    <>
                      {" "}
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Source for citation ${citation.index} (opens in new tab)`}
                        className="linked-article-link inline-flex min-h-[44px] items-center gap-0.5 rounded px-[6px] text-sm text-muted no-underline align-baseline transition-colors duration-150"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.5}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          className="shrink-0 size-3"
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
          <p className="text-sm text-muted m-0">
            No details available for this section.
          </p>
        )}
    </div>
  );
};
