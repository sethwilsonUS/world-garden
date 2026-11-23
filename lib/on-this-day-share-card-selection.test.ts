import { describe, expect, it } from "vitest";
import {
  CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
  ON_THIS_DAY_CATEGORIES,
  type OnThisDayCategory,
  type OnThisDayCategoryMap,
  type OnThisDayEvent,
  type OnThisDayImage,
  type OnThisDaySnapshot,
} from "./on-this-day-contracts";
import {
  assignPlatesToGallerySlots,
  buildShareCardSubtitle,
  DEFAULT_MAX_SHARE_CARD_CANDIDATES,
  formatShareCardYear,
  getShareCardEraBucket,
  isPublicDomainOrCc0License,
  selectShareCardPlateCandidates,
} from "./on-this-day-share-card-selection";

const commonsThumbUrl = (filename: string, widthPx = 320): string =>
  `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/${filename}/${widthPx}px-${filename}`;

const commonsOriginalUrl = (filename: string): string =>
  `https://upload.wikimedia.org/wikipedia/commons/a/ab/${filename}`;

const enwikiThumbUrl = (filename: string, widthPx = 320): string =>
  `https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/${filename}/${widthPx}px-${filename}`;

type EventFixtureOptions = {
  id: string;
  year?: number;
  text?: string;
  articleTitle?: string;
  image?: OnThisDayImage | null;
  filename?: string;
  width?: number;
  height?: number;
  licenseName?: string;
  creator?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  altText?: string;
  attributionIsFallback?: boolean;
};

const makeEvent = ({
  id,
  year,
  text = `Historical entry ${id}`,
  articleTitle = `Article ${id}`,
  image,
  filename = `${id}.jpg`,
  width = 400,
  height = 300,
  licenseName = "Public domain",
  creator = "Archival Photographer",
  sourceUrl = `https://commons.wikimedia.org/wiki/File:${filename}`,
  sourceTitle = `File:${filename}`,
  altText,
  attributionIsFallback,
}: EventFixtureOptions): OnThisDayEvent => {
  const resolvedImage: OnThisDayImage | undefined =
    image === null
      ? undefined
      : (image ?? {
          source: commonsThumbUrl(filename),
          width,
          height,
          articleTitle,
          ...(altText === undefined ? {} : { altText }),
          attribution: {
            ...(licenseName === undefined ? {} : { licenseName }),
            ...(creator === undefined ? {} : { creator }),
            ...(sourceUrl === undefined ? {} : { sourceUrl }),
            ...(sourceTitle === undefined ? {} : { sourceTitle }),
          },
          ...(attributionIsFallback === undefined
            ? {}
            : { attributionIsFallback }),
        });

  return {
    id,
    ...(year === undefined ? {} : { year }),
    text,
    pages: [{ title: articleTitle, slug: articleTitle.replace(/ /gu, "_") }],
    ...(resolvedImage === undefined ? {} : { image: resolvedImage }),
  };
};

type SnapshotFixtureOptions = Partial<OnThisDayCategoryMap<OnThisDayEvent[]>> & {
  provider?: OnThisDaySnapshot["provider"];
  monthDay?: string;
  counts?: Partial<OnThisDayCategoryMap<number>>;
  availableCategories?: Partial<OnThisDayCategoryMap<boolean>>;
};

