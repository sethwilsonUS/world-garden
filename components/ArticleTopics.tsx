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
      <span className="text-sm font-semibold text-muted">Related topics:</span>

      {orderedBadgeKeys === undefined ? (
        <p className="m-0 text-sm text-muted">Unavailable right now.</p>
      ) : orderedBadgeKeys.length === 0 ? (
        <p className="m-0 text-sm text-muted">No broad topics detected yet.</p>
      ) : (
        orderedBadgeKeys.map((key) => {
          const definition = getBadgeDefinition(key);

          return (
            <span
              key={key}
              title={definition.description}
              className="rounded-full border border-border bg-surface-2 px-3 py-1 text-sm font-medium text-foreground-2"
            >
              {definition.label}
            </span>
          );
        })
      )}
    </section>
  );
};
