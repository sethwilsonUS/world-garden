import type { Metadata } from "next";
import { Suspense } from "react";
import { OnThisDayExplorer } from "@/components/OnThisDayExplorer";
import { calendarDayFromUtcDate, formatCalendarDay } from "@/lib/calendar-day";
import { getInitialOnThisDayPageResponse } from "@/lib/on-this-day-page-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "On This Day — Curio Garden",
  description:
    "Explore today's historical events, births, deaths, and holidays in an accessible timeline.",
  alternates: { canonical: "/on-this-day" },
};

export default async function OnThisDayPage() {
  const utcToday = calendarDayFromUtcDate();
  const initialResponse = await getInitialOnThisDayPageResponse(utcToday);
  const label = formatCalendarDay(utcToday);

  return (
    <div className="on-this-day-page container mx-auto px-4 pb-20 pt-10">
      <div className="mx-auto max-w-5xl">
        <Suspense
          fallback={
            <header className="mb-6">
              <h1 className="type-page-title font-display text-[1.75rem] font-bold text-foreground">
                On This Day: {label}
              </h1>
              <p className="mt-1 max-w-3xl text-base leading-[1.6] text-foreground-2">
                Events, notable lives, and holidays from Wikipedia across the
                centuries.
              </p>
            </header>
          }
        >
          <OnThisDayExplorer
            initialDay={utcToday}
            isTodayRoute
            initialResponse={initialResponse}
          />
        </Suspense>
      </div>
    </div>
  );
}
