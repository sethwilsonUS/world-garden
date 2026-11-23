import { PodcastFeedActions } from "@/components/PodcastFeedActions";

export const PodcastFeedPanel = ({
  idBase = "podcast",
  heading = "Subscribe",
  title,
  feedUrl,
}: {
  idBase?: string;
  heading?: string;
  title: string;
  feedUrl: string;
}) => (
  <section
    aria-labelledby={`${idBase}-feed-heading`}
    className="rounded-xl border border-border bg-surface px-4 py-4 sm:px-5"
  >
    <h3
      id={`${idBase}-feed-heading`}
      className="font-display text-[1.125rem] font-semibold text-foreground"
    >
      {heading}
    </h3>
    <p className="mt-2 text-xs font-medium text-muted">RSS feed URL</p>
    {/* Wraps instead of scrolling so there is no keyboard-inaccessible
        horizontal scroll region on narrow screens (WCAG 2.1.1). */}
    <p className="mt-1 break-all rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-foreground [overflow-wrap:anywhere]">
      <code>{feedUrl}</code>
    </p>
    <PodcastFeedActions feedUrl={feedUrl} feedTitle={title} />
  </section>
);
