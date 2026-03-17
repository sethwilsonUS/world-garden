import {
  getArticleTopicDisplayKeys,
  getBadgeDefinition,
  type BadgeKey,
} from "@/lib/badges";

type ArticleTopicsProps = {
  badgeKeys?: BadgeKey[];
};

export const ArticleTopics = ({ badgeKeys }: ArticleTopicsProps) => {
  const orderedBadgeKeys = getArticleTopicDisplayKeys({ badgeKeys });

  return (
    <section
      aria-label="Article topics"
      className="flex flex-wrap items-center gap-2"
    >
      <span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-foreground/65">
        Related topics
      </span>

      {orderedBadgeKeys === undefined ? (
        <p className="m-0 text-sm text-foreground/58">
          Unavailable right now.
        </p>
      ) : orderedBadgeKeys.length === 0 ? (
        <p className="m-0 text-sm text-foreground/58">
          No broad topics detected yet.
        </p>
      ) : (
        orderedBadgeKeys.map((key) => {
          const definition = getBadgeDefinition(key);

          return (
            <span
              key={key}
              title={definition.description}
              className="rounded-full border border-foreground/12 bg-[color:rgba(92,122,108,0.12)] px-3 py-1 text-sm font-medium text-foreground/86"
            >
              {definition.label}
            </span>
          );
        })
      )}
    </section>
  );
};
