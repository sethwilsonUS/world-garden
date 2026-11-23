import type {
  OnThisDayCategory,
  OnThisDayEvent,
  OnThisDaySnapshot,
} from "@/lib/on-this-day-contracts";
import {
  getWikimediaFileTitleFromUrl,
  getWikimediaMediaIdentity,
  getWikimediaMediaRepositoryFromUrl,
  isWikimediaMediaHostname,
} from "@/lib/wikimedia-media";

export const DEFAULT_MAX_SHARE_CARD_CANDIDATES = 8;
export const DEFAULT_MAX_SHARE_CARD_PLATES = 5;
export const MIN_SHARE_CARD_PLATE_DIMENSION = 160;
export const MIN_SHARE_CARD_PLATE_ASPECT_RATIO = 0.45;
export const MAX_SHARE_CARD_PLATE_ASPECT_RATIO = 2.35;
export const HERO_PLATE_MIN_ASPECT_RATIO = 0.9;

export type ShareCardLicenseTier = "pd-cc0" | "commons-other";

export type ShareCardEraBucket =
  | "pre-1500"
  | "1500-1799"
  | "1800-1899"
  | "1900-1949"
  | "1950-1999"
  | "2000-plus"
  | "undated";

export type ShareCardPlateCandidate = {
  eventId: string;
  category: OnThisDayCategory;
  year?: number;
  yearLabel?: string;
  articleTitle: string;
  alt: string;
  imageUrl: string;
  mediaIdentity: string;
  width: number;
  height: number;
  isPortrait: boolean;
  licenseTier: ShareCardLicenseTier;
  eraBucket: ShareCardEraBucket;
  licenseName?: string;
  creator?: string;
  sourceUrl?: string;
  attributionIsFallback?: boolean;
};

export type SelectShareCardPlateCandidatesOptions = {
  maxCandidates?: number;
};

type PrimaryOnThisDayCategory = Exclude<OnThisDayCategory, "holidays">;
type DatedShareCardEraBucket = Exclude<ShareCardEraBucket, "undated">;

const PRIMARY_CATEGORIES: readonly PrimaryOnThisDayCategory[] = [
  "selected",
  "events",
  "births",
  "deaths",
];

const CATEGORY_PRIORITY: Readonly<Record<OnThisDayCategory, number>> = {
  selected: 0,
  events: 1,
  births: 2,
  deaths: 3,
  holidays: 4,
};

const DATED_ERA_BUCKETS: readonly DatedShareCardEraBucket[] = [
  "pre-1500",
  "1500-1799",
  "1800-1899",
  "1900-1949",
  "1950-1999",
  "2000-plus",
];

const ERA_BUCKET_PRIORITY: Readonly<Record<ShareCardEraBucket, number>> = {
  "pre-1500": 0,
  "1500-1799": 1,
  "1800-1899": 2,
  "1900-1949": 3,
  "1950-1999": 4,
  "2000-plus": 5,
  undated: 6,
};

const SUBTITLE_CATEGORIES: readonly {
  category: Exclude<OnThisDayCategory, "selected">;
  singular: string;
  plural: string;
}[] = [
  { category: "events", singular: "event", plural: "events" },
  { category: "births", singular: "birth", plural: "births" },
  { category: "deaths", singular: "death", plural: "deaths" },
  { category: "holidays", singular: "holiday", plural: "holidays" },
];

const PORTRAIT_PREFERRED_SLOT_INDICES: readonly number[] = [2, 4];

const SVG_EXTENSION_PATTERN = /\.svg(?:\.[a-z0-9]+)?$/iu;
const PUBLIC_DOMAIN_LICENSE_PATTERNS: readonly RegExp[] = [
  /\bpublic[\s-]+domain\b/u,
  /(?<!non-)\bpd\b/u,
  /\bcc[\s-]?0\b/u,
  /\bcc[\s-]?zero\b/u,
  /\bno[\s-]+known[\s-]+copyright\b/u,
];

const normalizeWholeYear = (year: number | undefined): number | undefined => {
  if (typeof year !== "number" || !Number.isFinite(year)) {
    return undefined;
  }
  const wholeYear = Math.trunc(year);
  return wholeYear === 0 ? undefined : wholeYear;
};

export const formatShareCardYear = (
  year: number | undefined,
): string | undefined => {
  const wholeYear = normalizeWholeYear(year);
  if (wholeYear === undefined) {
    return undefined;
  }
  return wholeYear < 0 ? `${Math.abs(wholeYear)} BCE` : `${wholeYear}`;
};

