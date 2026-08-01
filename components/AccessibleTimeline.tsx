"use client";

import {
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type TimelineOrder = "oldest" | "newest";

export type AccessibleTimelineItem = {
  id: string;
  start: {
    display: string;
    dateTime?: string;
    sortKey: number;
  };
  end?: {
    display: string;
    dateTime?: string;
  };
  category?: string;
  content: ReactNode;
};

export const AccessibleTimeline = ({
  items,
  defaultOrder,
  order: controlledOrder,
  onOrderChange,
  categoryFilter = "auto",
  showSort = true,
  totalCount,
  announceStatus = true,
  showStatus = true,
  statusText,
  statusId,
}: {
  items: AccessibleTimelineItem[];
  defaultOrder: TimelineOrder;
  order?: TimelineOrder;
  onOrderChange?: (order: TimelineOrder) => void;
  categoryFilter?: "auto" | "none";
  showSort?: boolean;
  totalCount?: number;
  announceStatus?: boolean;
  showStatus?: boolean;
  statusText?: string;
  statusId?: string;
}) => {
  const categories = useMemo(
    () =>
      categoryFilter === "none"
        ? []
        : Array.from(
            new Set(
              items
                .map((item) => item.category)
                .filter((value): value is string => Boolean(value)),
            ),
          ),
    [categoryFilter, items],
  );
  const [category, setCategory] = useState("all");
  const [internalOrder, setInternalOrder] = useState(defaultOrder);
  const order = controlledOrder ?? internalOrder;
  const visibleItems = useMemo(() => {
    const selected =
      category === "all"
        ? items
        : items.filter((item) => item.category === category);
    return [...selected].sort((left, right) =>
      order === "oldest"
        ? left.start.sortKey - right.start.sortKey
        : right.start.sortKey - left.start.sortKey,
    );
  }, [category, items, order]);

  const toggleOrder = () => {
    const nextOrder = order === "oldest" ? "newest" : "oldest";
    if (onOrderChange) onOrderChange(nextOrder);
    else setInternalOrder(nextOrder);
  };

  const statusCount =
    category === "all" && totalCount != null ? totalCount : visibleItems.length;

  return (
    <div className="timeline-view">
      {(categories.length > 1 || showSort) && (
        <div className="context-timeline-controls timeline-controls">
          {categories.length > 1 ? (
            <label>
              Show category
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {showSort ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={toggleOrder}
            >
              {order === "oldest" ? "Newest first" : "Oldest first"}
            </button>
          ) : null}
        </div>
      )}
      {showStatus ? (
        <p
          id={statusId}
          className="context-status"
          role={announceStatus ? "status" : undefined}
          aria-live={announceStatus ? "polite" : undefined}
          aria-atomic={announceStatus ? "true" : undefined}
        >
          {statusText ?? (
            <>
              {statusCount} {statusCount === 1 ? "event" : "events"}
              {showSort ? `, ${order} first` : ""}
            </>
          )}
        </p>
      ) : null}
      <ol className="context-timeline-list timeline-list">
        {visibleItems.map((item) => (
          <li key={item.id}>
            <div className="context-timeline-date timeline-date">
              {item.start.dateTime ? (
                <time dateTime={item.start.dateTime}>{item.start.display}</time>
              ) : (
                <span>{item.start.display}</span>
              )}
              {item.end ? (
                <>
                  <span aria-hidden="true"> — </span>
                  <span className="sr-only"> through </span>
                  {item.end.dateTime ? (
                    <time dateTime={item.end.dateTime}>{item.end.display}</time>
                  ) : (
                    <span>{item.end.display}</span>
                  )}
                </>
              ) : null}
            </div>
            <div className="context-timeline-copy timeline-copy">
              {item.content}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
};
