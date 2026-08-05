/** @typedef {"development" | "preview" | "e2e" | "production"} ConvexEnvironmentVariant */

/** Public development deployment; never used as a preview/production fallback. */
const DEVELOPMENT_CONVEX_URL = "https://standing-finch-735.convex.cloud";
/** Local web application used by development tooling and unsigned E2E runs. */
const DEVELOPMENT_WEB_ORIGIN = "http://127.0.0.1:3000";
/** The only web application origin a production native build may contact. */
const PRODUCTION_WEB_ORIGIN = "https://curiogarden.org";

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** @param {string} hostname */
const isLoopbackHost = (hostname) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

/** @param {string} hostname */
const isApprovedLocalWebHost = (hostname) =>
  isLoopbackHost(hostname) || hostname === "10.0.2.2";

/** @param {string} hostname */
const isProductionWebHost = (hostname) =>
  hostname === "curiogarden.org" ||
  hostname === "www.curiogarden.org" ||
  hostname === "world-garden.vercel.app";

/** @param {string} hostname */
const isApprovedPrPreviewWebHost = (hostname) => {
  const normalized = hostname.toLowerCase();
  const hasValidLabels = normalized
    .split(".")
    .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));

  return (
    hasValidLabels &&
    /^world-garden-git-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?-sethwilsonus-projects\.vercel\.app$/.test(
      normalized,
    )
  );
};

/**
 * URL parsing normalizes dot segments, so retain a lexical origin-only check
 * as well as checking the parsed URL components.
 * @param {string} candidate
 */
const containsOnlyOriginSyntax = (candidate) => {
  const authorityStart = candidate.indexOf("://") + 3;
  if (authorityStart < 3) return false;

  const pathStart = candidate.indexOf("/", authorityStart);
  return pathStart < 0 || candidate.slice(pathStart) === "/";
};

/** @param {string} encoded */
const decodeBase64 = (encoded) => {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) return undefined;

  const normalizedEncoded = encoded.replace(/-/g, "+").replace(/_/g, "/");

  const paddingLength =
    normalizedEncoded.length - normalizedEncoded.replace(/=+$/, "").length;
  const unpadded = normalizedEncoded.slice(
    0,
    normalizedEncoded.length - paddingLength,
  );
  const remainder = unpadded.length % 4;
  if (remainder === 1) return undefined;
  if (paddingLength > 0 && normalizedEncoded.length % 4 !== 0) return undefined;
  if (
    (paddingLength === 1 && remainder !== 3) ||
    (paddingLength === 2 && remainder !== 2)
  ) {
    return undefined;
  }

  let decoded = "";
  for (let offset = 0; offset < unpadded.length; offset += 4) {
    const remaining = Math.min(4, unpadded.length - offset);
    const first = BASE64_ALPHABET.indexOf(unpadded[offset] ?? "");
    const second = BASE64_ALPHABET.indexOf(unpadded[offset + 1] ?? "");
    const third =
      remaining > 2 ? BASE64_ALPHABET.indexOf(unpadded[offset + 2] ?? "") : 0;
    const fourth =
      remaining > 3 ? BASE64_ALPHABET.indexOf(unpadded[offset + 3] ?? "") : 0;

    if (first < 0 || second < 0 || third < 0 || fourth < 0) return undefined;

    const bytes = (first << 18) | (second << 12) | (third << 6) | fourth;
    decoded += String.fromCharCode((bytes >> 16) & 0xff);
    if (remaining > 2) decoded += String.fromCharCode((bytes >> 8) & 0xff);
    if (remaining > 3) decoded += String.fromCharCode(bytes & 0xff);
  }

  return decoded;
};

/** @param {string} key */
const isValidClerkPublishableKey = (key) => {
  const prefix = key.startsWith("pk_test_")
    ? "pk_test_"
    : key.startsWith("pk_live_")
      ? "pk_live_"
      : undefined;
  if (!prefix) return false;

  const decoded = decodeBase64(key.slice(prefix.length));
  if (!decoded?.endsWith("$")) return false;

  const frontendApi = decoded.slice(0, -1);
  return frontendApi.includes(".") && !frontendApi.includes("$");
};

/**
 * @param {ConvexEnvironmentVariant} variant
 * @param {string | undefined} configuredValue
 * @returns {string}
 */
