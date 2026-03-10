import { PodcastFeedActions } from "@/components/PodcastFeedActions";

export const PodcastFeedPanel = ({
  idBase = "podcast",
  heading = "Feed",
  title,
  feedUrl,
  syncRoute,
}: {
  idBase?: string;
  heading?: string;
  title: string;
  feedUrl: string;
  syncRoute: string;
}) => (
  <section aria-labelledby={`${idBase}-feed-heading`}>
    <h3
      id={`${idBase}-feed-heading`}
      className="font-display text-[1.2rem] font-semibold text-foreground mb-4"
    >
      {heading}
    </h3>
    <code
      aria-label={`${title} feed URL`}
      className="block overflow-x-auto rounded-xl bg-surface-2 border border-border px-4 py-3 text-sm text-foreground"
    >
      {feedUrl}
    </code>
    <PodcastFeedActions feedUrl={feedUrl} feedTitle={title} />
    <p className="text-sm text-muted mt-3 leading-[1.6]">
      For local testing, generate the latest episode first with an authorized{" "}
      <code>{syncRoute}</code>, then subscribe using this RSS URL.
    </p>
  </section>
);
