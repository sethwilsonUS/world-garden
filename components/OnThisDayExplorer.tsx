"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  calendarDayFromLocalDate,
  calendarDayFromUtcDate,
  calendarDayKey,
  formatCalendarDay,
  isSameCalendarDay,
  onThisDayPath,
  type CalendarDay,
} from "@/lib/calendar-day";
import {
  ON_THIS_DAY_CATEGORIES,
  type OnThisDayCategory,
  type OnThisDayEvent,
  type OnThisDayOrder,
  type OnThisDayPageResponse,
} from "@/lib/on-this-day-contracts";
import {
  buildOnThisDayHref,
  parseOnThisDayCategory,
  parseOnThisDayOrder,
} from "@/lib/on-this-day-url";
import { AccessibleTimeline, type TimelineOrder } from "./AccessibleTimeline";
import { AdaptiveImageFrame } from "./AdaptiveImageFrame";
import { ArticleLink } from "./ArticleLink";
import { CalendarDayPicker } from "./CalendarDayPicker";
import { MediaAttribution } from "./MediaAttribution";
import { OnThisDayDayNav } from "./OnThisDayDayNav";
import {
  useOnThisDaySession,
  type OnThisDayNavControl,
} from "./OnThisDaySessionProvider";

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
  dayKey: string,
  category: OnThisDayCategory,
  order: OnThisDayOrder,
): string => `${dayKey}:${category}:${category === "holidays" ? "newest" : order}`;

const isNewerServerSnapshot = (
  incoming: OnThisDayPageResponse,
  existing: OnThisDayPageResponse | undefined,
): boolean => {
  if (!existing) return true;
  if (incoming.changedAt > existing.changedAt) return true;
  if (existing.degraded && !incoming.degraded) return true;
  return false;
};

const mergeInitialResponseIntoCache = (
  current: Record<string, OnThisDayPageResponse>,
  incoming: OnThisDayPageResponse,
  incomingKey: string,
): Record<string, OnThisDayPageResponse> => {
  const existing = current[incomingKey];
  if (existing && !isNewerServerSnapshot(incoming, existing)) {
    return current;
  }

  const dayPrefix = `${incoming.calendarDay}:`;
  const anyExistingForDay =
    existing ??
    Object.values(current).find(
      (entry) => entry.calendarDay === incoming.calendarDay,
    );
  const supersedesDay =
    anyExistingForDay !== undefined &&
    isNewerServerSnapshot(incoming, anyExistingForDay);

  if (!supersedesDay) {
    return { ...current, [incomingKey]: incoming };
  }

  const next: Record<string, OnThisDayPageResponse> = {};
  for (const [key, entry] of Object.entries(current)) {
    if (!key.startsWith(dayPrefix)) {
      next[key] = entry;
    }
  }
  next[incomingKey] = incoming;
  return next;
};

const displayYear = (year: number | undefined): string => {
  if (year == null) return "Annual";
  return year < 0 ? `${Math.abs(year)} BCE` : String(year);
};

