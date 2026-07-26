import {
  type ArticleContextRequest,
  type ContextSource,
} from "./article-context-types";
import {
  buildBaseBlock,
  sanitizeContextCaption,
  sanitizeContextText,
  uniqueId,
  type BlockCandidate,
} from "./article-context-foundations";

export const normalizeCommonsImageUrl = (value: string): string | null => {
  const candidate = value.startsWith("//") ? `https:${value}` : value;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "upload.wikimedia.org" ||
    !url.pathname.startsWith("/wikipedia/commons/") ||
    /\/math\//i.test(url.pathname) ||
    /\.svg$/i.test(url.pathname)
  ) {
    return null;
  }
  return url.toString();
};

/**
 * Favor precision when promoting figures. Topic nouns such as "system",
 * "orbit", "body", and "part" occur frequently in ordinary photo captions
 * and do not establish that an image encodes relationships worth exploring as
 * a diagram. In addition to explicit diagram language, accept two narrow forms
 * of visual notation used by genuine Wikipedia diagrams whose captions do not
 * call themselves diagrams.
 */
const EXPLICIT_DIAGRAM_CAPTION_PATTERN =
  /\b(diagram|schematic|flow\s*chart|cross[- ]section|cutaway|infographic|anatomical\s+(?:diagram|illustration))\b/i;

const DIAGRAM_ARROW_NOTATION_PATTERN =
  /(?:\barrows?\b.{0,100}\b(?:show|indicate|represent|connect|trace)\b|\b(?:show|indicate|represent|connect|trace)\b.{0,100}\barrows?\b)/i;

const DIAGRAM_CIRCULAR_SEQUENCE_PATTERN =
  /(?:\bsequence\b.{0,180}\b(?:circle|spiral)\b|\b(?:circle|spiral)\b.{0,180}\bsequence\b)/i;

const MAP_CHART_NOUNS = new Set(["map", "maps", "chart", "charts"]);

const assetNameWords = (value: string): string[] =>
  value
    .replace(/^(?:File|Image):/i, "")
    .replace(/\.[A-Za-z0-9]{2,5}$/u, "")
    .replace(/[_/.-]+/gu, " ")
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean);

const fileIdentityNamesMapOrChart = (value: string): boolean => {
  const words = assetNameWords(value);
  const nounIndex = words.findIndex((word) => MAP_CHART_NOUNS.has(word));
  return nounIndex >= 0 && (nounIndex <= 3 || nounIndex === words.length - 1);
};

const proseIdentifiesMapOrChart = (value: string): boolean =>
  /^(?:(?:an?|the)\s+)?(?:(?:current|old|new|official|interactive|historical|historic|alternate|alternative|simplified|political|electoral|route|service|subway|transit|system)\s+){0,4}(?:map|chart)\b/i.test(
    value.trim(),
  ) ||
  /^(?:map|chart)\s+(?:of|showing|depicting|illustrating)\b/i.test(
    value.trim(),
  );

const isDiagramDescription = ({
  caption,
  alt,
  resourceTitle,
}: {
  caption: string;
  alt: string;
  resourceTitle: string;
}): boolean => {
  const combined = [caption, alt, resourceTitle].filter(Boolean).join(" ");
  if (
    EXPLICIT_DIAGRAM_CAPTION_PATTERN.test(combined) ||
    DIAGRAM_ARROW_NOTATION_PATTERN.test(combined) ||
    DIAGRAM_CIRCULAR_SEQUENCE_PATTERN.test(combined)
  ) {
    return true;
  }
  if (fileIdentityNamesMapOrChart(resourceTitle)) return true;
  if (proseIdentifiesMapOrChart(alt)) return true;
  return !resourceTitle && proseIdentifiesMapOrChart(caption);
};

const captionWalkthrough = (caption: string): string[] => {
  const sentences = caption
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sanitizeContextText(sentence, 800))
    .filter(Boolean)
    .slice(0, 12);
  return sentences.length > 0 ? sentences : [caption];
};

export const createDiagramCandidateFromFigure = ({
  caption: rawCaption,
  media,
  regions,
  request,
  sourceHash,
  generatedAt,
  section,
  position,
  sourceIdentity,
}: {
  caption: string;
  media: readonly {
    kind: "image" | "video";
    src: string;
    resourceTitle?: string;
    alt: string;
    width?: number;
    height?: number;
  }[];
  regions: readonly { label: string; description?: string }[];
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  section: import("./article-context-types").ContextSection;
  position: number;
  sourceIdentity: string;
}): BlockCandidate | null => {
  const image = media.find((candidate) => candidate.kind === "image");
  const src = image ? normalizeCommonsImageUrl(image.src) : null;
  const parts = regions
    .map((region, index) => ({
      id: uniqueId("part", region.label, index),
      label: sanitizeContextText(region.label, 200),
      ...(region.description
        ? { description: sanitizeContextText(region.description, 500) }
        : {}),
    }))
    .filter(
      (part, index, all) =>
        Boolean(part.label) &&
        all.findIndex(
          (candidate) =>
            candidate.label.toLocaleLowerCase() ===
            part.label.toLocaleLowerCase(),
        ) === index,
    );
  const sourceCaption = sanitizeContextCaption(rawCaption, 2_500);
  const semanticDescription = {
    caption: sourceCaption,
    alt: sanitizeContextText(image?.alt ?? "", 1_000),
    resourceTitle: sanitizeContextText(image?.resourceTitle ?? "", 1_000),
  };
  if (
    !image ||
    !src ||
    (parts.length === 0 && !isDiagramDescription(semanticDescription))
  ) {
    return null;
  }
  if (
    (image.width != null && image.width < 100) ||
    (image.height != null && image.height < 100)
  ) {
    return null;
  }
  const caption =
    sourceCaption ||
    sanitizeContextCaption(image.alt, 2_500) ||
    `${section.index === "__summary__" ? request.title : section.title} image map`;
  const walkthrough = captionWalkthrough(caption);
  const subject =
    section.index === "__summary__" ? request.title : section.title;
  const sourceTitle = image.resourceTitle?.replace(/^(?:File|Image):/i, "");
  const extraSources: ContextSource[] = sourceTitle
    ? [
        {
          label: `Wikimedia Commons file: ${sourceTitle.replace(/_/g, " ")}`,
          url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(
            sourceTitle.replace(/ /g, "_"),
          )}`,
          accessedAt: generatedAt,
        },
      ]
    : [];
  const base = buildBaseBlock({
    request,
    sourceHash,
    generatedAt,
    kind: "diagram",
    section,
    title: `${subject} diagram`,
    caption: sanitizeContextText(walkthrough[0] || caption, 800),
    longDescription: `${caption}${
      parts.length > 0
        ? ` Named regions in the source image are ${parts
            .map((part) => part.label)
            .join(", ")}.`
        : ""
    }`,
    sourceIdentity,
    extraSources,
  });
  return {
    block: {
      ...base,
      kind: "diagram",
      diagram: {
        image: {
          src,
          alt: sanitizeContextText(image.alt, 1_000) || caption,
          ...(image.width != null ? { width: Math.round(image.width) } : {}),
          ...(image.height != null ? { height: Math.round(image.height) } : {}),
        },
        parts,
        relationships: [],
        walkthrough,
        caption,
      },
    },
    position,
    priority: 62,
  };
};
