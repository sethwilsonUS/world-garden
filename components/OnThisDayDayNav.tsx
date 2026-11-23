"use client";

import Link from "next/link";
import type { RefObject } from "react";
import {
  formatCalendarDay,
  nextCalendarDay,
  onThisDayPath,
  previousCalendarDay,
  type CalendarDay,
} from "@/lib/calendar-day";
import type {
  OnThisDayCategory,
  OnThisDayOrder,
} from "@/lib/on-this-day-contracts";
import { buildOnThisDayHref } from "@/lib/on-this-day-url";
import type { OnThisDayNavControl } from "./OnThisDaySessionProvider";

export type OnThisDayDayNavProps = {
  day: CalendarDay;
  category: OnThisDayCategory;
  order: OnThisDayOrder;
  pickerOpen: boolean;
  onOpenPicker: () => void;
  onNavigateDay: (control: Exclude<OnThisDayNavControl, "picker">) => void;
  previousLinkRef: RefObject<HTMLAnchorElement | null>;
  nextLinkRef: RefObject<HTMLAnchorElement | null>;
  pickerTriggerRef: RefObject<HTMLButtonElement | null>;
};

export const OnThisDayDayNav = ({
  day,
  category,
  order,
  pickerOpen,
  onOpenPicker,
  onNavigateDay,
  previousLinkRef,
  nextLinkRef,
  pickerTriggerRef,
}: OnThisDayDayNavProps) => {
  const prevDay = previousCalendarDay(day);
  const nextDay = nextCalendarDay(day);
  const currentLabel = formatCalendarDay(day);
  const prevLabel = formatCalendarDay(prevDay);
  const nextLabel = formatCalendarDay(nextDay);
  const prevHref = buildOnThisDayHref(onThisDayPath(prevDay), {
    category,
    order,
  });
  const nextHref = buildOnThisDayHref(onThisDayPath(nextDay), {
    category,
    order,
  });

  return (
    <nav aria-label="Calendar day navigation" className="on-this-day-nav">
      <Link
        ref={previousLinkRef}
        href={prevHref}
        scroll={false}
        className="btn-secondary on-this-day-nav-link"
        onClick={() => onNavigateDay("previous")}
      >
        <span aria-hidden="true">‹ </span>
        <span>Previous: {prevLabel}</span>
      </Link>

      <button
        ref={pickerTriggerRef}
        type="button"
        className="btn-secondary on-this-day-nav-picker"
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        aria-label={`Choose a day, currently ${currentLabel}`}
        onClick={onOpenPicker}
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
          <rect x="3" y="4" width="18" height="17" rx="2" />
          <path d="M8 2v4" />
          <path d="M16 2v4" />
          <path d="M3 10h18" />
        </svg>
        <span>Choose a day</span>
      </button>

      <Link
        ref={nextLinkRef}
        href={nextHref}
        scroll={false}
        className="btn-secondary on-this-day-nav-link"
        onClick={() => onNavigateDay("next")}
      >
        <span>Next: {nextLabel}</span>
        <span aria-hidden="true"> ›</span>
      </Link>
    </nav>
  );
};
