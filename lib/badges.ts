export const BADGE_KEYS = [
  "history",
  "geography",
  "biography",
  "society_politics",
  "arts_culture",
  "science",
  "technology",
  "nature",
] as const;

export type BadgeKey = (typeof BADGE_KEYS)[number];

export const BADGE_TOPIC_CACHE_VERSION = 1;
export const BADGE_LEVEL_BASE_EXP = 5;
export const WIKIMEDIA_TOPIC_MIN_CONFIDENCE = 0.5;

export type WikimediaTopicPrediction = {
  topic: string;
  score: number;
};

export type BadgeDefinition = {
  key: BadgeKey;
  label: string;
  description: string;
  glyph: string;
  articletopics: string[];
};

export type BadgeProgress = {
  key: BadgeKey;
  label: string;
  description: string;
  glyph: string;
  exp: number;
  creditedArticleCount: number;
  level: number;
  expIntoLevel: number;
  expForNextLevel: number;
  nextLevelTarget: number;
};

export type BadgeCreditEntry = {
  wikiPageId: string;
  slug: string;
  title: string;
  earnedAt: number;
};

export type BadgeCreditSummary = {
  badgeKey: BadgeKey;
  credits: BadgeCreditEntry[];
};

export type BadgeCreditsByBadge = Record<BadgeKey, BadgeCreditEntry[]>;

export type AwardedBadgeProgress = BadgeProgress & {
  previousLevel: number;
  leveledUp: boolean;
  gainedExp: number;
};

export type BadgeListenProgressResult = {
  heardSeconds: number;
  totalDurationSeconds: number;
  qualified: boolean;
  awardedBadgeKeys: BadgeKey[];
  awardedBadges: AwardedBadgeProgress[];
};

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  {
    key: "history",
    label: "History",
    description: "Stories of empires, revolutions, wars, and how yesterday keeps haunting today.",
    glyph: "quill-scroll",
    articletopics: ["history", "military-and-warfare"],
  },
  {
    key: "geography",
    label: "Geography",
    description: "Places, regions, maps, borders, and the stubborn reality of terrain.",
    glyph: "compass",
    articletopics: [
      "geographical",
      "maps",
      "regions",
      "africa",
      "central-africa",
      "eastern-africa",
      "northern-africa",
      "southern-africa",
      "western-africa",
      "central-america",
      "north-america",
      "south-america",
      "asia",
      "central-asia",
      "east-asia",
      "north-asia",
      "south-asia",
      "southeast-asia",
      "west-asia",
      "europe",
      "eastern-europe",
      "northern-europe",
      "southern-europe",
      "western-europe",
      "oceania",
    ],
  },
  {
    key: "biography",
    label: "Biography",
    description: "Lives, legacies, and the delightfully messy business of being a person.",
    glyph: "portrait",
    articletopics: ["biography"],
  },
  {
    key: "society_politics",
    label: "Society & Politics",
    description: "Government, institutions, education, markets, transit, and how groups organize themselves.",
    glyph: "forum",
    articletopics: [
      "society",
      "politics-and-government",
      "business-and-economics",
      "education",
      "transportation",
      "philosophy-and-religion",
    ],
  },
  {
    key: "arts_culture",
    label: "Arts & Culture",
    description: "Books, music, film, food, performance, sport, and the wonderfully human urge to make stuff.",
    glyph: "lyre",
    articletopics: [
      "architecture",
      "books",
      "comics-and-anime",
      "entertainment",
      "fashion",
      "films",
      "food-and-drink",
      "internet-culture",
      "language-and-literature",
      "literature",
      "media",
      "music",
      "performing-arts",
      "radio",
      "sports",
      "television",
      "video-games",
      "visual-arts",
    ],
  },
  {
    key: "science",
    label: "Science",
    description: "Physics, chemistry, medicine, math, and the long habit of poking reality with questions.",
    glyph: "atom",
    articletopics: [
      "stem",
      "chemistry",
      "mathematics",
      "medicine-and-health",
      "physics",
    ],
  },
  {
    key: "technology",
    label: "Technology",
    description: "Engineering, computing, software, infrastructure, and the machinery behind modern life.",
    glyph: "gear",
    articletopics: [
      "computing",
      "engineering",
      "libraries-and-information",
      "software",
      "technology",
    ],
  },
  {
    key: "nature",
    label: "Nature",
    description: "Biology, ecosystems, geology, climate, and the parts of the world that existed before our dashboards.",
    glyph: "leaf-orbit",
    articletopics: [
      "biology",
      "earth-and-environment",
      "space",
    ],
  },
] as const;

