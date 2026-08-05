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
const clerkIosCallbackSchemes = new Set([
  "org.curiogarden.app:",
  "org.curiogarden.app.dev:",
  "org.curiogarden.app.preview:",
  "org.curiogarden.app.e2e:",
]);
const clerkAndroidCallbackHosts = new Set([
  "org.curiogarden.app.hosted-callback",
  "org.curiogarden.app.dev.hosted-callback",
  "org.curiogarden.app.preview.hosted-callback",
  "org.curiogarden.app.e2e.hosted-callback",
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

function isExactClerkHostedCallback(path: string): boolean {
  let url: URL;
  try {
    url = new URL(path.trim());
  } catch (error) {
    if (error instanceof TypeError) return false;
    throw error;
  }

  if (
    url.username ||
    url.password ||
    url.port ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.hash
  ) {
    return false;
  }

  const isIosCallback =
    clerkIosCallbackSchemes.has(url.protocol) && url.hostname === "callback";
  const isAndroidCallback =
    url.protocol === "clerk:" && clerkAndroidCallbackHosts.has(url.hostname);

  return isIosCallback || isAndroidCallback;
}

/** Expo Router native-intent adapter. It must never throw for OS-provided input. */
export function redirectIncomingSystemPath(path: string): string | null {
  try {
    // Clerk's auth session owns these exact callbacks. Returning null keeps
    // Expo Router on Account while Clerk validates state, nonce, PKCE, and the
    // created session instead of treating private query parameters as a route.
    if (isExactClerkHostedCallback(path)) return null;

    return canonicalPathFromIncomingPath(path) ?? "/";
  } catch (error) {
    if (__DEV__) {
      console.warn("Ignored an unexpected incoming-link failure", error);
    }
    return "/";
  }
}
