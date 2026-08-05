/** @typedef {"development" | "preview" | "e2e" | "production"} ConvexEnvironmentVariant */

/** Public development deployment; never used as a preview/production fallback. */
const DEVELOPMENT_CONVEX_URL = "https://standing-finch-735.convex.cloud";

/** @param {string} hostname */
const isLoopbackHost = (hostname) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

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

module.exports = {
  DEVELOPMENT_CONVEX_URL,
  resolveConvexDeploymentUrl,
};
