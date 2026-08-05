const ARTICLE_PATH_PREFIX = "/article/";
const CANONICAL_HOST = "curiogarden.org";

export type CanonicalArticlePath = `/article/${string}`;

export type ArticleRoute = Readonly<{
  kind: "article";
  /** Decoded Wikipedia slug. Word separators remain underscores. */
  slug: string;
  /** Exactly-once encoded path shared by the web and native routers. */
  canonicalPath: CanonicalArticlePath;
}>;

const normalizeTitle = (title: string): string =>
  title.normalize("NFC").replace(/\s+/gu, " ").trim();

const articleRouteFromSlug = (slug: string): ArticleRoute => {
  const normalizedSlug = slug.normalize("NFC");
  if (
    normalizedSlug.length === 0 ||
    normalizedSlug.trim() !== normalizedSlug ||
    normalizedSlug === "." ||
    normalizedSlug === ".." ||
    /[\u0000-\u001f\u007f]/u.test(normalizedSlug)
  ) {
    throw new RangeError("Article titles must produce a safe, non-empty slug");
  }

  return {
    kind: "article",
    slug: normalizedSlug,
    canonicalPath: `${ARTICLE_PATH_PREFIX}${encodeURIComponent(normalizedSlug)}`,
  };
};

export function articleRouteFromTitle(title: string): ArticleRoute {
  const normalizedTitle = normalizeTitle(title);
  return articleRouteFromSlug(normalizedTitle.replaceAll(" ", "_"));
}

const canonicalPathFromLocation = (location: string): string | null => {
  if (location.includes("?") || location.includes("#")) return null;
  if (location.startsWith("/")) return location;

  const absolute = location.match(
    /^([a-z][a-z\d+.-]*):\/\/([^/?#]+)(\/[^?#]*)$/iu,
  );
  if (!absolute) return null;

  const [, scheme, host, path] = absolute;
  if (
    scheme?.toLocaleLowerCase("en-US") !== "https" ||
    host?.toLocaleLowerCase("en-US") !== CANONICAL_HOST
  ) {
    return null;
  }

  return path ?? null;
};

/**
 * Parse an untrusted canonical Curio Garden article path or canonical HTTPS
 * URL. Invalid encodings and non-canonical locations return null, never throw.
 */
export function parseCanonicalArticlePath(
  location: string,
): ArticleRoute | null {
  const path = canonicalPathFromLocation(location);
  if (path === null || !path.startsWith(ARTICLE_PATH_PREFIX)) return null;

  const encodedSlug = path.slice(ARTICLE_PATH_PREFIX.length);
  if (encodedSlug.length === 0 || encodedSlug.includes("/")) return null;

  try {
    return articleRouteFromSlug(decodeURIComponent(encodedSlug));
  } catch (error) {
    if (error instanceof URIError || error instanceof RangeError) return null;
    throw error;
  }
}
