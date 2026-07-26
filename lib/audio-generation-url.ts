const DEFAULT_AUDIO_GENERATION_BASE_URL = "https://curiogarden.org";

const parseTrustedHttpsOrigin = (value: string | undefined): string | null => {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
};

const parseVercelDeploymentOrigin = (
  value: string | undefined,
): string | null => {
  const hostname = value?.trim().toLowerCase();
  if (
    !hostname ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.vercel\.app$/.test(
      hostname,
    )
  ) {
    return null;
  }
  return `https://${hostname}`;
};

const parseLocalDevelopmentOrigin = (value: string): string | null => {
  if (process.env.NODE_ENV === "production") return null;
  try {
    const url = new URL(value);
    const isLoopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    return isLoopback && (url.protocol === "http:" || url.protocol === "https:")
      ? url.origin
      : null;
  } catch {
    return null;
  }
};

/**
 * Server-controlled origin used by Convex audio workers. Public mutations and
 * actions must never forward a browser-supplied origin alongside trusted TTS
 * credentials.
 */
export const getAudioGenerationBaseUrl = (): string =>
  (() => {
    const vercelDeploymentOrigin = parseVercelDeploymentOrigin(
      process.env.VERCEL_URL,
    );
    if (process.env.VERCEL_ENV === "preview") {
      if (!vercelDeploymentOrigin) {
        throw new Error(
          "A validated Vercel Preview audio origin is required for self-calls.",
        );
      }
      return vercelDeploymentOrigin;
    }

    return (
      parseTrustedHttpsOrigin(process.env.AUDIO_GENERATION_BASE_URL) ??
      vercelDeploymentOrigin ??
      DEFAULT_AUDIO_GENERATION_BASE_URL
    );
  })();

/**
 * Trusted service headers may only be attached to the exact server-selected
 * audio origin. Loopback remains available for local development without
 * making arbitrary HTTP origins eligible for credentials.
 */
export const isTrustedAudioGenerationBaseUrl = (value: string): boolean => {
  const candidate =
    parseTrustedHttpsOrigin(value) ?? parseLocalDevelopmentOrigin(value);
  if (!candidate) return false;

  const localCandidate = parseLocalDevelopmentOrigin(value);
  if (localCandidate) return candidate === localCandidate;

  return candidate === getAudioGenerationBaseUrl();
};

/**
 * Next.js routes may use their own loopback origin during local development.
 * Deployed requests never trust the inbound Host header; Vercel's validated
 * deployment hostname or the explicit server configuration wins instead.
 */
export const getRequestAudioGenerationBaseUrl = (
  requestUrl: string,
): string => {
  const vercelDeploymentOrigin = parseVercelDeploymentOrigin(
    process.env.VERCEL_URL,
  );
  if (process.env.VERCEL_ENV === "preview") {
    if (!vercelDeploymentOrigin) {
      throw new Error(
        "A validated Vercel Preview audio origin is required for self-calls.",
      );
    }
    return vercelDeploymentOrigin;
  }

  return (
    parseTrustedHttpsOrigin(process.env.AUDIO_GENERATION_BASE_URL) ??
    vercelDeploymentOrigin ??
    parseLocalDevelopmentOrigin(requestUrl) ??
    DEFAULT_AUDIO_GENERATION_BASE_URL
  );
};
