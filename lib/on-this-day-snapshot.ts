import { anyApi } from "convex/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import {
  buildFeaturedOnThisDayFallback,
  buildOnThisDaySnapshot,
} from "@/lib/on-this-day";
import type { OnThisDaySnapshot } from "@/lib/on-this-day-contracts";
import { createPublicAudioWriteAttestation } from "@/lib/public-audio-write-attestation";
import { getTodayWikipediaData } from "@/lib/today-snapshot";

type OnThisDaySnapshotRecord = {
  feedDate: string;
  monthDay: string;
  data: OnThisDaySnapshot;
  generatedAt: number;
  createdAt: number;
  updatedAt: number;
};

const shouldUseSnapshotCache = (): boolean =>
  process.env.NEXT_PUBLIC_LOCAL_MODE !== "true" &&
  Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

export const resolveOnThisDayFeedDate = (now = new Date()): string =>
  `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;

const getMonthDay = (feedDate: string): string => {
  const match = feedDate.match(/^\d{4}-(\d{2})-(\d{2})$/u);
  if (!match) throw new Error("On This Day date must use YYYY-MM-DD.");
  return `${match[1]}-${match[2]}`;
};

const getExactSnapshot = async (
  feedDate: string,
): Promise<OnThisDaySnapshot | null> => {
  if (!shouldUseSnapshotCache()) return null;
  const record = (await fetchQuery(
    anyApi.onThisDay.getOnThisDaySnapshotByDate,
    { feedDate },
  )) as OnThisDaySnapshotRecord | null;
  return record?.data ?? null;
};

const getLatestMonthDaySnapshot = async (
  monthDay: string,
): Promise<OnThisDaySnapshot | null> => {
  if (!shouldUseSnapshotCache()) return null;
  const record = (await fetchQuery(
    anyApi.onThisDay.getLatestOnThisDaySnapshotForMonthDay,
    { monthDay },
  )) as OnThisDaySnapshotRecord | null;
  return record?.data ?? null;
};

const getFeaturedFallback = async (
  feedDate: string,
): Promise<OnThisDaySnapshot | null> => {
  const today = await getTodayWikipediaData({
    allowLiveFallback: false,
    feedDateIso: feedDate,
  });
  if (!today || today.onThisDay.length === 0) return null;
  return buildFeaturedOnThisDayFallback({
    feedDate,
    items: today.onThisDay,
  });
};

export const getOnThisDaySnapshot = async ({
  requestedDate,
  allowLiveFallback = false,
  now = new Date(),
}: {
  requestedDate?: string;
  allowLiveFallback?: boolean;
  now?: Date;
} = {}): Promise<OnThisDaySnapshot | null> => {
  const currentDate = resolveOnThisDayFeedDate(now);
  const feedDate = requestedDate ?? currentDate;
  const exact = await getExactSnapshot(feedDate);
  if (exact) return exact;

  if (feedDate !== currentDate) return null;

  if (allowLiveFallback) {
    try {
      return await buildOnThisDaySnapshot({ feedDate });
    } catch {
      const featured = await getFeaturedFallback(feedDate).catch(() => null);
      if (featured) return featured;
    }
  }

  return getLatestMonthDaySnapshot(getMonthDay(feedDate));
};

const saveOnThisDaySnapshot = async (
  data: OnThisDaySnapshot,
): Promise<void> => {
  if (!shouldUseSnapshotCache()) return;
  const writeArgs = {
    feedDate: data.feedDate,
    monthDay: data.monthDay,
    data,
    generatedAt: data.generatedAt,
  };
  const attestation = await createPublicAudioWriteAttestation({
    pipeline: "on-this-day",
    operation: "save-record",
    args: writeArgs,
  });
  await fetchMutation(anyApi.onThisDay.saveOnThisDaySnapshot, {
    ...writeArgs,
    attestation,
  });
};

export const syncOnThisDaySnapshot = async ({
  feedDate = resolveOnThisDayFeedDate(),
}: {
  feedDate?: string;
} = {}): Promise<OnThisDaySnapshot> => {
  let snapshot: OnThisDaySnapshot;
  try {
    snapshot = await buildOnThisDaySnapshot({ feedDate });
  } catch (error) {
    const fallback = await getFeaturedFallback(feedDate).catch(() => null);
    if (!fallback) throw error;
    snapshot = fallback;
  }
  await saveOnThisDaySnapshot(snapshot);
  return snapshot;
};
