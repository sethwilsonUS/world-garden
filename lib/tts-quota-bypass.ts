import { TTS_QUOTA_BYPASS_HEADER } from "./tts-quota-headers";
import {
  AUDIO_CACHE_SAVE_ATTESTATION_SCOPE,
  AUDIO_CACHE_UPLOAD_ATTESTATION_SCOPE,
  buildAudioCacheSaveAttestationPayload,
  buildAudioCacheUploadAttestationPayload,
  type AudioCacheSaveAttestationPayload,
} from "./audio-cache-attestation";
import {
  createServerAttestation,
  getServerAttestationSecret,
  requireServerAttestationSecret,
  type ServerAttestation,
} from "./server-attestation";

export { TTS_QUOTA_BYPASS_HEADER };

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

export const getTtsQuotaBypassHeaders = ():
  | Record<typeof TTS_QUOTA_BYPASS_HEADER, string>
  | undefined => {
  const secret = getServerAttestationSecret();
  if (!secret) return undefined;
  return { [TTS_QUOTA_BYPASS_HEADER]: secret };
};
