import type { MetadataRoute } from "next";
import {
  ALL_CALENDAR_DAYS,
  calendarDayKey,
  onThisDayPath,
} from "@/lib/calendar-day";
import { listOnThisDayRefreshStates } from "@/lib/on-this-day-snapshot";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = (
    process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  ).replace(/\/+$/u, "");

  const indexablePaths = [
    "",
    "/on-this-day",
    "/trending",
    "/podcasts",
    "/podcasts/featured",
    "/podcasts/trending",
    "/about",
    "/feedback",
    "/privacy",
    "/terms",
  ];

  const states = await listOnThisDayRefreshStates();
  const lastModifiedByDay = new Map<string, Date>(
    states
      .filter((state) => state.changedAt > 0)
      .map((state) => [state.monthDay, new Date(state.changedAt)]),
  );

  const staticEntries: MetadataRoute.Sitemap = indexablePaths.map((path) => ({
    url: `${siteUrl}${path}`,
  }));

  const calendarDayEntries: MetadataRoute.Sitemap = ALL_CALENDAR_DAYS.map(
    (day) => {
      const lastModified = lastModifiedByDay.get(calendarDayKey(day));
      return {
        url: `${siteUrl}${onThisDayPath(day)}`,
        ...(lastModified ? { lastModified } : {}),
      };
    },
  );

  return [...staticEntries, ...calendarDayEntries];
}
