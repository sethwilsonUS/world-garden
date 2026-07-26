import { TTS_QUOTA_BYPASS_HEADER } from "./tts-quota-headers";
import {
  AUDIO_CACHE_READ_ATTESTATION_SCOPE,
  AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
  AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
  buildAudioCacheReadAttestationPayload,
  buildAudioCacheSaveAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
  type AudioCacheReadAttestationPayload,
  type AudioCacheSaveAttestationPayload,
} from "./audio-cache-attestation";
import {
  createServerAttestation,
  requireServerAttestationSecret,
  type ServerAttestation,
} from "./server-attestation";
import { createTtsQuotaBypassHeaderValue } from "./tts-quota-bypass-attestation";
import { isTrustedAudioGenerationBaseUrl } from "./audio-generation-url";

export { TTS_QUOTA_BYPASS_HEADER };

export const createAudioCacheReadAttestation = async (
  args: AudioCacheReadAttestationPayload,
): Promise<ServerAttestation> =>
  await createServerAttestation({
    scope: AUDIO_CACHE_READ_ATTESTATION_SCOPE,
    payload: buildAudioCacheReadAttestationPayload(args),
    secret: requireServerAttestationSecret(),
  });

export const createAudioCacheUploadAttestation =
  async (): Promise<ServerAttestation> =>
    await createServerAttestation({
      scope: AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
      payload: buildAudioCacheUploadAttestationPayload(),
      secret: requireServerAttestationSecret(),
    });

export const createAudioCacheSaveAttestation = async (
  args: AudioCacheSaveAttestationPayload,
): Promise<ServerAttestation> =>
  await createServerAttestation({
    scope: AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
    payload: buildAudioCacheSaveAttestationPayload(args),
    secret: requireServerAttestationSecret(),
  });

const assertTrustedDestination = (baseUrl: string): void => {
  if (!isTrustedAudioGenerationBaseUrl(baseUrl)) {
    throw new Error(
      "Refusing to attach trusted audio headers to an untrusted origin.",
    );
  }
};

const getVercelAutomationBypassHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {};
  const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (protectionBypass) {
    headers["x-vercel-protection-bypass"] = protectionBypass;
  }
  return headers;
};

export const getTtsQuotaBypassHeaders = async (
  baseUrl: string,
): Promise<
  Record<string, string> | undefined
> => {
  assertTrustedDestination(baseUrl);
  const headers = getVercelAutomationBypassHeaders();
  if (process.env.TTS_QUOTA_BYPASS_SECRET?.trim()) {
    headers[TTS_QUOTA_BYPASS_HEADER] = await createTtsQuotaBypassHeaderValue();
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
};

/** Edge-only public generation never needs authority to bypass OpenAI quota. */
export const getEdgeTtsGenerationHeaders = (
  baseUrl: string,
): Record<string, string> | undefined => {
  assertTrustedDestination(baseUrl);
  const headers = getVercelAutomationBypassHeaders();
  return Object.keys(headers).length > 0 ? headers : undefined;
};