function resolveConvexDeploymentUrl(variant, configuredValue) {
  const configured = configuredValue?.trim();
  const candidate =
    configured ||
    (variant === "development" || variant === "e2e"
      ? DEVELOPMENT_CONVEX_URL
      : "");

  if (!candidate) {
    throw new Error(`EXPO_PUBLIC_CONVEX_URL is required for ${variant} builds`);
  }

  let url;
  try {
    url = new URL(candidate);
  } catch (error) {
    throw new Error("EXPO_PUBLIC_CONVEX_URL must be a valid URL", {
      cause: error,
    });
  }

  const isDevelopmentLoopback =
    variant === "development" &&
    url.protocol === "http:" &&
    isLoopbackHost(url.hostname);

  if (url.protocol !== "https:" && !isDevelopmentLoopback) {
    throw new Error("EXPO_PUBLIC_CONVEX_URL must use HTTPS");
  }
  if (
    url.username ||
    url.password ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error("EXPO_PUBLIC_CONVEX_URL must contain only an origin");
  }
  if (!isDevelopmentLoopback && !url.hostname.endsWith(".convex.cloud")) {
    throw new Error("EXPO_PUBLIC_CONVEX_URL must name a Convex deployment");
  }
  if (
    (variant === "preview" || variant === "production") &&
    url.origin === DEVELOPMENT_CONVEX_URL
  ) {
    throw new Error(
      `${variant} builds must not use the development deployment`,
    );
  }

  return url.origin;
}

/**
 * @param {ConvexEnvironmentVariant} variant
 * @param {string | undefined} configuredValue
 * @returns {string}
 */
function resolveClerkPublishableKey(variant, configuredValue) {
  const configured = configuredValue?.trim();
  if (!configured) {
    throw new Error(
      `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required for ${variant} builds`,
    );
  }
  if (!isValidClerkPublishableKey(configured)) {
    throw new Error(
      "EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY must be a valid Clerk publishable key",
    );
  }

  const expectedInstance = variant === "production" ? "live" : "test";
  if (!configured.startsWith(`pk_${expectedInstance}_`)) {
    throw new Error(
      `${variant} builds must use a Clerk ${expectedInstance} publishable key`,
    );
  }

  return configured;
}

/**
 * @param {ConvexEnvironmentVariant} variant
 * @param {string | undefined} configuredValue
 * @param {{ requireExplicitHttps?: boolean } | undefined} options
 * @returns {string}
 */
function resolvePublicWebOrigin(variant, configuredValue, options) {
  const configured = configuredValue?.trim();
  const requireExplicitHttps =
    variant !== "production" && options?.requireExplicitHttps === true;

  if (requireExplicitHttps && !configured) {
    throw new Error(
      "Cloud non-production builds require an explicit HTTPS web origin",
    );
  }

  const candidate =
    configured ||
    (variant === "development" || variant === "e2e"
      ? DEVELOPMENT_WEB_ORIGIN
      : variant === "production"
        ? PRODUCTION_WEB_ORIGIN
        : "");

  if (!candidate) {
    throw new Error(`EXPO_PUBLIC_WEB_ORIGIN is required for ${variant} builds`);
  }

  let url;
  try {
    url = new URL(candidate);
  } catch (error) {
    throw new Error("EXPO_PUBLIC_WEB_ORIGIN must be a valid URL", {
      cause: error,
    });
  }

  if (
    url.username ||
    url.password ||
    !containsOnlyOriginSyntax(candidate) ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error("EXPO_PUBLIC_WEB_ORIGIN must contain only an origin");
  }

  if (requireExplicitHttps && url.protocol !== "https:") {
    throw new Error(
      "Cloud non-production builds require an explicit HTTPS web origin",
    );
  }

  if (variant === "production") {
    if (url.origin !== PRODUCTION_WEB_ORIGIN) {
      throw new Error(`production builds must use ${PRODUCTION_WEB_ORIGIN}`);
    }
    return PRODUCTION_WEB_ORIGIN;
  }

  if (isProductionWebHost(url.hostname)) {
    throw new Error(`${variant} builds must not use the production web origin`);
  }

  if (url.protocol === "http:") {
    if (variant === "preview") {
      throw new Error(
        "EXPO_PUBLIC_WEB_ORIGIN must use HTTPS for preview builds",
      );
    }
    if (!isApprovedLocalWebHost(url.hostname)) {
      throw new Error(
        "EXPO_PUBLIC_WEB_ORIGIN must use HTTPS or an approved local HTTP host",
      );
    }
    return url.origin;
  }

  if (url.protocol !== "https:") {
    throw new Error("EXPO_PUBLIC_WEB_ORIGIN must use HTTPS");
  }
  if (url.port !== "") {
    throw new Error("EXPO_PUBLIC_WEB_ORIGIN must use canonical HTTPS port 443");
  }
  if (!isApprovedPrPreviewWebHost(url.hostname)) {
    throw new Error(
      "EXPO_PUBLIC_WEB_ORIGIN must name an approved Curio Garden PR preview host",
    );
  }

  return url.origin;
}

module.exports = {
  DEVELOPMENT_CONVEX_URL,
  DEVELOPMENT_WEB_ORIGIN,
  PRODUCTION_WEB_ORIGIN,
  resolveClerkPublishableKey,
  resolveConvexDeploymentUrl,
  resolvePublicWebOrigin,
};
