import { parseCanonicalArticlePath } from "@curio-garden/domain";

export type NativeArticleHref = Readonly<{
  pathname: "/article/[slug]";
  params: Readonly<{ slug: string }>;
}>;

const nativeSchemes = new Set([
  "curiogarden:",
  "curiogarden-dev:",
  "curiogarden-preview:",
  "curiogarden-e2e:",
]);

export function normalizeNativeArticleSlug(
  slug: string | string[] | undefined,
): string | null {
  const firstSlug = Array.isArray(slug) ? slug[0] : slug;
  const normalizedSlug = firstSlug?.normalize("NFC").trim() ?? "";
  if (!normalizedSlug || normalizedSlug.length > 512) return null;

  try {
    return (
      parseCanonicalArticlePath(
        `/article/${encodeURIComponent(normalizedSlug)}`,
      )?.slug ?? null
    );
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

export function mapCanonicalPathToNativeHref(
  path: string,
): NativeArticleHref | null {
  const route = parseCanonicalArticlePath(path);
  return route
    ? {
        pathname: "/article/[slug]",
        params: { slug: route.slug },
      }
    : null;
}

function canonicalPathFromIncomingPath(path: string): string | null {
  const trimmed = path.trim();
  if (trimmed.startsWith("/")) {
    return parseCanonicalArticlePath(trimmed)?.canonicalPath ?? null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch (error) {
    if (error instanceof TypeError) return null;
    throw error;
  }

  if (url.username || url.password || url.port || url.search || url.hash) {
    return null;
  }

  if (url.protocol === "https:") {
    if (url.hostname !== "curiogarden.org") return null;
    return parseCanonicalArticlePath(url.pathname)?.canonicalPath ?? null;
  }

  if (!nativeSchemes.has(url.protocol)) return null;
  const canonicalPath = url.hostname
    ? `/${url.hostname}${url.pathname}`
    : url.pathname;
  return parseCanonicalArticlePath(canonicalPath)?.canonicalPath ?? null;
}

/** Expo Router native-intent adapter. It must never throw for OS-provided input. */
export function redirectIncomingSystemPath(path: string): string {
  try {
    return canonicalPathFromIncomingPath(path) ?? "/";
  } catch (error) {
    if (__DEV__) {
      console.warn("Ignored an unexpected incoming-link failure", error);
    }
    return "/";
  }
}
