import type { ContextBlock } from "./article-context-types";
import { isArticleGalleryImageCandidate } from "./article-image-policy";
import { getWikimediaMediaIdentity } from "./wikimedia-media";

const diagramMediaIdentities = (block: Extract<ContextBlock, { kind: "diagram" }>) =>
  new Set(
    [block.diagram.image.src, block.diagram.image.originalSrc]
      .map(getWikimediaMediaIdentity)
      .filter((identity): identity is string => Boolean(identity)),
  );

/**
 * Context diagrams originate in article figures. If that figure qualifies for
 * Gallery and uses the hero's canonical media file, Context would be a third
 * presentation of the same image. Keep Hero and Gallery; omit only that third
 * copy. Distinct diagrams and figures excluded from Gallery remain available.
 */
export const getVisibleArticleContextBlocks = (
  blocks: ContextBlock[],
  heroImageUrl: string | undefined,
): ContextBlock[] => {
  const heroIdentity = getWikimediaMediaIdentity(heroImageUrl);
  if (!heroIdentity) return blocks;

  const visible = blocks.filter((block) => {
    if (block.kind !== "diagram") return true;
    if (!isArticleGalleryImageCandidate(block.diagram.image)) return true;
    return !diagramMediaIdentities(block).has(heroIdentity);
  });

  return visible.length === blocks.length ? blocks : visible;
};
