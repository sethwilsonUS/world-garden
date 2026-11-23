import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Suspense } from "react";
import { OnThisDayExplorer } from "@/components/OnThisDayExplorer";
import {
  formatCalendarDay,
  isCanonicalCalendarDaySlug,
  onThisDayPath,
  parseCalendarDaySlug,
} from "@/lib/calendar-day";
import { getInitialOnThisDayPageResponse } from "@/lib/on-this-day-page-data";
import {
  buildOnThisDayHref,
  parseOnThisDayCategory,
  parseOnThisDayOrder,
} from "@/lib/on-this-day-url";

export const dynamic = "force-dynamic";

type OnThisDayCalendarPageProps = {
  params: Promise<{ day: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const firstQueryParam = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ day: string }>;
}): Promise<Metadata> {
  const { day } = await params;
  const parsed = parseCalendarDaySlug(day);
  if (!parsed) {
    return {};
  }

  const label = formatCalendarDay(parsed);
  const canonical = onThisDayPath(parsed);
  const title = `On This Day: ${label} — Curio Garden`;
  const description = `Explore historical events, notable births, deaths, and holidays for ${label} in an accessible timeline on Curio Garden.`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      title: `On This Day: ${label}`,
      description,
      type: "website",
      siteName: "Curio Garden",
      url: canonical,
    },
    twitter: {
      card: "summary_large_image",
      title: `On This Day: ${label}`,
      description,
    },
  };
}

export default async function OnThisDayCalendarPage({
  params,
  searchParams,
}: OnThisDayCalendarPageProps) {
  const { day } = await params;
  const parsed = parseCalendarDaySlug(day);
  if (!parsed) {
    notFound();
  }

  if (!isCanonicalCalendarDaySlug(day, parsed)) {
    const resolvedSearch = searchParams ? await searchParams : undefined;
    const category = parseOnThisDayCategory(
      firstQueryParam(resolvedSearch?.category),
    );
    const order = parseOnThisDayOrder(
      firstQueryParam(resolvedSearch?.order),
      category,
    );
    permanentRedirect(
      buildOnThisDayHref(onThisDayPath(parsed), { category, order }),
    );
  }

  const initialResponse = await getInitialOnThisDayPageResponse(parsed);
  const label = formatCalendarDay(parsed);

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
            initialDay={parsed}
            initialResponse={initialResponse}
          />
        </Suspense>
      </div>
    </div>
  );
}
