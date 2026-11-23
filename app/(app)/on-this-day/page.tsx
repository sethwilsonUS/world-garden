import type { Metadata } from "next";
import { Suspense } from "react";
import { OnThisDayExplorer } from "@/components/OnThisDayExplorer";
import { calendarDayFromUtcDate, formatCalendarDay } from "@/lib/calendar-day";
import { getInitialOnThisDayPageResponse } from "@/lib/on-this-day-page-data";

export const dynamic = "force-dynamic";

const ON_THIS_DAY_TITLE = "On This Day — Curio Garden";
const ON_THIS_DAY_DESCRIPTION =
  "Explore historical events, notable lives, and holidays from any day of the year — and listen to the stories behind them on Curio Garden.";

export const metadata: Metadata = {
  title: ON_THIS_DAY_TITLE,
  description: ON_THIS_DAY_DESCRIPTION,
  alternates: { canonical: "/on-this-day" },
  openGraph: {
    title: ON_THIS_DAY_TITLE,
    description: ON_THIS_DAY_DESCRIPTION,
    type: "website",
    siteName: "Curio Garden",
    url: "/on-this-day",
  },
  twitter: {
    card: "summary_large_image",
    title: ON_THIS_DAY_TITLE,
    description: ON_THIS_DAY_DESCRIPTION,
  },
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