const makeSnapshot = ({
  provider = "wikipedia-rest-v1",
  monthDay = "10-18",
  selected = [],
  events = [],
  births = [],
  deaths = [],
  holidays = [],
  counts: countOverrides = {},
  availableCategories: availabilityOverrides = {},
}: SnapshotFixtureOptions = {}): OnThisDaySnapshot => {
  const categories: OnThisDayCategoryMap<OnThisDayEvent[]> = {
    selected,
    events,
    births,
    deaths,
    holidays,
  };

  const counts: OnThisDayCategoryMap<number> = {
    selected: countOverrides.selected ?? categories.selected.length,
    events: countOverrides.events ?? categories.events.length,
    births: countOverrides.births ?? categories.births.length,
    deaths: countOverrides.deaths ?? categories.deaths.length,
    holidays: countOverrides.holidays ?? categories.holidays.length,
  };

  const defaultAvailable = (category: OnThisDayCategory): boolean =>
    provider === "featured-fallback" ? category === "selected" : true;

  const availableCategories: OnThisDayCategoryMap<boolean> = {
    selected: availabilityOverrides.selected ?? defaultAvailable("selected"),
    events: availabilityOverrides.events ?? defaultAvailable("events"),
    births: availabilityOverrides.births ?? defaultAvailable("births"),
    deaths: availabilityOverrides.deaths ?? defaultAvailable("deaths"),
    holidays: availabilityOverrides.holidays ?? defaultAvailable("holidays"),
  };

  // Sanity-check every declared category exists on the fixture.
  for (const category of ON_THIS_DAY_CATEGORIES) {
    if (!Array.isArray(categories[category])) {
      throw new Error(`Missing category ${category}`);
    }
  }

  return {
    schemaVersion: CURRENT_ON_THIS_DAY_SCHEMA_VERSION,
    provider,
    monthDay,
    checkedAt: 1_792_300_000_000,
    sourceUrl: "https://en.wikipedia.org/wiki/October_18",
    categories,
    counts,
    availableCategories,
  };
};

