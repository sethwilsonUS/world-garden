import { getPodcastExcerpt } from "@/lib/podcast-feed";

const FEED_DATE_PARTS_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type DidYouKnowEditionMetadata = {
  feedDateIso: string;
  title: string;
  publishedAt: number;
  description: string;
  excerpt: string;
};

const formatDidYouKnowDate = (feedDateIso: string): string => {
  try {
    const date = new Date(`${feedDateIso}T12:00:00Z`);
    if (Number.isNaN(date.getTime())) return feedDateIso;
    return date.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return feedDateIso;
  }
};

const normalizeFactText = (text: string): string =>
  text.replace(/^\.\.\.\s*/, "").replace(/\s+/g, " ").trim();

const sentenceCase = (text: string): string =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : text;

export const buildDidYouKnowEditionTitle = (feedDateIso: string): string =>
  `Did You Know? ${formatDidYouKnowDate(feedDateIso)}`;

export const getDidYouKnowEditionPublishedAt = (
  feedDateIso: string,
): number => {
  const match = FEED_DATE_PARTS_RE.exec(feedDateIso);
  if (!match) {
    return new Date(`${feedDateIso}T00:00:00Z`).getTime();
  }

  const [, year, month, day] = match;
  return Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);
};

export const buildDidYouKnowEditionDescription = (
  itemTexts: string[],
): string => {
  const summary = itemTexts
    .map(normalizeFactText)
    .filter(Boolean)
    .map(sentenceCase)
    .slice(0, 3)
    .join(" • ");

  return summary || "Daily curiosity prompts from Wikipedia's featured feed.";
};

export const buildDidYouKnowEditionMetadata = ({
  feedDateIso,
  itemTexts,
}: {
  feedDateIso: string;
  itemTexts: string[];
}): DidYouKnowEditionMetadata => {
  const description = buildDidYouKnowEditionDescription(itemTexts);

  return {
    feedDateIso,
    title: buildDidYouKnowEditionTitle(feedDateIso),
    publishedAt: getDidYouKnowEditionPublishedAt(feedDateIso),
    description,
    excerpt: getPodcastExcerpt(description, 180),
  };
};
