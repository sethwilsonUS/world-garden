/** @typedef {"development" | "preview" | "e2e" | "production"} ConvexEnvironmentVariant */

/** Public development deployment; never used as a preview/production fallback. */
const DEVELOPMENT_CONVEX_URL = "https://standing-finch-735.convex.cloud";

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** @param {string} hostname */
const isLoopbackHost = (hostname) =>
  hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";

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
  if (paddingLength > 0 && normalizedEncoded.length % 4 !== 0)
    return undefined;
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

module.exports = {
  DEVELOPMENT_CONVEX_URL,
  resolveClerkPublishableKey,
  resolveConvexDeploymentUrl,
};
