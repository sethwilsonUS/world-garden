"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ArticleLink } from "@/components/ArticleLink";
import { useData } from "@/lib/data-context";
import { formatTime } from "@/lib/formatTime";
import { formatRate } from "@/hooks/usePlaybackRate";

type LinkedArticle = {
  wikiPageId: string;
  title: string;
  description?: string;
};

export const PlayIcon = () => {
  return (
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
      className="shrink-0"
    >
      <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
  );
};
export const PauseIcon = () => {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      width={14}
      height={14}
      aria-hidden="true"
      className="shrink-0"
    >
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
};

export const SpinnerIcon = () => {
  return (
    <svg
      className="animate-spin shrink-0"
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
  );
};

export const SoundIcon = () => {
  return (
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
      className="shrink-0"
    >
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
  );
};

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
  if (citations > 0) parts.push(`${citations} citation${citations === 1 ? "" : "s"}`);
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

type Citation = {
  id: string;
  index: number;
  text: string;
  url?: string;
};

export const SectionDetailsPanel = ({
  wikiPageId,
  sectionTitle,
  hasLinks,
  hasCitations,
}: {
  wikiPageId: string;
  sectionTitle: string | null;
  hasLinks: boolean;
  hasCitations: boolean;
}) => {
  const [links, setLinks] = useState<LinkedArticle[] | null>(null);
  const [citations, setCitations] = useState<Citation[] | null>(null);
  const [linksLoading, setLinksLoading] = useState(hasLinks);
  const [citesLoading, setCitesLoading] = useState(hasCitations);
  const { getSectionLinks, getSectionCitations } = useData();

  useEffect(() => {
    if (!hasLinks || links !== null) return;
    getSectionLinks({ wikiPageId, sectionTitle })
      .then(setLinks)
      .catch(() => setLinks([]))
      .finally(() => setLinksLoading(false));
  }, [hasLinks, links, wikiPageId, sectionTitle, getSectionLinks]);

  useEffect(() => {
    if (!hasCitations || citations !== null) return;
    getSectionCitations({ wikiPageId, sectionTitle })
      .then(setCitations)
      .catch(() => setCitations([]))
      .finally(() => setCitesLoading(false));
  }, [hasCitations, citations, wikiPageId, sectionTitle, getSectionCitations]);

  const loading = linksLoading || citesLoading;
  const showBoth = hasLinks && hasCitations;
  const sectionLabel = sectionTitle ?? "summary";

  return (
    <div className="px-3 pt-1 pb-2">
      {loading && (
        <p className="text-[0.6875rem] text-muted m-0">
          Loading...
        </p>
      )}

      {!linksLoading && links !== null && links.length > 0 && (
        <nav aria-label={`Links in ${sectionLabel}`}>
          {showBoth && (
            <p className="text-[0.65625rem] sm:text-[0.5625rem] font-semibold text-muted uppercase tracking-[0.05em] ml-1.5 mb-0.5">
              Links
            </p>
          )}
          <ul className="list-none m-0 p-0" style={{ columnWidth: "180px", columnGap: "8px" }}>
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

export const SpeedButton = ({ rate, onClick }: { rate: number; onClick: () => void }) => (
  <button
    onClick={onClick}
    aria-label={`Playback speed ${formatRate(rate)}. Click to change.`}
    className={`inline-flex items-center justify-center py-[5px] px-2 bg-transparent border border-border rounded-lg cursor-pointer font-mono text-xs font-bold leading-none min-w-[40px] shrink-0 transition-colors duration-150 pointer-events-auto ${
      rate !== 1 ? "text-accent" : "text-muted"
    }`}
  >
    {formatRate(rate)}
  </button>
);

export const InlineProgressBar = ({
  currentTime,
  duration,
  onSeek,
}: {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}) => {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="toc-scrubber group px-3 pb-3 pt-1">
      <div className="relative flex-1 min-w-0">
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(e) => onSeek(parseFloat(e.target.value))}
          aria-label={`Playback position. ${formatTime(currentTime)} of ${formatTime(duration)}`}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
          className="toc-progress-range block w-full"
          style={{ "--progress": `${progress}%` } as CSSProperties}
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 px-0.5">
        <span
          className="font-mono text-[0.625rem] tracking-wide font-medium text-accent select-none tabular-nums"
          aria-hidden="true"
        >
          {formatTime(currentTime)}
        </span>
        <span
          className="font-mono text-[0.625rem] tracking-wide font-medium text-muted select-none tabular-nums"
          aria-hidden="true"
        >
          {duration > 0 ? formatTime(duration) : "--:--"}
        </span>
      </div>
    </div>
  );
};
