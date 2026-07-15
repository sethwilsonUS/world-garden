import {
  type ArticleContextRequest,
  type ContextDiagramBlock,
  type ContextSource,
} from "./article-context-types";
import {
  buildBaseBlock,
  finiteNumber,
  parseAttributes,
  sanitizeContextCaption,
  sanitizeContextText,
  sectionAtOffset,
  uniqueId,
  type BlockCandidate,
  type MediaWikiParsedSource,
  type SectionBoundary,
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

const commonsFileSource = (
  figureHtml: string,
  accessedAt: string,
): ContextSource | null => {
  const anchorAttrs = [...figureHtml.matchAll(/<a\b([^>]*)>/gi)]
    .map((match) => parseAttributes(match[1]))
    .find((attrs) =>
      attrs.class?.split(/\s+/).includes("mw-file-description"),
    );
  const href = anchorAttrs?.href;
  if (!href) return null;
  const fileMatch = href.match(/\/wiki\/(?:File|Image):([^?#]+)/i);
  if (!fileMatch) return null;
  let fileName: string;
  try {
    fileName = decodeURIComponent(fileMatch[1]).replace(/_/g, " ");
  } catch {
    fileName = fileMatch[1].replace(/_/g, " ");
  }
  const safeName = sanitizeContextText(fileName, 300);
  if (!safeName) return null;
  return {
    label: `Wikimedia Commons file: ${safeName}`,
    url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(
      safeName.replace(/ /g, "_"),
    )}`,
    accessedAt,
  };
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

const isDiagramCaption = (caption: string): boolean =>
  EXPLICIT_DIAGRAM_CAPTION_PATTERN.test(caption) ||
  DIAGRAM_ARROW_NOTATION_PATTERN.test(caption) ||
  DIAGRAM_CIRCULAR_SEQUENCE_PATTERN.test(caption);

const captionWalkthrough = (caption: string): string[] => {
  const sentences = caption
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sanitizeContextText(sentence, 800))
    .filter(Boolean)
    .slice(0, 12);
  return sentences.length > 0 ? sentences : [caption];
};

export const extractDiagramCandidates = ({
  source,
  request,
  sourceHash,
  generatedAt,
  boundaries,
}: {
  source: MediaWikiParsedSource;
  request: ArticleContextRequest;
  sourceHash: string;
  generatedAt: string;
  boundaries: SectionBoundary[];
}): BlockCandidate[] => {
  const candidates: BlockCandidate[] = [];
  let figureIndex = 0;
  for (const match of source.html.matchAll(
    /<figure\b([^>]*)>([\s\S]*?)<\/figure>/gi,
  )) {
    const figureHtml = match[2];
    if (/<(?:video|audio|wiki-chart)\b/i.test(figureHtml)) continue;
    const imageMatch = figureHtml.match(/<img\b([^>]*)>/i);
    const captionMatch = figureHtml.match(
      /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption>/i,
    );
    if (!imageMatch || !captionMatch) continue;
    const imageAttrs = parseAttributes(imageMatch[1]);
    const src = normalizeCommonsImageUrl(imageAttrs.src ?? "");
    const caption = sanitizeContextCaption(captionMatch[1], 2_500);
    if (!src || caption.length < 40 || !isDiagramCaption(caption)) {
      continue;
    }
    const width = finiteNumber(imageAttrs.width);
    const height = finiteNumber(imageAttrs.height);
    if ((width != null && width < 100) || (height != null && height < 100)) {
      continue;
    }
    const parts = [...figureHtml.matchAll(/<area\b([^>]*)>/gi)]
      .slice(0, 100)
      .flatMap((areaMatch, index) => {
        const attrs = parseAttributes(areaMatch[1]);
        const label = sanitizeContextText(attrs.alt || attrs.title || "", 200);
        return label
          ? [
              {
                id: uniqueId("part", label, index),
                label,
                ...(attrs.title && attrs.title !== label
                  ? { description: sanitizeContextText(attrs.title, 500) }
                  : {}),
              },
            ]
          : [];
      })
      .filter(
        (part, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.label.toLowerCase() === part.label.toLowerCase(),
          ) === index,
      );
    const walkthrough = captionWalkthrough(caption);
    if (walkthrough.length === 0 && parts.length === 0) continue;
    const relationships: ContextDiagramBlock["diagram"]["relationships"] = [];
    const section = sectionAtOffset(boundaries, match.index ?? 0);
    const subject =
      section.index === "__summary__" ? request.title : section.title;
    const blockCaption = sanitizeContextText(walkthrough[0] || caption, 800);
    const fileSource = commonsFileSource(figureHtml, generatedAt);
    const base = buildBaseBlock({
      request,
      sourceHash,
      generatedAt,
      kind: "diagram",
      section,
      title: `${subject} diagram`,
      caption: blockCaption,
      longDescription: `${caption}${
        parts.length > 0
          ? ` Named regions in the source image are ${parts
              .map((part) => part.label)
              .join(", ")}.`
          : ""
      }`,
      sourceIdentity: `figure:${figureIndex}:${src}:${caption}`,
      extraSources: fileSource ? [fileSource] : [],
    });
    const block: ContextDiagramBlock = {
      ...base,
      kind: "diagram",
      diagram: {
        image: {
          src,
          alt: caption,
          ...(width != null && width > 0 ? { width: Math.round(width) } : {}),
          ...(height != null && height > 0
            ? { height: Math.round(height) }
            : {}),
        },
        parts,
        relationships,
        walkthrough,
        caption,
      },
    };
    candidates.push({ block, position: match.index ?? 0, priority: 62 });
    figureIndex += 1;
  }
  return candidates;
};
