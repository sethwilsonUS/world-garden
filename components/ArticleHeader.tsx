type ArticleHeaderProps = {
  title: string;
  language: string;
  revisionId: string;
  lastEdited?: string;
  wikiPageId: string;
};

export const ArticleHeader = ({
  title,
  language,
  revisionId,
  lastEdited,
  wikiPageId,
}: ArticleHeaderProps) => {
  const wikiUrl = `https://${language}.wikipedia.org/wiki?curid=${wikiPageId}`;
  const historyUrl = `https://${language}.wikipedia.org/w/index.php?title=Special:History&action=history&curid=${wikiPageId}`;
  const revisionUrl = `https://${language}.wikipedia.org/w/index.php?oldid=${revisionId}`;

  const formattedDate = lastEdited
    ? new Date(lastEdited).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;

  return (
    <footer aria-label={`Source information for ${title}`}>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <span className="inline-flex items-center gap-1.5 py-1 px-3 rounded-full bg-accent-bg border border-accent-border text-xs text-accent font-medium">
          Wikipedia ({language.toUpperCase()})
        </span>

        {formattedDate && lastEdited && (
          <time
            dateTime={new Date(lastEdited).toISOString().split("T")[0]}
            className="text-xs text-muted"
          >
            Last edited: {formattedDate}
          </time>
        )}
      </div>

      <nav
        aria-label="Source links"
        className="flex flex-wrap gap-3 mb-6"
      >
        <a
          href={wikiUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-accent underline underline-offset-2"
        >
          View on Wikipedia
          <span className="sr-only"> (opens in new tab)</span>
          <ExternalIcon />
        </a>
        <a
          href={revisionUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-accent underline underline-offset-2"
        >
          Revision {revisionId}
          <span className="sr-only"> (opens in new tab)</span>
          <ExternalIcon />
        </a>
        <a
          href={historyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-accent underline underline-offset-2"
        >
          Edit history
          <span className="sr-only"> (opens in new tab)</span>
          <ExternalIcon />
        </a>
      </nav>

      <div className="garden-bed py-4 px-5 text-xs text-muted leading-[1.6]">
        <p>
          <strong className="text-foreground-2">License:</strong>{" "}
          This article content is sourced from Wikipedia and is available under
          the{" "}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline"
          >
            Creative Commons Attribution-ShareAlike 4.0 License
            <span className="sr-only"> (opens in new tab)</span>
          </a>
          .
        </p>
      </div>
    </footer>
  );
};

const ExternalIcon = () => {
  return (
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
      <path d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
};