export const getShareCardEraBucket = (
  year: number | undefined,
): ShareCardEraBucket => {
  const wholeYear = normalizeWholeYear(year);
  if (wholeYear === undefined) {
    return "undated";
  }
  if (wholeYear < 1500) return "pre-1500";
  if (wholeYear <= 1799) return "1500-1799";
  if (wholeYear <= 1899) return "1800-1899";
  if (wholeYear <= 1949) return "1900-1949";
  if (wholeYear <= 1999) return "1950-1999";
  return "2000-plus";
};

const buildFallbackSubtitle = (dayLabel: string): string => {
  const trimmed = dayLabel.trim();
  const resolvedDay = trimmed.length > 0 ? trimmed : "this day";
  return `Explore the events, notable lives, and holidays from ${resolvedDay} across the centuries.`;
};

export const buildShareCardSubtitle = (
  snapshot: OnThisDaySnapshot,
  dayLabel: string,
): string => {
  if (snapshot.provider === "featured-fallback") {
    return buildFallbackSubtitle(dayLabel);
  }

  const parts: string[] = [];
  for (const { category, singular, plural } of SUBTITLE_CATEGORIES) {
    if (!snapshot.availableCategories[category]) {
      continue;
    }
    const rawCount = snapshot.counts[category];
    if (typeof rawCount !== "number" || !Number.isFinite(rawCount)) {
      continue;
    }
    const count = Math.floor(rawCount);
    if (count <= 0) {
      continue;
    }
    parts.push(
      `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`,
    );
  }

  return parts.length > 0 ? parts.join(" · ") : buildFallbackSubtitle(dayLabel);
};

export const isPublicDomainOrCc0License = (
  licenseName?: string,
  attributionIsFallback?: boolean,
): boolean => {
  if (attributionIsFallback) {
    return false;
  }
  if (!licenseName) {
    return false;
  }
  const normalized = licenseName
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/gu, " ");
  if (!normalized) {
    return false;
  }
  return PUBLIC_DOMAIN_LICENSE_PATTERNS.some((pattern) =>
    pattern.test(normalized),
  );
};

const parseWikimediaHttpUrl = (source: string): URL | null => {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  if (!URL.canParse(normalized)) {
    return null;
  }
  const parsed = new URL(normalized);
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return null;
  }
  return parsed;
};

const isCommonsMediaUrl = (parsedUrl: URL): boolean => {
  if (!isWikimediaMediaHostname(parsedUrl.hostname)) {
    return false;
  }
  if (getWikimediaMediaRepositoryFromUrl(parsedUrl.toString()) !== "commons") {
    return false;
  }
  const lowerPathname = parsedUrl.pathname.toLowerCase();
  if (
    lowerPathname.startsWith("/wikipedia/") &&
    !lowerPathname.startsWith("/wikipedia/commons/")
  ) {
    return false;
  }
  return true;
};

const isVectorSvgAsset = (
  imageUrl: string,
  parsedUrl: URL,
  sourceTitle?: string,
): boolean => {
  if (SVG_EXTENSION_PATTERN.test(parsedUrl.pathname)) {
    return true;
  }
  const fileTitle = getWikimediaFileTitleFromUrl(imageUrl);
  if (fileTitle && SVG_EXTENSION_PATTERN.test(fileTitle)) {
    return true;
  }
  const trimmedSourceTitle = sourceTitle?.trim();
  if (trimmedSourceTitle && SVG_EXTENSION_PATTERN.test(trimmedSourceTitle)) {
    return true;
  }
  return false;
};

const hasUsableDimensions = (width: number, height: number): boolean => {
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return false;
  }
  if (
    width < MIN_SHARE_CARD_PLATE_DIMENSION ||
    height < MIN_SHARE_CARD_PLATE_DIMENSION
  ) {
    return false;
  }
  const aspectRatio = width / height;
  return (
    aspectRatio >= MIN_SHARE_CARD_PLATE_ASPECT_RATIO &&
    aspectRatio <= MAX_SHARE_CARD_PLATE_ASPECT_RATIO
  );
};

type RankedCandidateEntry = {
  candidate: ShareCardPlateCandidate;
  categoryRank: number;
  snapshotIndex: number;
};

const compareCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareRankedEntries = (
  left: RankedCandidateEntry,
  right: RankedCandidateEntry,
): number =>
  left.categoryRank - right.categoryRank ||
  left.snapshotIndex - right.snapshotIndex ||
  ERA_BUCKET_PRIORITY[left.candidate.eraBucket] -
    ERA_BUCKET_PRIORITY[right.candidate.eraBucket] ||
  compareCodeUnits(left.candidate.eventId, right.candidate.eventId);