describe("formatShareCardYear", () => {
  it("formats positive years as truncated integer strings", () => {
    expect(formatShareCardYear(1969)).toBe("1969");
    expect(formatShareCardYear(476)).toBe("476");
    expect(formatShareCardYear(1)).toBe("1");
    expect(formatShareCardYear(1969.9)).toBe("1969");
  });

  it("formats negative years as BCE strings", () => {
    expect(formatShareCardYear(-44)).toBe("44 BCE");
    expect(formatShareCardYear(-1)).toBe("1 BCE");
    expect(formatShareCardYear(-753.7)).toBe("753 BCE");
  });

  it("returns undefined for missing, zero, or non-finite years", () => {
    expect(formatShareCardYear(undefined)).toBeUndefined();
    expect(formatShareCardYear(0)).toBeUndefined();
    expect(formatShareCardYear(-0)).toBeUndefined();
    expect(formatShareCardYear(Number.NaN)).toBeUndefined();
    expect(formatShareCardYear(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(formatShareCardYear(Number.NEGATIVE_INFINITY)).toBeUndefined();
  });
});

describe("getShareCardEraBucket", () => {
  it("maps years cleanly across every era boundary and undated fallback", () => {
    expect(getShareCardEraBucket(-44)).toBe("pre-1500");
    expect(getShareCardEraBucket(1499)).toBe("pre-1500");
    expect(getShareCardEraBucket(1500)).toBe("1500-1799");
    expect(getShareCardEraBucket(1799)).toBe("1500-1799");
    expect(getShareCardEraBucket(1800)).toBe("1800-1899");
    expect(getShareCardEraBucket(1899)).toBe("1800-1899");
    expect(getShareCardEraBucket(1900)).toBe("1900-1949");
    expect(getShareCardEraBucket(1949)).toBe("1900-1949");
    expect(getShareCardEraBucket(1950)).toBe("1950-1999");
    expect(getShareCardEraBucket(1999)).toBe("1950-1999");
    expect(getShareCardEraBucket(2000)).toBe("2000-plus");
    expect(getShareCardEraBucket(2026)).toBe("2000-plus");
    expect(getShareCardEraBucket(undefined)).toBe("undated");
    expect(getShareCardEraBucket(0)).toBe("undated");
  });
});

describe("buildShareCardSubtitle", () => {
  it("formats populated category counts in a concise middle-dot summary line", () => {
    const snapshot = makeSnapshot({
      counts: {
        selected: 8,
        events: 54,
        births: 258,
        deaths: 127,
        holidays: 10,
      },
    });

    expect(buildShareCardSubtitle(snapshot, "October 18")).toBe(
      "54 events · 258 births · 127 deaths · 10 holidays",
    );
  });

  it("uses singular labels for count of 1 and omits empty or unavailable categories", () => {
    const snapshot = makeSnapshot({
      counts: {
        selected: 3,
        events: 1,
        births: 0,
        deaths: 1200,
        holidays: 1,
      },
      availableCategories: {
        selected: true,
        events: true,
        births: true,
        deaths: true,
        holidays: false,
      },
    });

    expect(buildShareCardSubtitle(snapshot, "October 18")).toBe(
      "1 event · 1,200 deaths",
    );
  });

  it("falls back to the evergreen day sentence when counts are empty or degraded", () => {
    const emptySnapshot = makeSnapshot({
      counts: { selected: 0, events: 0, births: 0, deaths: 0, holidays: 0 },
    });
    expect(buildShareCardSubtitle(emptySnapshot, "October 18")).toBe(
      "Explore the events, notable lives, and holidays from October 18 across the centuries.",
    );

    const degradedSnapshot = makeSnapshot({
      provider: "featured-fallback",
      counts: { selected: 6, events: 54, births: 100, deaths: 50, holidays: 4 },
    });
    expect(buildShareCardSubtitle(degradedSnapshot, "September 28")).toBe(
      "Explore the events, notable lives, and holidays from September 28 across the centuries.",
    );

    expect(buildShareCardSubtitle(emptySnapshot, "   ")).toBe(
      "Explore the events, notable lives, and holidays from this day across the centuries.",
    );
  });
});

describe("isPublicDomainOrCc0License", () => {
  it("matches normalized Public Domain, PD, CC0, CC-Zero, and No known copyright variants", () => {
    expect(isPublicDomainOrCc0License("Public domain")).toBe(true);
    expect(isPublicDomainOrCc0License("  PUBLIC DOMAIN Mark 1.0 ")).toBe(true);
    expect(isPublicDomainOrCc0License("PD")).toBe(true);
    expect(isPublicDomainOrCc0License("PD-US-expired")).toBe(true);
    expect(isPublicDomainOrCc0License("PD-USGov-NASA")).toBe(true);
    expect(isPublicDomainOrCc0License("PD_old_100")).toBe(true);
    expect(isPublicDomainOrCc0License("CC0")).toBe(true);
    expect(isPublicDomainOrCc0License("CC0 1.0 Universal")).toBe(true);
    expect(isPublicDomainOrCc0License("CC-Zero")).toBe(true);
    expect(isPublicDomainOrCc0License("cc zero")).toBe(true);
    expect(isPublicDomainOrCc0License("No known copyright restrictions")).toBe(
      true,
    );
  });

  it("rejects non-PD licenses, substring false positives, missing values, and fallback attributions", () => {
    expect(isPublicDomainOrCc0License("CC BY-SA 4.0")).toBe(false);
    expect(isPublicDomainOrCc0License("CC BY 3.0")).toBe(false);
    expect(isPublicDomainOrCc0License("GFDL")).toBe(false);
    expect(isPublicDomainOrCc0License("FAL")).toBe(false);
    expect(isPublicDomainOrCc0License("Updated attribution")).toBe(false);
    expect(isPublicDomainOrCc0License("PDF License")).toBe(false);
    expect(isPublicDomainOrCc0License("Non-PD License")).toBe(false);
    expect(isPublicDomainOrCc0License("")).toBe(false);
    expect(isPublicDomainOrCc0License(undefined)).toBe(false);
    expect(isPublicDomainOrCc0License("Public domain", true)).toBe(false);
    expect(isPublicDomainOrCc0License("CC0 1.0", true)).toBe(false);
  });
});

describe("selectShareCardPlateCandidates", () => {
  it("enforces strict Commons-only, non-SVG, dimension, and aspect-ratio filters", () => {
    const snapshot = makeSnapshot({
      selected: [
        makeEvent({
          id: "valid-exact-min",
          year: 1969,
          filename: "Apollo_11.jpg",
          width: 160,
          height: 160,
        }),
        makeEvent({
          id: "valid-min-ratio",
          year: 1867,
          filename: "Tall_Portrait.jpg",
          width: 180,
          height: 400, // 0.45 exact boundary
        }),
        makeEvent({
          id: "valid-max-ratio",
          year: 1903,
          filename: "Wide_Flight.jpg",
          width: 470,
          height: 200, // 2.35 exact boundary
        }),
        makeEvent({
          id: "valid-svg-in-name-jpg",
          year: 2024,
          filename: "SVG_Summit_Photo.jpg",
          width: 320,
          height: 240,
        }),
        makeEvent({
          id: "valid-commons-original",
          year: 1450,
          image: {
            source: commonsOriginalUrl("Gutenberg_Bible.jpg"),
            width: 320,
            height: 240,
            articleTitle: "Gutenberg Bible",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "reject-enwiki",
          year: 1985,
          image: {
            source: enwikiThumbUrl("Fair_Use_Poster.jpg"),
            width: 320,
            height: 240,
            articleTitle: "Fair Use Poster",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "reject-frwiki",
          year: 1986,
          image: {
            source:
              "https://upload.wikimedia.org/wikipedia/fr/thumb/a/ab/Local_Fr.jpg/320px-Local_Fr.jpg",
            width: 320,
            height: 240,
            articleTitle: "Local Fr",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "reject-wikisource",
          year: 1988,
          image: {
            source:
              "https://upload.wikimedia.org/wikisource/en/a/ab/Example.jpg",
            width: 320,
            height: 240,
            articleTitle: "Wikisource Scan",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "reject-wikibooks",
          year: 1989,
          image: {
            source:
              "https://upload.wikimedia.org/wikibooks/en/thumb/a/ab/Textbook.jpg/320px-Textbook.jpg",
            width: 320,
            height: 240,
            articleTitle: "Wikibooks Cover",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "reject-external-host",
          year: 1987,
          image: {
            source: "https://example.com/photo.jpg",
            width: 320,
            height: 240,
            articleTitle: "External",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "reject-direct-svg",
          year: 1776,
          image: {
            source: commonsOriginalUrl("Flag_of_Example.svg"),
            width: 320,
            height: 200,
            articleTitle: "Flag",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "reject-thumb-svg-png",
          year: 1777,
          image: {
            source:
              "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Coat_of_Arms.svg/320px-Coat_of_Arms.svg.png",
            width: 320,
            height: 320,
            articleTitle: "Coat of Arms",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "reject-uppercase-svg-png",
          year: 1778,
          image: {
            source:
              "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Emblem.SVG/320px-Emblem.SVG.PNG",
            width: 320,
            height: 320,
            articleTitle: "Emblem",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "reject-too-narrow",
          year: 1910,
          filename: "Tiny_Width.jpg",
          width: 159,
          height: 240,
        }),
        makeEvent({
          id: "reject-too-short",
          year: 1911,
          filename: "Tiny_Height.jpg",
          width: 240,
          height: 159,
        }),
        makeEvent({
          id: "reject-too-tall-ratio",
          year: 1912,
          filename: "Skinny_Strip.jpg",
          width: 179,
          height: 400, // 0.4475 < 0.45
        }),
        makeEvent({
          id: "reject-too-wide-ratio",
          year: 1913,
          filename: "Ultra_Panorama.jpg",
          width: 471,
          height: 200, // 2.355 > 2.35
        }),
        makeEvent({
          id: "reject-no-image",
          year: 1914,
          image: null,
        }),
      ],
    });

    const candidates = selectShareCardPlateCandidates(snapshot);
    expect(candidates.map((candidate) => candidate.eventId)).toEqual([
      "valid-exact-min",
      "valid-min-ratio",
      "valid-max-ratio",
      "valid-svg-in-name-jpg",
      "valid-commons-original",
    ]);
  });

  it("deduplicates media identity across categories while not letting rejected thumbnails poison valid ones", () => {
    const snapshot = makeSnapshot({
      selected: [
        makeEvent({
          id: "selected-apollo",
          year: 1969,
          image: {
            source: commonsThumbUrl("Apollo_11_Moon.jpg", 220),
            width: 220,
            height: 180,
            articleTitle: "Apollo 11",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "selected-too-small-wright",
          year: 1903,
          image: {
            source: commonsThumbUrl("Wright_Flyer.jpg", 120),
            width: 120,
            height: 90,
            articleTitle: "Wright Flyer",
            attribution: { licenseName: "Public domain" },
          },
        }),
      ],
      events: [
        makeEvent({
          id: "events-apollo-duplicate-thumb",
          year: 1969,
          image: {
            source: commonsThumbUrl("Apollo_11_Moon.jpg", 440),
            width: 440,
            height: 360,
            articleTitle: "Apollo 11 (event)",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "events-apollo-duplicate-original",
          year: 1969,
          image: {
            source: commonsOriginalUrl("apollo_11_Moon.jpg"),
            width: 800,
            height: 600,
            articleTitle: "Apollo 11 (original)",
            attribution: { licenseName: "Public domain" },
          },
        }),
        makeEvent({
          id: "events-wright-usable",
          year: 1903,
          image: {
            source: commonsThumbUrl("Wright_Flyer.jpg", 360),
            width: 360,
            height: 240,
            articleTitle: "Wright Flyer",
            attribution: { licenseName: "Public domain" },
          },
        }),
      ],
    });

    const candidates = selectShareCardPlateCandidates(snapshot);
    expect(candidates.map((candidate) => candidate.eventId)).toEqual([
      "selected-apollo",
      "events-wright-usable",
    ]);
    expect(candidates[0].category).toBe("selected");
    expect(candidates[1].category).toBe("events");
  });

  it("fills Tier A (Public Domain / CC0) ahead of Tier B (CC BY / CC BY-SA / fallback / unenriched)", () => {
    const snapshot = makeSnapshot({
      selected: [
        makeEvent({
          id: "selected-cc-by-sa",
          year: 1969,
          licenseName: "CC BY-SA 4.0",
        }),
        makeEvent({
          id: "selected-fallback-pd",
          year: 1922,
          licenseName: "Public domain",
          attributionIsFallback: true,
        }),
        makeEvent({
          id: "selected-unenriched",
          year: 1867,
          image: {
            source: commonsThumbUrl("Unenriched_Photo.jpg"),
            width: 320,
            height: 240,
            articleTitle: "Unenriched Photo",
          },
        }),
      ],
      events: [
        makeEvent({
          id: "events-pd",
          year: 1748,
          licenseName: "PD-old-100",
        }),
      ],
      births: [
        makeEvent({
          id: "births-cc0",
          year: 1926,
          licenseName: "CC0 1.0",
        }),
      ],
      deaths: [
        makeEvent({
          id: "deaths-no-known-copyright",
          year: 1931,
          licenseName: "No known copyright restrictions",
        }),
      ],
    });

    const candidates = selectShareCardPlateCandidates(snapshot);
    expect(candidates.map((candidate) => candidate.eventId)).toEqual([
      "events-pd",
      "births-cc0",
      "deaths-no-known-copyright",
      "selected-cc-by-sa",
      "selected-fallback-pd",
      "selected-unenriched",
    ]);
    expect(candidates.slice(0, 3).every((c) => c.licenseTier === "pd-cc0")).toBe(
      true,
    );
    expect(
      candidates.slice(3).every((c) => c.licenseTier === "commons-other"),
    ).toBe(true);
  });

  it("prefers Highlights first and round-robins across distinct era buckets with undated last", () => {
    const snapshot = makeSnapshot({
      selected: [
        makeEvent({ id: "sel-1968", year: 1968 }),
        makeEvent({ id: "sel-1989", year: 1989 }), // same bucket as sel-1968
        makeEvent({ id: "sel-1867", year: 1867 }),
      ],
      events: [
        makeEvent({ id: "evt-1356", year: 1356 }),
        makeEvent({ id: "evt-2019", year: 2019 }),
        makeEvent({ id: "evt-1685", year: 1685 }),
        makeEvent({ id: "evt-undated", year: undefined }),
      ],
      births: [
        makeEvent({ id: "birth-1926", year: 1926 }),
      ],
    });

    const candidates = selectShareCardPlateCandidates(snapshot, {
      maxCandidates: 8,
    });

    // Pass 1 across all 6 dated era buckets:
    //   selected-headed buckets first (in Snapshot order: 1950-1999, 1800-1899),
    //   then events-headed buckets (pre-1500, 2000-plus, 1500-1799),
    //   then births-headed bucket (1900-1949).
    // Pass 2: remaining dated item (sel-1989 in 1950-1999).
    // Finally: undated item (evt-undated) last within the tier.
    expect(candidates.map((candidate) => candidate.eventId)).toEqual([
      "sel-1968",
      "sel-1867",
      "evt-1356",
      "evt-2019",
      "evt-1685",
      "birth-1926",
      "sel-1989",
      "evt-undated",
    ]);

    // First 6 selections span all 6 distinct historical era buckets.
    expect(new Set(candidates.slice(0, 6).map((c) => c.eraBucket)).size).toBe(
      6,
    );
    expect(candidates[7].eraBucket).toBe("undated");
    expect(candidates[7].yearLabel).toBeUndefined();
  });

  it("uses holidays only as a last resort when fewer than maxCandidates non-holiday candidates exist", () => {
    const plentyPrimary = makeSnapshot({
      events: Array.from({ length: DEFAULT_MAX_SHARE_CARD_CANDIDATES }, (_, i) =>
        makeEvent({
          id: `evt-${i}`,
          year: 1900 + i,
          licenseName: "CC BY-SA 4.0",
        }),
      ),
      holidays: [
        makeEvent({
          id: "hol-pd",
          year: undefined,
          licenseName: "Public domain",
        }),
      ],
    });

    const plentyCandidates = selectShareCardPlateCandidates(plentyPrimary);
    expect(plentyCandidates).toHaveLength(DEFAULT_MAX_SHARE_CARD_CANDIDATES);
    expect(plentyCandidates.some((c) => c.category === "holidays")).toBe(false);

    const scarcePrimary = makeSnapshot({
      events: [
        makeEvent({
          id: "evt-cc",
          year: 1955,
          licenseName: "CC BY-SA 4.0",
          filename: "Shared_Day.jpg",
        }),
      ],
      holidays: [
        makeEvent({
          id: "hol-dup",
          year: undefined,
          licenseName: "Public domain",
          filename: "Shared_Day.jpg",
        }),
        makeEvent({
          id: "hol-cc",
          year: undefined,
          licenseName: "CC BY 3.0",
        }),
        makeEvent({
          id: "hol-pd",
          year: undefined,
          licenseName: "Public domain",
        }),
      ],
    });

    const backfilled = selectShareCardPlateCandidates(scarcePrimary, {
      maxCandidates: 5,
    });
    expect(backfilled.map((candidate) => candidate.eventId)).toEqual([
      "evt-cc",
      "hol-pd",
      "hol-cc",
    ]);
  });

  it("breaks ties deterministically across repeated runs and formats BCE year labels", () => {
    const snapshot = makeSnapshot({
      selected: [
        makeEvent({ id: "b-bce", year: -44, articleTitle: "Julius Caesar" }),
        makeEvent({ id: "a-bce", year: -30, articleTitle: "Cleopatra" }),
      ],
    });

    const first = selectShareCardPlateCandidates(snapshot);
    const second = selectShareCardPlateCandidates(snapshot);

    expect(first).toEqual(second);
    expect(first.map((c) => c.eventId)).toEqual(["b-bce", "a-bce"]);
    expect(first.map((c) => c.yearLabel)).toEqual(["44 BCE", "30 BCE"]);
  });

  it("returns an empty array when maxCandidates is 0 or no usable images exist", () => {
    const snapshot = makeSnapshot({
      selected: [makeEvent({ id: "sel-1", year: 1969 })],
    });
    expect(
      selectShareCardPlateCandidates(snapshot, { maxCandidates: 0 }),
    ).toEqual([]);
    expect(selectShareCardPlateCandidates(makeSnapshot())).toEqual([]);
  });
});

describe("assignPlatesToGallerySlots", () => {
  type TestPlate = { id: string; width: number; height: number };

  const landscape = (id: string, width = 400, height = 300): TestPlate => ({
    id,
    width,
    height,
  });

  const portrait = (id: string, width = 240, height = 360): TestPlate => ({
    id,
    width,
    height,
  });

  it("assigns the highest-ranked landscape/near-square plate to slot 0 (Hero) and routes portraits to portrait-friendly slots", () => {
    const input = [
      portrait("p0"),
      landscape("l1"),
      landscape("l2"),
      portrait("p3"),
      landscape("l4"),
    ];

    const assigned = assignPlatesToGallerySlots(input);

    // Slot 0 (Hero): l1 (highest-ranked landscape)
    // Slot 2 (lower-right portrait slot): p0 (highest-ranked portrait)
    // Slot 4 (secondary portrait-friendly slot): p3 (second portrait)
    // Slots 1, 3 (landscape slots): l2, l4 in original ranked order
    expect(assigned.map((plate) => plate.id)).toEqual([
      "l1",
      "l2",
      "p0",
      "l4",
      "p3",
    ]);
    // Input array is never mutated.
    expect(input.map((plate) => plate.id)).toEqual([
      "p0",
      "l1",
      "l2",
      "p3",
      "l4",
    ]);
  });

  it("treats exact 0.9 aspect ratio as near-square hero-friendly and rejects narrower ratios for hero when a landscape exists", () => {
    const nearSquareBoundary: TestPlate = {
      id: "near-square",
      width: 180,
      height: 200, // width === height * 0.9
    };
    const resultNearSquare = assignPlatesToGallerySlots([
      nearSquareBoundary,
      landscape("l1"),
      landscape("l2"),
    ]);
    expect(resultNearSquare[0].id).toBe("near-square");

    const slightlyTooNarrow: TestPlate = {
      id: "narrow-portrait",
      width: 179,
      height: 200, // width < height * 0.9
    };
    const resultNarrow = assignPlatesToGallerySlots([
      slightlyTooNarrow,
      landscape("l1"),
      landscape("l2"),
    ]);
    expect(resultNarrow.map((plate) => plate.id)).toEqual([
      "l1",
      "l2",
      "narrow-portrait",
    ]);
  });

  it("preserves exact ranked order for 5 landscapes and falls back cleanly when all plates are portraits", () => {
    const allLandscapes = [
      landscape("l0"),
      landscape("l1"),
      landscape("l2"),
      landscape("l3"),
      landscape("l4"),
    ];
    expect(
      assignPlatesToGallerySlots(allLandscapes).map((plate) => plate.id),
    ).toEqual(["l0", "l1", "l2", "l3", "l4"]);

    const allPortraits = [
      portrait("p0"),
      portrait("p1"),
      portrait("p2"),
      portrait("p3"),
      portrait("p4"),
    ];
    const assignedPortraits = assignPlatesToGallerySlots(allPortraits);
    expect(assignedPortraits[0].id).toBe("p0");
    expect(assignedPortraits[2].id).toBe("p1");
    expect(assignedPortraits[4].id).toBe("p2");
    expect(assignedPortraits).toHaveLength(5);
  });

  it("caps output to maxPlates without promoting lower-ranked plates from beyond maxPlates", () => {
    const sixPlates = [
      portrait("p0"),
      portrait("p1"),
      portrait("p2"),
      portrait("p3"),
      portrait("p4"),
      landscape("l5-beyond-cap"),
    ];

    const assigned = assignPlatesToGallerySlots(sixPlates, 5);
    expect(assigned).toHaveLength(5);
    expect(assigned.some((plate) => plate.id === "l5-beyond-cap")).toBe(false);
  });

  it("handles fewer than 5 plates (0, 1, 2, 3, and 4 plates) deterministically", () => {
    expect(assignPlatesToGallerySlots([])).toEqual([]);
    expect(assignPlatesToGallerySlots([portrait("p0")])).toEqual([
      portrait("p0"),
    ]);
    expect(
      assignPlatesToGallerySlots([portrait("p0"), landscape("l1")]).map(
        (plate) => plate.id,
      ),
    ).toEqual(["l1", "p0"]);
    expect(
      assignPlatesToGallerySlots([
        portrait("p0"),
        landscape("l1"),
        landscape("l2"),
      ]).map((plate) => plate.id),
    ).toEqual(["l1", "l2", "p0"]);
    expect(
      assignPlatesToGallerySlots([
        portrait("p0"),
        landscape("l1"),
        landscape("l2"),
        landscape("l3"),
      ]).map((plate) => plate.id),
    ).toEqual(["l1", "l2", "p0", "l3"]);
    expect(assignPlatesToGallerySlots([landscape("l0")], 0)).toEqual([]);
  });
});
