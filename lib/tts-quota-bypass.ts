import { TTS_QUOTA_BYPASS_HEADER } from "./tts-quota-headers";
import {
  AUDIO_CACHE_READ_ATTESTATION_SCOPE,
  AUDIO_CACHE_READ_RESULT_ATTESTATION_SCOPE,
  AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
  AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
  AUDIO_CACHE_WRITE_FAILURE_ATTESTATION_SCOPE,
  buildAudioCacheReadAttestationPayload,
  buildAudioCacheReadResultAttestationPayload,
  buildAudioCacheSaveAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
  buildAudioCacheWriteFailureAttestationPayload,
  type AudioCacheReadAttestationPayload,
  type AudioCacheReadResultAttestationPayload,
  type AudioCacheSaveAttestationPayload,
  type AudioCacheWriteFailureAttestationPayload,
} from "./audio-cache-attestation";
import {
  createServerAttestation,
  requireServerAttestationSecret,
  type ServerAttestation,
} from "./server-attestation";
import { createTtsQuotaBypassHeaderValue } from "./tts-quota-bypass-attestation";
import { isTrustedAudioGenerationBaseUrl } from "./audio-generation-url";
import {
  createTtsSourceAttestationHeaderValue,
  TTS_AI_COST_SOURCE_ATTESTATION_HEADER,
  TTS_AI_COST_SOURCE_HEADER,
  type TtsAiCostSource,
} from "./tts-source-attestation";

export { TTS_QUOTA_BYPASS_HEADER };

export const createAudioCacheReadAttestation = async (
  args: AudioCacheReadAttestationPayload,
): Promise<ServerAttestation> =>
  await createServerAttestation({
    scope: AUDIO_CACHE_READ_ATTESTATION_SCOPE,
    payload: buildAudioCacheReadAttestationPayload(args),
    secret: requireServerAttestationSecret(),
  });

export const createAudioCacheReadResultAttestation = async (
  args: AudioCacheReadResultAttestationPayload,
): Promise<ServerAttestation> =>
  await createServerAttestation({
    scope: AUDIO_CACHE_READ_RESULT_ATTESTATION_SCOPE,
    payload: buildAudioCacheReadResultAttestationPayload(args),
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

export const createAudioCacheWriteFailureAttestation = async (
  args: AudioCacheWriteFailureAttestationPayload,
): Promise<ServerAttestation> =>
  await createServerAttestation({
    scope: AUDIO_CACHE_WRITE_FAILURE_ATTESTATION_SCOPE,
    payload: buildAudioCacheWriteFailureAttestationPayload(args),
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
): Promise<Record<string, string> | undefined> => {
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

export const getTrustedTtsGenerationHeaders = async (
  baseUrl: string,
  source: TtsAiCostSource,
  options: { bypassOpenAiQuota?: boolean } = {},
): Promise<Record<string, string>> => {
  assertTrustedDestination(baseUrl);
  const headers: Record<string, string> = {
    ...getVercelAutomationBypassHeaders(),
    [TTS_AI_COST_SOURCE_HEADER]: source,
  };
  if (process.env.TTS_QUOTA_BYPASS_SECRET?.trim()) {
    try {
      headers[TTS_AI_COST_SOURCE_ATTESTATION_HEADER] =
        await createTtsSourceAttestationHeaderValue(source);
    } catch {
      // Attribution is fail-open; the route records an unsigned claim as unknown.
    }
    if (options.bypassOpenAiQuota) {
      headers[TTS_QUOTA_BYPASS_HEADER] =
        await createTtsQuotaBypassHeaderValue();
    }
  }
  return headers;
};