const buildCandidateFromEvent = (
  event: OnThisDayEvent,
  category: OnThisDayCategory,
  seenIdentities: Set<string>,
): ShareCardPlateCandidate | null => {
  const image = event.image;
  if (!image) {
    return null;
  }

  const parsedUrl = parseWikimediaHttpUrl(image.source);
  if (!parsedUrl || !isCommonsMediaUrl(parsedUrl)) {
    return null;
  }

  const imageUrl = parsedUrl.toString();
  if (isVectorSvgAsset(imageUrl, parsedUrl, image.attribution?.sourceTitle)) {
    return null;
  }

  if (!hasUsableDimensions(image.width, image.height)) {
    return null;
  }

  const mediaIdentity = getWikimediaMediaIdentity(imageUrl) ?? imageUrl;
  if (seenIdentities.has(mediaIdentity)) {
    return null;
  }
  seenIdentities.add(mediaIdentity);

  const year = normalizeWholeYear(event.year);
  const yearLabel = formatShareCardYear(year);
  const eraBucket = getShareCardEraBucket(year);
  const licenseName = image.attribution?.licenseName;
  const licenseTier: ShareCardLicenseTier = isPublicDomainOrCc0License(
    licenseName,
    image.attributionIsFallback,
  )
    ? "pd-cc0"
    : "commons-other";

  const alt =
    image.altText?.trim() ||
    image.articleTitle.trim() ||
    event.text.trim() ||
    "Historical archive image";

  return {
    eventId: event.id,
    category,
    ...(year === undefined ? {} : { year }),
    ...(yearLabel === undefined ? {} : { yearLabel }),
    articleTitle: image.articleTitle,
    alt,
    imageUrl,
    mediaIdentity,
    width: image.width,
    height: image.height,
    isPortrait: image.height > image.width,
    licenseTier,
    eraBucket,
    ...(licenseName ? { licenseName } : {}),
    ...(image.attribution?.creator ? { creator: image.attribution.creator } : {}),
    ...(image.attribution?.sourceUrl
      ? { sourceUrl: image.attribution.sourceUrl }
      : {}),
    ...(image.attributionIsFallback
      ? { attributionIsFallback: image.attributionIsFallback }
      : {}),
  };
};

const collectCategoryEntries = (
  snapshot: OnThisDaySnapshot,
  categories: readonly OnThisDayCategory[],
  seenIdentities: Set<string>,
): RankedCandidateEntry[] => {
  const entries: RankedCandidateEntry[] = [];
  for (const category of categories) {
    const events = snapshot.categories[category];
    const categoryRank = CATEGORY_PRIORITY[category];
    for (let snapshotIndex = 0; snapshotIndex < events.length; snapshotIndex += 1) {
      const candidate = buildCandidateFromEvent(
        events[snapshotIndex],
        category,
        seenIdentities,
      );
      if (candidate) {
        entries.push({
          candidate,
          categoryRank,
          snapshotIndex,
        });
      }
    }
  }
  return entries;
};

const rankEntriesWithinTier = (
  entries: readonly RankedCandidateEntry[],
): ShareCardPlateCandidate[] => {
  const datedQueues = new Map<DatedShareCardEraBucket, RankedCandidateEntry[]>(
    DATED_ERA_BUCKETS.map((bucket) => [bucket, []]),
  );
  const undatedEntries: RankedCandidateEntry[] = [];

  for (const entry of entries) {
    if (entry.candidate.eraBucket === "undated") {
      undatedEntries.push(entry);
    } else {
      datedQueues.get(entry.candidate.eraBucket)?.push(entry);
    }
  }

  for (const queue of datedQueues.values()) {
    queue.sort(compareRankedEntries);
  }
  undatedEntries.sort(compareRankedEntries);

  const ranked: ShareCardPlateCandidate[] = [];
  const cursors = new Map<DatedShareCardEraBucket, number>(
    DATED_ERA_BUCKETS.map((bucket) => [bucket, 0]),
  );

  for (;;) {
    const passHeads: {
      bucket: DatedShareCardEraBucket;
      entry: RankedCandidateEntry;
    }[] = [];

    for (const bucket of DATED_ERA_BUCKETS) {
      const queue = datedQueues.get(bucket);
      const cursor = cursors.get(bucket) ?? 0;
      if (queue && cursor < queue.length) {
        passHeads.push({ bucket, entry: queue[cursor] });
      }
    }

    if (passHeads.length === 0) {
      break;
    }

    passHeads.sort((left, right) =>
      compareRankedEntries(left.entry, right.entry),
    );

    for (const { bucket, entry } of passHeads) {
      ranked.push(entry.candidate);
      cursors.set(bucket, (cursors.get(bucket) ?? 0) + 1);
    }
  }

  for (const entry of undatedEntries) {
    ranked.push(entry.candidate);
  }

  return ranked;
};

