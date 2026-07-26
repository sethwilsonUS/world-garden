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
  parseTrustedHttpsOrigin(process.env.AUDIO_GENERATION_BASE_URL) ??
  parseVercelDeploymentOrigin(process.env.VERCEL_URL) ??
  DEFAULT_AUDIO_GENERATION_BASE_URL;

/**
 * Next.js routes may use their own loopback origin during local development.
 * Deployed requests never trust the inbound Host header; Vercel's validated
 * deployment hostname or the explicit server configuration wins instead.
 */
export const getRequestAudioGenerationBaseUrl = (requestUrl: string): string =>
  parseTrustedHttpsOrigin(process.env.AUDIO_GENERATION_BASE_URL) ??
  parseVercelDeploymentOrigin(process.env.VERCEL_URL) ??
  parseLocalDevelopmentOrigin(requestUrl) ??
  DEFAULT_AUDIO_GENERATION_BASE_URL;