const BADGE_DEFINITION_MAP = new Map(
  BADGE_DEFINITIONS.map((definition) => [definition.key, definition]),
);

const WIKIMEDIA_TOPIC_SLUG_ALIASES: ReadonlyArray<readonly [string, BadgeKey]> =
  [
    // Wikimedia's ORES/outlink taxonomy emits `Culture.Linguistics` (`linguistics`),
    // while the CirrusSearch definition also carries the legacy `language-and-literature` slug.
    ["linguistics", "arts_culture"],
  ];

const TOPIC_SLUG_TO_BADGE_KEY: ReadonlyMap<string, BadgeKey> = (() => {
  const map = new Map<string, BadgeKey>();
  for (const definition of BADGE_DEFINITIONS) {
    for (const topicSlug of definition.articletopics) {
      map.set(topicSlug, definition.key);
    }
  }
  for (const [alias, badgeKey] of WIKIMEDIA_TOPIC_SLUG_ALIASES) {
    if (!map.has(alias)) {
      map.set(alias, badgeKey);
    }
  }
  return map;
})();

const CIRRUS_ARTICLE_TOPIC_TAG_PREFIX =
  "classification.prediction.articletopic/";

/**
 * Normalize a Wikimedia ORES / Lift Wing `outlink-topic-model` taxonomy label
 * (e.g. `STEM.Libraries_&_Information`, `Culture.Biography.Biography*`) or a
 * bare CirrusSearch `articletopic:` slug into its canonical kebab-case slug.
 */
export const normalizeWikimediaTopicSlug = (topic: string): string => {
  const trimmed = topic.trim();
  if (!trimmed) return "";
  const lastDot = trimmed.lastIndexOf(".");
  const leaf = (lastDot >= 0 ? trimmed.slice(lastDot + 1) : trimmed).trim();
  return leaf
    .replace(/\*+$/u, "")
    .replace(/&/gu, " and ")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
};

export const mapWikimediaTopicToBadgeKey = (
  topic: string,
): BadgeKey | null => {
  const slug = normalizeWikimediaTopicSlug(topic);
  if (!slug) return null;
  return TOPIC_SLUG_TO_BADGE_KEY.get(slug) ?? null;
};

/**
 * Deterministically map predicted Wikimedia taxonomy topics into Curio Garden
 * badge keys in canonical `BADGE_KEYS` launch order after confidence filtering.
 */
export const mapWikimediaTopicsToBadgeKeys = (
  predictions: readonly WikimediaTopicPrediction[],
  minConfidence = WIKIMEDIA_TOPIC_MIN_CONFIDENCE,
): BadgeKey[] => {
  const threshold =
    Number.isFinite(minConfidence) && minConfidence >= 0
      ? minConfidence
      : WIKIMEDIA_TOPIC_MIN_CONFIDENCE;
  const matched = new Set<BadgeKey>();

  for (const prediction of predictions) {
    if (
      !Number.isFinite(prediction.score) ||
      prediction.score < threshold
    ) {
      continue;
    }
    const badgeKey = mapWikimediaTopicToBadgeKey(prediction.topic);
    if (badgeKey) {
      matched.add(badgeKey);
    }
  }

  return BADGE_KEYS.filter((key) => matched.has(key));
};

/**
 * Parse CirrusSearch `cirrusdoc` `weighted_tags` entries prefixed with
 * `classification.prediction.articletopic/<Topic>|<weight>` (0–1000 scale)
 * into normalized `[0, 1]` topic predictions.
 */
export const parseCirrusWeightedArticleTopics = (
  weightedTags: readonly unknown[] | undefined,
): WikimediaTopicPrediction[] => {
  if (!Array.isArray(weightedTags)) return [];

  const predictions: WikimediaTopicPrediction[] = [];
  for (const entry of weightedTags) {
    if (
      typeof entry !== "string" ||
      !entry.startsWith(CIRRUS_ARTICLE_TOPIC_TAG_PREFIX)
    ) {
      continue;
    }

    const payload = entry.slice(CIRRUS_ARTICLE_TOPIC_TAG_PREFIX.length);
    const pipeIndex = payload.lastIndexOf("|");
    const rawTopic = (
      pipeIndex >= 0 ? payload.slice(0, pipeIndex) : payload
    ).trim();
    if (!rawTopic) continue;

    let score = 1;
    if (pipeIndex >= 0) {
      const rawWeight = payload.slice(pipeIndex + 1).trim();
      if (!/^\d+(?:\.\d+)?$/u.test(rawWeight)) continue;
      const weight = Number(rawWeight);
      if (!Number.isFinite(weight) || weight < 0) continue;
      score = Math.min(1, weight / 1_000);
    }

    predictions.push({ topic: rawTopic, score });
  }

  return predictions;
};

