import type { WikimediaMediaAttribution } from "@/lib/wikimedia-media";

export const ON_THIS_DAY_CATEGORIES = [
  "selected",
  "events",
  "births",
  "deaths",
  "holidays",
] as const;

export type OnThisDayCategory = (typeof ON_THIS_DAY_CATEGORIES)[number];
export type OnThisDayOrder = "newest" | "oldest";

export type OnThisDayArticleRef = {
  title: string;
  slug: string;
  wikiPageId?: string;
};

export type OnThisDayImage = {
  source: string;
  width: number;
  height: number;
  articleTitle: string;
  attribution?: WikimediaMediaAttribution;
};

export type OnThisDayEvent = {
  id: string;
  year?: number;
  text: string;
  pages: OnThisDayArticleRef[];
  image?: OnThisDayImage;
};

export type OnThisDayCategoryMap<T> = Record<OnThisDayCategory, T>;

export type OnThisDaySnapshot = {
  schemaVersion: 1;
  provider: "wikifeeds-v1" | "featured-fallback";
  feedDate: string;
  monthDay: string;
  generatedAt: number;
  sourceUrl: string;
  categories: OnThisDayCategoryMap<OnThisDayEvent[]>;
  counts: OnThisDayCategoryMap<number>;
  availableCategories: OnThisDayCategoryMap<boolean>;
};

export type OnThisDayPageResponse = {
  requestedDate: string;
  snapshotDate: string;
  snapshotIsStale: boolean;
  provider: OnThisDaySnapshot["provider"];
  sourceUrl: string;
  category: OnThisDayCategory;
  order: OnThisDayOrder;
  offset: number;
  limit: number;
  total: number;
  nextOffset: number | null;
  counts: OnThisDayCategoryMap<number>;
  availableCategories: OnThisDayCategoryMap<boolean>;
  items: OnThisDayEvent[];
};
