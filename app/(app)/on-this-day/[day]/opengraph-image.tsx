import { notFound } from "next/navigation";
import { formatCalendarDay, parseCalendarDaySlug } from "@/lib/calendar-day";
import { ON_THIS_DAY_OG_SIZE, renderOnThisDayOgImage } from "../og-card";

export const alt =
  "On This Day — Historical events, notable lives, and holidays at Curio Garden";
export const size = ON_THIS_DAY_OG_SIZE;
export const contentType = "image/png";

export default async function OnThisDayCalendarOgImage({
  params,
}: {
  params: Promise<{ day: string }>;
}) {
  const { day } = await params;
  const parsed = parseCalendarDaySlug(day);
  if (!parsed) {
    notFound();
  }

  return await renderOnThisDayOgImage({
    dayLabel: formatCalendarDay(parsed),
  });
}
