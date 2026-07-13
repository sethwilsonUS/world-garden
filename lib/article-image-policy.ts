export const ARTICLE_GALLERY_MIN_IMAGE_DIMENSION = 100;
export const ARTICLE_GALLERY_MAX_ASPECT_RATIO = 3;

type ArticleImageCandidate = {
  src: string;
  width?: number;
  height?: number;
};

/**
 * Keep the Gallery and visual-context deduplication policy in lockstep.
 * Missing dimensions remain eligible, matching MediaWiki's existing fallback
 * behavior when an image omits intrinsic sizing.
 */
export const isArticleGalleryImageCandidate = ({
  src,
  width,
  height,
}: ArticleImageCandidate): boolean => {
  const normalizedSrc = src.startsWith("//") ? `https:${src}` : src;
  let pathname = normalizedSrc;
  try {
    pathname = new URL(normalizedSrc).pathname;
  } catch {
    // The Gallery will reject an unusable URL when it renders. Preserve the
    // existing dimension policy here rather than guessing at its path.
  }

  if (/\.svg$/i.test(pathname) || /\/math\//i.test(pathname)) return false;
  if (
    (typeof width === "number" && width > 0 && width < ARTICLE_GALLERY_MIN_IMAGE_DIMENSION) ||
    (typeof height === "number" && height > 0 && height < ARTICLE_GALLERY_MIN_IMAGE_DIMENSION)
  ) {
    return false;
  }

  if (
    typeof width === "number" &&
    width > 0 &&
    typeof height === "number" &&
    height > 0
  ) {
    const ratio = width / height;
    if (
      ratio > ARTICLE_GALLERY_MAX_ASPECT_RATIO ||
      ratio < 1 / ARTICLE_GALLERY_MAX_ASPECT_RATIO
    ) {
      return false;
    }
  }

  return true;
};
