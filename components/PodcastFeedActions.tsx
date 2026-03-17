"use client";

import { useEffect, useId, useState } from "react";
import { CopyFeedButton } from "@/components/CopyFeedButton";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";

export const PodcastFeedActions = ({
  feedUrl,
  feedTitle,
}: {
  feedUrl: string;
  feedTitle: string;
}) => {
  const descriptionId = useId();
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = window.setTimeout(() => setStatusMessage(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [statusMessage]);

  const handleApplePodcasts = async () => {
    const copied = await copyTextToClipboard(feedUrl);
    setStatusMessage(
      copied
        ? "Feed URL copied. In Apple Podcasts, choose Follow a Show by URL and paste it. Feed updates often appear within a few hours."
        : "Could not copy automatically. Copy the feed URL manually, then paste it into Apple Podcasts. Feed updates often appear within a few hours.",
    );
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <CopyFeedButton
          value={feedUrl}
          label={`Copy ${feedTitle} feed URL`}
        />
        <button
          type="button"
          onClick={handleApplePodcasts}
          aria-describedby={descriptionId}
          aria-label={`Copy ${feedTitle} feed URL for Apple Podcasts`}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-sm font-medium text-foreground transition-colors duration-200 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={18}
            height={18}
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="2.3" />
            <path d="M12 4.2a7.8 7.8 0 0 0-7.8 7.8" />
            <path d="M12 19.8a7.8 7.8 0 0 0 7.8-7.8" />
            <path d="M12 1.8A10.2 10.2 0 0 0 1.8 12" />
            <path d="M12 22.2A10.2 10.2 0 0 0 22.2 12" />
          </svg>
          Apple Podcasts
        </button>
      </div>
      <p id={descriptionId} className="mt-3 text-sm text-muted leading-[1.6]">
        Tip: this copies the RSS feed so you can paste it into Apple Podcasts
        using <span className="font-medium text-foreground">Follow a Show by URL</span>.
      </p>
      <p className="mt-2 text-sm text-muted leading-[1.6]">
        Expect a little lag: Apple Podcasts usually picks up feed changes
        within a few hours, while artwork or metadata updates can take up to a
        day. On Mac, you can try <span className="font-medium text-foreground">Command-R</span>;
        on iPhone, Apple does not document an equivalent manual refresh.
      </p>
      <p className="sr-only" aria-live="polite" role="status">
        {statusMessage}
      </p>
    </div>
  );
};
