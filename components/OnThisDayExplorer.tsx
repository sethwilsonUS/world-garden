"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AccessibleTimeline, type TimelineOrder } from "./AccessibleTimeline";
import { AdaptiveImageFrame } from "./AdaptiveImageFrame";
import { ArticleLink } from "./ArticleLink";
import { MediaAttribution } from "./MediaAttribution";
import { formatUtcCalendarDate } from "@/lib/date-format";
import {
  ON_THIS_DAY_CATEGORIES,
  type OnThisDayCategory,
  type OnThisDayEvent,
  type OnThisDayOrder,
  type OnThisDayPageResponse,
} from "@/lib/on-this-day-contracts";

const CATEGORY_LABELS: Record<OnThisDayCategory, string> = {
  selected: "Highlights",
  events: "Events",
  births: "Births",
  deaths: "Deaths",
  holidays: "Holidays",
};

const CATEGORY_NOUNS: Record<
  OnThisDayCategory,
  { singular: string; plural: string }
> = {
  selected: { singular: "highlight", plural: "highlights" },
  events: { singular: "event", plural: "events" },
  births: { singular: "birth", plural: "births" },
  deaths: { singular: "death", plural: "deaths" },
  holidays: { singular: "holiday", plural: "holidays" },
};

const cacheKey = (
  category: OnThisDayCategory,
  order: OnThisDayOrder,
): string => `${category}:${category === "holidays" ? "newest" : order}`;

const displayYear = (year: number | undefined): string => {
  if (year == null) return "Annual";
  return year < 0 ? `${Math.abs(year)} BCE` : String(year);
};