const rankEntriesByLicenseAndEra = (
  entries: readonly RankedCandidateEntry[],
): ShareCardPlateCandidate[] => {
  const tierA: RankedCandidateEntry[] = [];
  const tierB: RankedCandidateEntry[] = [];

  for (const entry of entries) {
    if (entry.candidate.licenseTier === "pd-cc0") {
      tierA.push(entry);
    } else {
      tierB.push(entry);
    }
  }

  return [...rankEntriesWithinTier(tierA), ...rankEntriesWithinTier(tierB)];
};

const resolveLimit = (value: number | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
};

export const selectShareCardPlateCandidates = (
  snapshot: OnThisDaySnapshot,
  options?: SelectShareCardPlateCandidatesOptions,
): ShareCardPlateCandidate[] => {
  const maxCandidates = resolveLimit(
    options?.maxCandidates,
    DEFAULT_MAX_SHARE_CARD_CANDIDATES,
  );
  if (maxCandidates === 0) {
    return [];
  }

  const seenIdentities = new Set<string>();
  const primaryEntries = collectCategoryEntries(
    snapshot,
    PRIMARY_CATEGORIES,
    seenIdentities,
  );
  const rankedPrimary = rankEntriesByLicenseAndEra(primaryEntries);

  if (rankedPrimary.length >= maxCandidates) {
    return rankedPrimary.slice(0, maxCandidates);
  }

  const holidayEntries = collectCategoryEntries(
    snapshot,
    ["holidays"],
    seenIdentities,
  );
  const rankedHolidays = rankEntriesByLicenseAndEra(holidayEntries);

  return [...rankedPrimary, ...rankedHolidays].slice(0, maxCandidates);
};

const hasPositiveDimensions = (plate: {
  width: number;
  height: number;
}): boolean =>
  Number.isFinite(plate.width) &&
  Number.isFinite(plate.height) &&
  plate.width > 0 &&
  plate.height > 0;

const isHeroFriendlyPlate = (plate: {
  width: number;
  height: number;
}): boolean =>
  hasPositiveDimensions(plate) &&
  plate.width >= plate.height * HERO_PLATE_MIN_ASPECT_RATIO;

const isPortraitPlate = (plate: {
  width: number;
  height: number;
}): boolean => hasPositiveDimensions(plate) && plate.height > plate.width;

export const assignPlatesToGallerySlots = <
  T extends { width: number; height: number },
>(
  plates: readonly T[],
  maxPlates = DEFAULT_MAX_SHARE_CARD_PLATES,
): T[] => {
  const limit = resolveLimit(maxPlates, DEFAULT_MAX_SHARE_CARD_PLATES);
  if (limit === 0 || plates.length === 0) {
    return [];
  }

  const pool = plates.slice(0, limit);
  if (pool.length === 1) {
    return [pool[0]];
  }

  const heroIndex = pool.findIndex(isHeroFriendlyPlate);
  const chosenHeroIndex = heroIndex >= 0 ? heroIndex : 0;

  const slotMap = new Map<number, T>();
  slotMap.set(0, pool[chosenHeroIndex]);

  const remaining: T[] = [];
  for (let index = 0; index < pool.length; index += 1) {
    if (index !== chosenHeroIndex) {
      remaining.push(pool[index]);
    }
  }

  const portraits: T[] = [];
  const nonPortraits: T[] = [];
  for (const plate of remaining) {
    if (isPortraitPlate(plate)) {
      portraits.push(plate);
    } else {
      nonPortraits.push(plate);
    }
  }

  const portraitSlotIndices = PORTRAIT_PREFERRED_SLOT_INDICES.filter(
    (slotIndex) => slotIndex < pool.length,
  );
  let assignedPortraitCount = 0;
  for (const slotIndex of portraitSlotIndices) {
    if (assignedPortraitCount >= portraits.length) {
      break;
    }
    slotMap.set(slotIndex, portraits[assignedPortraitCount]);
    assignedPortraitCount += 1;
  }

  const overflowQueue: T[] = [
    ...nonPortraits,
    ...portraits.slice(assignedPortraitCount),
  ];
  let queueCursor = 0;
  for (let slotIndex = 1; slotIndex < pool.length; slotIndex += 1) {
    if (!slotMap.has(slotIndex) && queueCursor < overflowQueue.length) {
      slotMap.set(slotIndex, overflowQueue[queueCursor]);
      queueCursor += 1;
    }
  }

  const ordered: T[] = [];
  for (let slotIndex = 0; slotIndex < pool.length; slotIndex += 1) {
    const plate = slotMap.get(slotIndex);
    if (plate !== undefined) {
      ordered.push(plate);
    }
  }
  return ordered;
};