const formatCheckedDate = (timestampMs: number): string => {
  if (!Number.isFinite(timestampMs)) return "";
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const TimelineEventContent = ({ event }: { event: OnThisDayEvent }) => (
  <article
    className={
      event.image ? "on-this-day-event has-image" : "on-this-day-event"
    }
  >
    <div className="min-w-0">
      <p className="on-this-day-event-text">{event.text}</p>
      {event.pages.length > 0 ? (
        <ul className="on-this-day-event-links" aria-label="Related articles">
          {event.pages.map((page) => (
            <li key={`${page.wikiPageId ?? page.slug}-${page.title}`}>
              <ArticleLink
                articleTitle={page.title}
                href={`/article/${encodeURIComponent(page.slug)}`}
                className="text-sm!"
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
          alt={event.image.altText ?? ""}
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

export type OnThisDayExplorerProps = {
  initialDay?: CalendarDay;
  isTodayRoute?: boolean;
  initialResponse?: OnThisDayPageResponse | null;
};

export const OnThisDayExplorer = ({
  initialDay,
  isTodayRoute = false,
  initialResponse = null,
}: OnThisDayExplorerProps = {}) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const session = useOnThisDaySession();

  const resolvedInitialDay = useMemo(
    () => initialDay ?? calendarDayFromUtcDate(),
    [initialDay],
  );
  const [activeDay, setActiveDay] = useState<CalendarDay>(resolvedInitialDay);
  const [readersToday, setReadersToday] = useState<CalendarDay | null>(null);
  const [clientMounted, setClientMounted] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const initialCategory = parseOnThisDayCategory(searchParams?.get("category"));
  const initialOrder = parseOnThisDayOrder(
    searchParams?.get("order"),
    initialCategory,
  );

  const [activeCategory, setActiveCategory] =
    useState<OnThisDayCategory>(initialCategory);
  const [orders, setOrders] = useState<
    Record<OnThisDayCategory, OnThisDayOrder>
  >(() => ({
    selected: initialCategory === "selected" ? initialOrder : "newest",
    events: initialCategory === "events" ? initialOrder : "newest",
    births: initialCategory === "births" ? initialOrder : "newest",
    deaths: initialCategory === "deaths" ? initialOrder : "newest",
    holidays: "newest",
  }));

  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [errorByKey, setErrorByKey] = useState<Record<string, string>>({});
  const [dayAnnouncement, setDayAnnouncement] = useState<string | null>(null);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const previousLinkRef = useRef<HTMLAnchorElement | null>(null);
  const nextLinkRef = useRef<HTMLAnchorElement | null>(null);
  const pickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestKeyRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  // Sync activeDay if prop changes (e.g. reused component instance across routes).
  useEffect(() => {
    setActiveDay((current) =>
      isTodayRoute && readersToday
        ? readersToday
        : isSameCalendarDay(current, resolvedInitialDay)
          ? current
          : resolvedInitialDay,
    );
  }, [isTodayRoute, readersToday, resolvedInitialDay]);

  // Resolve Reader's Today after mount to prevent hydration mismatches.
  useEffect(() => {
    const localToday = calendarDayFromLocalDate();
    setReadersToday(localToday);
    setClientMounted(true);
    if (isTodayRoute && !isSameCalendarDay(localToday, resolvedInitialDay)) {
      setActiveDay(localToday);
    }
  }, [isTodayRoute, resolvedInitialDay]);

  // Keep view state synchronized with browser Back/Forward query updates.
  const searchParamsString = searchParams?.toString() ?? "";
  useEffect(() => {
    const parsedParams = new URLSearchParams(searchParamsString);
    const nextCategory = parseOnThisDayCategory(parsedParams.get("category"));
    const nextOrder = parseOnThisDayOrder(
      parsedParams.get("order"),
      nextCategory,
    );
    setActiveCategory(nextCategory);
    if (nextCategory !== "holidays") {
      setOrders((current) =>
        current[nextCategory] === nextOrder
          ? current
          : { ...current, [nextCategory]: nextOrder },
      );
    }
  }, [searchParamsString]);

  // Seed or refresh shared cache with server-provided initialResponse when newer.
  const initialResponseKey = initialResponse
    ? cacheKey(
        initialResponse.calendarDay,
        initialResponse.category,
        initialResponse.order,
      )
    : null;
  useEffect(() => {
    if (!initialResponse || !initialResponseKey) return;
    session.setCache((current) =>
      mergeInitialResponseIntoCache(current, initialResponse, initialResponseKey),
    );
  }, [initialResponse, initialResponseKey, session]);

  const dayKey = calendarDayKey(activeDay);
  const dayLabel = formatCalendarDay(activeDay);
  const activeOrder = orders[activeCategory];
  const activeKey = cacheKey(dayKey, activeCategory, activeOrder);

  const effectiveCache = useMemo(() => {
    if (!initialResponse || !initialResponseKey) return session.cache;
    return mergeInitialResponseIntoCache(
      session.cache,
      initialResponse,
      initialResponseKey,
    );
  }, [initialResponse, initialResponseKey, session.cache]);

  const effectiveCacheRef = useRef(effectiveCache);
  useLayoutEffect(() => {
    effectiveCacheRef.current = effectiveCache;
  }, [effectiveCache]);

  const activeResponse = effectiveCache[activeKey];
  const response =
    activeResponse ??
    Object.values(effectiveCache).find(
      (candidate) =>
        candidate.calendarDay === dayKey &&
        candidate.category === activeCategory,
    );
  const metadata =
    activeResponse ??
    response ??
    Object.values(effectiveCache).find(
      (candidate) => candidate.calendarDay === dayKey,
    );

  // Restore focus to the pressed day-navigation control across route transitions.
  useLayoutEffect(() => {
    const pendingControl = session.pendingFocusControlRef.current;
    if (!pendingControl) return;
    session.pendingFocusControlRef.current = null;
    if (pendingControl === "previous") {
      previousLinkRef.current?.focus({ preventScroll: true });
    } else if (pendingControl === "next") {
      nextLinkRef.current?.focus({ preventScroll: true });
    } else if (pendingControl === "picker") {
      pickerTriggerRef.current?.focus({ preventScroll: true });
    }
  }, [dayKey, session.pendingFocusControlRef]);

  const syncViewStateToUrl = useCallback(
    (category: OnThisDayCategory, order: OnThisDayOrder) => {
      if (typeof window === "undefined") return;
      const basePath = pathname || window.location.pathname;
      const nextHref = buildOnThisDayHref(basePath, { category, order });
      const currentHref = `${window.location.pathname}${window.location.search}`;
      if (nextHref !== currentHref) {
        window.history.replaceState(window.history.state, "", nextHref);
      }
    },
    [pathname],
  );

  const load = useCallback(
    async ({
      targetDayKey,
      category,
      order,
      offset,
      append,
    }: {
      targetDayKey: string;
      category: OnThisDayCategory;
      order: OnThisDayOrder;
      offset: number;
      append: boolean;
    }) => {
      const key = cacheKey(targetDayKey, category, order);
      const requestKey = `${key}:${offset}:${append ? "append" : "replace"}`;
      if (requestRef.current && requestKeyRef.current === requestKey) return;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      requestKeyRef.current = requestKey;
      setLoadingKey(key);
      setErrorByKey((current) => ({ ...current, [key]: "" }));
      try {
        const params = new URLSearchParams({
          day: targetDayKey,
          category,
          order: category === "holidays" ? "newest" : order,
          offset: String(offset),
          limit: "25",
        });
        const result = await fetch(`/api/on-this-day?${params}`, {
          signal: controller.signal,
        });
        if (!result.ok) {
          const body = (await result.json().catch(() => null)) as {
            error?: string;
          } | null;
          throw new Error(body?.error || "This day isn't available right now.");
        }
        const next = (await result.json()) as OnThisDayPageResponse;
        if (controller.signal.aborted) return;

        const latestCache = effectiveCacheRef.current;
        const latestDayEntry = Object.values(latestCache).find(
          (entry) => entry.calendarDay === targetDayKey,
        );
        const isSupersededByDay =
          latestDayEntry != null &&
          (next.changedAt < latestDayEntry.changedAt ||
            (!latestDayEntry.degraded && next.degraded));

        if (!append && isSupersededByDay) {
          // Terminal state for a stale/degraded non-append response so the
          // automatic loader does not loop endlessly against a cached/degraded edge.
          setErrorByKey((current) => ({
            ...current,
            [key]: "This section is updating. Try again in a moment.",
          }));
          return;
        }

        session.setCache((current) => {
          const previous = current[key];
          const existingDayEntry = Object.values(current).find(
            (entry) => entry.calendarDay === targetDayKey,
          );
          if (
            existingDayEntry &&
            (next.changedAt < existingDayEntry.changedAt ||
              (!existingDayEntry.degraded && next.degraded))
          ) {
            return current;
          }
          if (append) {
            if (!previous) {
              // The day's cache was replaced while this page was in flight;
              // drop the trailing slice so the explorer reloads from offset 0.
              return current;
            }
            if (
              previous.changedAt !== next.changedAt ||
              previous.degraded !== next.degraded
            ) {
              // Server snapshot rolled over mid-pagination; drop the key so
              // the explorer reloads a consistent list from offset 0.
              const nextCache = { ...current };
              delete nextCache[key];
              return nextCache;
            }
            return {
              ...current,
              [key]: { ...next, items: [...previous.items, ...next.items] },
            };
          }
          return {
            ...current,
            [key]: next,
          };
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setErrorByKey((current) => ({
          ...current,
          [key]:
            error instanceof Error
              ? error.message
              : "This day isn't available right now.",
        }));
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
          requestKeyRef.current = null;
          setLoadingKey(null);
        }
      }
    },
    [session],
  );

  // On bare /on-this-day without SSR data, wait until Reader's Today is resolved
  // on mount so we don't fire a wasted UTC request before switching to local today.
  const waitingForLocalToday = isTodayRoute && !clientMounted && !initialResponse;

  useEffect(() => {
    if (waitingForLocalToday) return;
    if (
      !effectiveCache[activeKey] &&
      loadingKey !== activeKey &&
      !errorByKey[activeKey]
    ) {
      void load({
        targetDayKey: dayKey,
        category: activeCategory,
        order: activeOrder,
        offset: 0,
        append: false,
      });
    }
  }, [
    activeCategory,
    activeKey,
    activeOrder,
    dayKey,
    effectiveCache,
    errorByKey,
    load,
    loadingKey,
    waitingForLocalToday,
  ]);

  // Announce day changes once the new day's data is available, after mount so
  // screen readers reliably speak the update.
  useEffect(() => {
    if (!session.pendingDayAnnouncementRef.current) return;
    if (!activeResponse || activeResponse.calendarDay !== dayKey) return;
    session.pendingDayAnnouncementRef.current = false;
    const label = CATEGORY_LABELS[activeResponse.category];
    const total = activeResponse.total;
    setDayAnnouncement(
      `Now showing ${dayLabel}, ${label}, ${total} ${total === 1 ? "item" : "items"}.`,
    );
  }, [activeResponse, dayKey, dayLabel, session.pendingDayAnnouncementRef]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (mountedRef.current) return;
        requestRef.current?.abort();
        requestRef.current = null;
        requestKeyRef.current = null;
      });
    };
  }, []);

  useEffect(() => {
    const selectedIndex = ON_THIS_DAY_CATEGORIES.indexOf(activeCategory);
    const selectedTab = tabRefs.current[selectedIndex];
    const tabList = selectedTab?.parentElement;
    if (!selectedTab || !tabList) return;

    const tabStart = selectedTab.offsetLeft;
    const tabEnd = tabStart + selectedTab.offsetWidth;
    const visibleStart = tabList.scrollLeft;
    const visibleEnd = visibleStart + tabList.clientWidth;
    const nextLeft =
      tabStart < visibleStart
        ? tabStart
        : tabEnd > visibleEnd
          ? tabEnd - tabList.clientWidth
          : visibleStart;
    if (nextLeft !== visibleStart) tabList.scrollLeft = Math.max(0, nextLeft);
  }, [activeCategory]);

  const availableTabs = ON_THIS_DAY_CATEGORIES.filter(
    (category) => metadata?.availableCategories[category] !== false,
  );
  const fallbackAvailableCategory = availableTabs[0] ?? "selected";
  const activeCategoryUnavailable =
    metadata?.availableCategories[activeCategory] === false;

  useEffect(() => {
    if (!activeCategoryUnavailable) return;
    if (fallbackAvailableCategory === activeCategory) return;
    setActiveCategory(fallbackAvailableCategory);
    syncViewStateToUrl(
      fallbackAvailableCategory,
      orders[fallbackAvailableCategory],
    );
  }, [
    activeCategory,
    activeCategoryUnavailable,
    fallbackAvailableCategory,
    orders,
    syncViewStateToUrl,
  ]);

  const tabStopCategory = activeCategoryUnavailable
    ? fallbackAvailableCategory
    : activeCategory;

  const activateCategory = (category: OnThisDayCategory) => {
    if (metadata?.availableCategories[category] === false) return;
    if (category !== activeCategory && requestRef.current) {
      requestRef.current.abort();
      requestRef.current = null;
      requestKeyRef.current = null;
      setLoadingKey(null);
    }
    setDayAnnouncement(null);
    setActiveCategory(category);
    syncViewStateToUrl(category, orders[category]);
  };

  const handleOrderChange = (order: OnThisDayOrder) => {
    if (activeCategory === "holidays") return;
    setDayAnnouncement(null);
    setOrders((current) => ({
      ...current,
      [activeCategory]: order,
    }));
    syncViewStateToUrl(activeCategory, order);
  };

  const handleNavigateDayLink = (
    control: Exclude<OnThisDayNavControl, "picker">,
  ) => {
    session.pendingFocusControlRef.current = control;
    session.pendingDayAnnouncementRef.current = true;
  };

  const handleSelectPickerDay = (selected: CalendarDay) => {
    setPickerOpen(false);
    const targetPath = onThisDayPath(selected);
    const targetHref = buildOnThisDayHref(targetPath, {
      category: activeCategory,
      order: activeOrder,
    });
    if (
      isSameCalendarDay(selected, activeDay) &&
      pathname === targetPath
    ) {
      pickerTriggerRef.current?.focus({ preventScroll: true });
      return;
    }
    session.pendingFocusControlRef.current = "picker";
    session.pendingDayAnnouncementRef.current = true;
    router.push(targetHref, { scroll: false });
  };

  const handleClosePicker = () => {
    setPickerOpen(false);
    pickerTriggerRef.current?.focus({ preventScroll: true });
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
  const responseCategory = response?.category ?? activeCategory;
  const categoryNouns = CATEGORY_NOUNS[responseCategory];
  const categoryNoun =
    response?.total === 1 ? categoryNouns.singular : categoryNouns.plural;
  const liveStatusMessage = isLoading
    ? `Loading ${categoryNouns.plural}…`
    : error
      ? error
      : dayAnnouncement
        ? dayAnnouncement
        : response
          ? `Showing ${response.items.length} of ${response.total} ${categoryNoun}${response.category === "holidays" ? "." : `, ${response.order} first.`}`
          : "";

  const checkedDateLabel =
    clientMounted && metadata?.checkedAt
      ? formatCheckedDate(metadata.checkedAt)
      : "";

  return (
    <>
      <header className="mb-6">
        <h1 className="type-page-title font-display text-[1.75rem] font-bold text-foreground">
          On This Day: {dayLabel}
        </h1>
        <p className="mt-1 max-w-3xl text-base leading-[1.6] text-foreground-2">
          Events, notable lives, and holidays from Wikipedia across the
          centuries.
        </p>

        <OnThisDayDayNav
          day={activeDay}
          category={activeCategory}
          order={activeOrder}
          pickerOpen={pickerOpen}
          onOpenPicker={() => setPickerOpen(true)}
          onNavigateDay={handleNavigateDayLink}
          previousLinkRef={previousLinkRef}
          nextLinkRef={nextLinkRef}
          pickerTriggerRef={pickerTriggerRef}
        />
      </header>

      <CalendarDayPicker
        open={pickerOpen}
        selectedDay={activeDay}
        readersToday={readersToday}
        onSelectDay={handleSelectPickerDay}
        onClose={handleClosePicker}
      />

      <section aria-labelledby="on-this-day-explorer-heading">
        <h2 id="on-this-day-explorer-heading" className="sr-only">
          Explore the day in history
        </h2>

        {metadata?.degraded ? (
          <p className="on-this-day-degraded-status" role="status">
            Only highlights are available for this day right now.
          </p>
        ) : null}

        <div
          className="on-this-day-tabs"
          role="tablist"
          aria-label="On This Day categories"
        >
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
                    ? `${CATEGORY_LABELS[category]} ${metadata.counts[category]} ${metadata.counts[category] === 1 ? "item" : "items"}`
                    : CATEGORY_LABELS[category]
                }
                tabIndex={category === tabStopCategory ? 0 : -1}
                disabled={!available}
                onClick={() => activateCategory(category)}
                onKeyDown={(event) => handleTabKeyDown(event, category)}
              >
                <span>{`${CATEGORY_LABELS[category]} `}</span>
                {metadata ? (
                  <span aria-hidden="true">{metadata.counts[category]}</span>
                ) : null}
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
          <p
            id="on-this-day-live-status"
            className={response ? "context-status" : "sr-only"}
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {liveStatusMessage}
          </p>
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
                    targetDayKey: dayKey,
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
                showStatus={false}
                onOrderChange={handleOrderChange}
              />
              {response.total > 25 ? (
                <button
                  type="button"
                  className="btn-secondary on-this-day-show-more"
                  aria-disabled={isLoading || response.nextOffset == null}
                  onClick={() => {
                    if (isLoading || response.nextOffset == null) return;
                    setDayAnnouncement(null);
                    void load({
                      targetDayKey: dayKey,
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
                        targetDayKey: dayKey,
                        category: activeCategory,
                        order: activeOrder,
                        offset: nextOffset,
                        append: Boolean(activeResponse && nextOffset > 0),
                      });
                    }}
                  >
                    Try loading these{" "}
                    {CATEGORY_LABELS[activeCategory].toLowerCase()} again
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {metadata ? (
          <p className="on-this-day-source-note">
            {checkedDateLabel
              ? `Lists from Wikipedia, last checked ${checkedDateLabel}. `
              : "Lists from Wikipedia. "}
            Event text is available under{" "}
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
    </>
  );
};