const TimelineEventContent = ({ event }: { event: OnThisDayEvent }) => (
  <article className={event.image ? "on-this-day-event has-image" : "on-this-day-event"}>
    <div className="min-w-0">
      <p className="on-this-day-event-text">{event.text}</p>
      {event.pages.length > 0 ? (
        <ul className="on-this-day-event-links" aria-label="Related articles">
          {event.pages.map((page) => (
            <li key={`${page.wikiPageId ?? page.slug}-${page.title}`}>
              <ArticleLink
                articleTitle={page.title}
                href={`/article/${encodeURIComponent(page.slug)}`}
              >
                {page.title}
              </ArticleLink>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
    {event.image ? (
      <div className="on-this-day-event-image">
        <AdaptiveImageFrame
          src={event.image.source}
          alt=""
          width={event.image.width}
          height={event.image.height}
          sizes="(min-width: 640px) 160px, 112px"
          fallbackFrameAspectRatio={4 / 3}
          className="aspect-[4/3] rounded-xl"
          loading="lazy"
          unoptimized
        />
        {event.image.attribution ? (
          <MediaAttribution attribution={event.image.attribution} compact />
        ) : null}
      </div>
    ) : null}
  </article>
);

export const OnThisDayExplorer = () => {
  const [activeCategory, setActiveCategory] =
    useState<OnThisDayCategory>("selected");
  const [orders, setOrders] = useState<Record<OnThisDayCategory, OnThisDayOrder>>({
    selected: "newest",
    events: "newest",
    births: "newest",
    deaths: "newest",
    holidays: "newest",
  });
  const [cache, setCache] = useState<Record<string, OnThisDayPageResponse>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const requestRef = useRef<AbortController | null>(null);
  const activeOrder = orders[activeCategory];
  const activeKey = cacheKey(activeCategory, activeOrder);
  const activeResponse = cache[activeKey];
  const response =
    activeResponse ??
    Object.values(cache).find(
      (candidate) => candidate.category === activeCategory,
    );
  const metadata = Object.values(cache)[0];

  const load = useCallback(
    async ({
      category,
      order,
      offset,
      append,
    }: {
      category: OnThisDayCategory;
      order: OnThisDayOrder;
      offset: number;
      append: boolean;
    }) => {
      const key = cacheKey(category, order);
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setLoadingKey(key);
      setErrorByKey((current) => ({ ...current, [key]: "" }));
      try {
        const params = new URLSearchParams({
          category,
          order: category === "holidays" ? "newest" : order,
          offset: String(offset),
          limit: "25",
        });
        const result = await fetch(`/api/on-this-day?${params}`, {
          signal: controller.signal,
        });
        if (!result.ok) {
          const body = (await result.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error || "On This Day could not be loaded.");
        }
        const next = (await result.json()) as OnThisDayPageResponse;
        if (controller.signal.aborted) return;
        setCache((current) => {
          const previous = current[key];
          return {
            ...current,
            [key]:
              append && previous
                ? { ...next, items: [...previous.items, ...next.items] }
                : next,
          };
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setErrorByKey((current) => ({
          ...current,
          [key]:
            error instanceof Error
              ? error.message
              : "On This Day could not be loaded.",
        }));
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          setLoadingKey(null);
        }
      }
    },
    [],
  );

  useEffect(() => {
    if (!cache[activeKey] && loadingKey !== activeKey && !errorByKey[activeKey]) {
      void load({
        category: activeCategory,
        order: activeOrder,
        offset: 0,
        append: false,
      });
    }
  }, [activeCategory, activeKey, activeOrder, cache, errorByKey, load, loadingKey]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const availableTabs = ON_THIS_DAY_CATEGORIES.filter(
    (category) => metadata?.availableCategories[category] !== false,
  );

  const activateCategory = (category: OnThisDayCategory) => {
    if (metadata?.availableCategories[category] === false) return;
    if (category !== activeCategory && requestRef.current) {
      requestRef.current.abort();
      requestRef.current = null;
      setLoadingKey(null);
    }
    setActiveCategory(category);
  };

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    category: OnThisDayCategory,
  ) => {
    const currentIndex = availableTabs.indexOf(category);
    let nextCategory: OnThisDayCategory | undefined;
    if (event.key === "ArrowRight") {
      nextCategory = availableTabs[(currentIndex + 1) % availableTabs.length];
    } else if (event.key === "ArrowLeft") {
      nextCategory =
        availableTabs[
          (currentIndex - 1 + availableTabs.length) % availableTabs.length
        ];
    } else if (event.key === "Home") {
      nextCategory = availableTabs[0];
    } else if (event.key === "End") {
      nextCategory = availableTabs.at(-1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activateCategory(category);
      return;
    } else {
      return;
    }
    event.preventDefault();
    if (!nextCategory) return;
    const nextIndex = ON_THIS_DAY_CATEGORIES.indexOf(nextCategory);
    tabRefs.current[nextIndex]?.focus();
  };

  const timelineItems = useMemo(
    () =>
      (response?.items ?? []).map((item, index) => ({
        id: item.id,
        start: {
          display: displayYear(item.year),
          dateTime:
            item.year != null && item.year >= 0
              ? String(item.year).padStart(4, "0")
              : undefined,
          sortKey:
            response?.category === "holidays" || response?.order === "oldest"
              ? index
              : -index,
        },
        content: <TimelineEventContent event={item} />,
      })),
    [response?.category, response?.items, response?.order],
  );

  const timelineOrder: TimelineOrder =
    response?.category === "holidays"
      ? "oldest"
      : (response?.order ?? activeOrder);
  const isLoading = loadingKey === activeKey;
  const error = errorByKey[activeKey];
  const remaining = response ? response.total - response.items.length : 0;
  const editionLabel = formatUtcCalendarDate(metadata?.requestedDate);
  const snapshotLabel = formatUtcCalendarDate(metadata?.snapshotDate);
  const responseCategory = response?.category ?? activeCategory;
  const categoryNouns = CATEGORY_NOUNS[responseCategory];
  const categoryNoun =
    response?.total === 1 ? categoryNouns.singular : categoryNouns.plural;
  const liveStatusMessage = isLoading
    ? `Loading ${categoryNouns.plural}…`
    : error
      ? error
      : response
        ? `Showing ${response.items.length} of ${response.total} ${categoryNoun}${response.category === "holidays" ? "." : `, ${response.order} first.`}`
        : "";

  return (
    <section aria-labelledby="on-this-day-explorer-heading">
      <h2 id="on-this-day-explorer-heading" className="sr-only">
        Explore the day in history
      </h2>
      <p
        id="on-this-day-live-status"
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveStatusMessage}
      </p>
      {metadata ? (
        <div className="on-this-day-edition">
          <p>
            Wikimedia edition for {editionLabel || metadata.requestedDate} (UTC)
          </p>
          {metadata.snapshotIsStale ? (
            <p role="status">
              Today&apos;s update is unavailable, so this is the archived edition
              from {snapshotLabel || metadata.snapshotDate}.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="on-this-day-tabs" role="tablist" aria-label="On This Day categories">
        {ON_THIS_DAY_CATEGORIES.map((category, index) => {
          const selected = activeCategory === category;
          const available = metadata?.availableCategories[category] !== false;
          return (
            <button
              key={category}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              type="button"
              role="tab"
              id={`on-this-day-tab-${category}`}
              aria-controls="on-this-day-tabpanel"
              aria-selected={selected}
              aria-label={
                metadata
                  ? `${CATEGORY_LABELS[category]}, ${metadata.counts[category]} ${metadata.counts[category] === 1 ? "item" : "items"}`
                  : CATEGORY_LABELS[category]
              }
              tabIndex={selected ? 0 : -1}
              disabled={!available}
              onClick={() => activateCategory(category)}
              onKeyDown={(event) => handleTabKeyDown(event, category)}
            >
              <span>{CATEGORY_LABELS[category]}</span>
              {metadata ? <span aria-hidden="true">{metadata.counts[category]}</span> : null}
            </button>
          );
        })}
      </div>

      <div
        id="on-this-day-tabpanel"
        role="tabpanel"
        aria-labelledby={`on-this-day-tab-${activeCategory}`}
        aria-busy={isLoading}
        className="on-this-day-tabpanel"
        tabIndex={0}
      >
        {!response && isLoading ? (
          <div className="on-this-day-loading">
            Loading {CATEGORY_LABELS[activeCategory].toLowerCase()}…
          </div>
        ) : null}
        {!response && error ? (
          <div className="on-this-day-error">
            <p>{error}</p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void load({
                  category: activeCategory,
                  order: activeOrder,
                  offset: 0,
                  append: false,
                })
              }
            >
              Try again
            </button>
          </div>
        ) : null}
        {response ? (
          <>
            <AccessibleTimeline
              items={timelineItems}
              defaultOrder={timelineOrder}
              order={timelineOrder}
              categoryFilter="none"
              showSort={activeCategory !== "holidays"}
              totalCount={response.total}
              announceStatus={false}
              onOrderChange={(order) => {
                if (activeCategory === "holidays") return;
                setOrders((current) => ({
                  ...current,
                  [activeCategory]: order,
                }));
              }}
            />
            <p className="on-this-day-visible-count">
              Showing {response.items.length} of {response.total}{" "}
              {CATEGORY_LABELS[activeCategory].toLowerCase()}.
            </p>
            {response.total > 25 ? (
              <button
                type="button"
                className="btn-secondary on-this-day-show-more"
                aria-disabled={isLoading || response.nextOffset == null}
                onClick={() => {
                  if (isLoading || response.nextOffset == null) return;
                  void load({
                    category: activeCategory,
                    order: activeOrder,
                    offset: response.nextOffset,
                    append: true,
                  });
                }}
              >
                {isLoading
                  ? "Loading more…"
                  : response.nextOffset == null
                    ? `All ${response.total} ${CATEGORY_LABELS[activeCategory].toLowerCase()} shown`
                    : `Show ${Math.min(25, remaining)} more ${CATEGORY_LABELS[activeCategory].toLowerCase()}`}
              </button>
            ) : null}
            {error ? (
              <div className="on-this-day-recoverable-error">
                <p>{error}</p>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    const nextOffset = activeResponse?.nextOffset ?? 0;
                    void load({
                      category: activeCategory,
                      order: activeOrder,
                      offset: nextOffset,
                      append: Boolean(activeResponse && nextOffset > 0),
                    });
                  }}
                >
                  Try loading these {CATEGORY_LABELS[activeCategory].toLowerCase()} again
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      {metadata ? (
        <p className="on-this-day-source-note">
          Event text comes from Wikipedia and is available under{" "}
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noopener noreferrer"
          >
            CC BY-SA 4.0
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          .{" "}
          <a
            href={metadata.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            View the source calendar page
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          .
        </p>
      ) : null}
    </section>
  );
};