export const getBadgeDefinition = (key: BadgeKey): BadgeDefinition => {
  const definition = BADGE_DEFINITION_MAP.get(key);
  if (!definition) {
    throw new Error(`Unknown badge key: ${key}`);
  }
  return definition;
};

export const getBadgeTopicQuery = (key: BadgeKey): string =>
  getBadgeDefinition(key).articletopics.join("|");

export const getArticleTopicDisplayKeys = ({
  badgeKeys,
}: {
  badgeKeys?: BadgeKey[];
}): BadgeKey[] | undefined => {
  if (badgeKeys === undefined) {
    return undefined;
  }

  const badgeKeySet = new Set(badgeKeys);
  return BADGE_KEYS.filter((key) => badgeKeySet.has(key));
};

export const buildEmptyBadgeCreditsByBadge = (): BadgeCreditsByBadge => ({
  history: [],
  geography: [],
  biography: [],
  society_politics: [],
  arts_culture: [],
  science: [],
  technology: [],
  nature: [],
});

export const expRequiredForLevel = (level: number): number => {
  if (level <= 0) return 0;
  return BADGE_LEVEL_BASE_EXP * level * (level + 1) / 2;
};

export const getBadgeLevel = (exp: number): number => {
  let level = 0;
  while (exp >= expRequiredForLevel(level + 1)) {
    level += 1;
  }
  return level;
};

export const buildBadgeProgress = (
  key: BadgeKey,
  exp: number,
  creditedArticleCount = exp,
): BadgeProgress => {
  const definition = getBadgeDefinition(key);
  const level = getBadgeLevel(exp);
  const currentLevelFloor = expRequiredForLevel(level);
  const nextLevelTarget = expRequiredForLevel(level + 1);

  return {
    key,
    label: definition.label,
    description: definition.description,
    glyph: definition.glyph,
    exp,
    creditedArticleCount,
    level,
    expIntoLevel: exp - currentLevelFloor,
    expForNextLevel: nextLevelTarget - currentLevelFloor,
    nextLevelTarget,
  };
};

export const buildEmptyBadgeProgress = (key: BadgeKey): BadgeProgress =>
  buildBadgeProgress(key, 0, 0);

export const getBadgeProgressLabel = (badge: BadgeProgress): string => {
  const nextLevel = badge.level + 1;
  const remaining = Math.max(0, badge.expForNextLevel - badge.expIntoLevel);

  if (badge.level === 0) {
    return `${badge.exp} / ${badge.nextLevelTarget} EXP to level 1`;
  }

  if (remaining === 0) {
    return `Level ${badge.level} mastered`;
  }

  return `${badge.expIntoLevel} / ${badge.expForNextLevel} EXP to level ${nextLevel}`;
};

export const getAccessibleBadgeProgressLabel = (
  badge: BadgeProgress,
): string => {
  if (badge.level === 0) {
    return `${badge.label} badge locked. ${badge.exp} EXP so far. ${badge.nextLevelTarget} EXP needed for level 1.`;
  }

  return `${badge.label} badge at level ${badge.level}. ${badge.exp} EXP total. ${getBadgeProgressLabel(badge)}.`;
};

export const getBadgeProgressPercent = (badge: BadgeProgress): number => {
  if (badge.level === 0) {
    return Math.min(100, Math.round((badge.exp / badge.nextLevelTarget) * 100));
  }

  return Math.min(
    100,
    Math.round((badge.expIntoLevel / Math.max(1, badge.expForNextLevel)) * 100),
  );
};

export const buildAwardedBadgeProgress = (
  key: BadgeKey,
  exp: number,
): AwardedBadgeProgress => {
  const progress = buildBadgeProgress(key, exp, exp);
  const previousLevel = getBadgeLevel(Math.max(0, exp - 1));

  return {
    ...progress,
    previousLevel,
    leveledUp: progress.level > previousLevel,
    gainedExp: 1,
  };
};
