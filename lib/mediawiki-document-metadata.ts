import type { MediaWikiDocument } from "./mediawiki-document";
import type {
  WikipediaArticleImage,
  WikipediaParsedPageData,
} from "./wikipedia-contracts";
import { buildWikimediaSourceFallback } from "./wikimedia-media";
import { isArticleGalleryImageCandidate } from "./article-image-policy";

export const createParsedPageDataFromDocument = (
  document: MediaWikiDocument,
): WikipediaParsedPageData => {
  const seenImages = new Set<string>();
  const images: WikipediaArticleImage[] = [];
  for (const section of document.sections) {
    if (section.role !== "body") continue;
    for (const block of section.blocks) {
      if (block.kind !== "figure") continue;
      for (const media of block.media) {
        const src = media.kind === "video" ? media.posterSrc : media.src;
        if (!src || seenImages.has(src)) continue;
        if (
          !isArticleGalleryImageCandidate({
            src,
            width: media.width,
            height: media.height,
          })
        ) {
          continue;
        }
        seenImages.add(src);
        images.push({
          src,
          alt: media.alt,
          caption: block.caption,
          ...(media.width != null ? { width: media.width } : {}),
          ...(media.height != null ? { height: media.height } : {}),
          ...(media.kind === "video" ? { videoSrc: media.src } : {}),
          ...(media.resourceTitle
            ? {
                attribution: buildWikimediaSourceFallback(media.resourceTitle),
              }
            : {}),
        });
      }
    }
  }

  return {
    linkCounts: document.sections.map((section) => ({
      index: section.key,
      title: section.key === "__summary__" ? "__summary__" : section.title,
      count: section.links.length,
    })),
    citations: document.citations.map((citation) => ({ ...citation })),
    sectionCitations: document.sections.map((section) => ({
      index: section.key,
      title: section.key === "__summary__" ? "__summary__" : section.title,
      count: section.citationIds.length,
      citationIds: [...section.citationIds],
    })),
    sectionIndexMap: document.sections.flatMap((section) =>
      section.key === "__summary__"
        ? []
        : [{ title: section.title, index: section.key }],
    ),
    images,
  };
};
