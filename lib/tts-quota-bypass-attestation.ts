import {
  createServerAttestation,
  requireServerAttestationSecret,
  verifyServerAttestation,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "./server-attestation";

export const TTS_QUOTA_BYPASS_ATTESTATION_SCOPE = "tts-quota:bypass";
const MAX_TTS_QUOTA_BYPASS_HEADER_LENGTH = 1_000;

const getTtsQuotaBypassAttestationPayload =
  (): readonly ServerAttestationPayloadValue[] => ["openai-tts"];

const parseServerAttestation = (
  value: string | null | undefined,
): ServerAttestation | undefined => {
  if (!value || value.length > MAX_TTS_QUOTA_BYPASS_HEADER_LENGTH) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ServerAttestation>;
    if (
      typeof parsed.issuedAt !== "number" ||
      typeof parsed.expiresAt !== "number" ||
      typeof parsed.nonce !== "string" ||
      typeof parsed.signature !== "string"
    ) {
      return undefined;
    }
    return parsed as ServerAttestation;
  } catch {
    return undefined;
  }
};

export const createTtsQuotaBypassHeaderValue = async (
  options: { now?: number; ttlMs?: number; nonce?: string } = {},
): Promise<string> =>
  JSON.stringify(
    await createServerAttestation({
      scope: TTS_QUOTA_BYPASS_ATTESTATION_SCOPE,
      payload: getTtsQuotaBypassAttestationPayload(),
      secret: requireServerAttestationSecret(),
      ...options,
    }),
  );

export const verifyTtsQuotaBypassHeaderValue = async (
  value: string | null | undefined,
  options: { secret?: string; now?: number } = {},
): Promise<boolean> =>
  await verifyServerAttestation({
    attestation: parseServerAttestation(value),
    scope: TTS_QUOTA_BYPASS_ATTESTATION_SCOPE,
    payload: getTtsQuotaBypassAttestationPayload(),
    secret:
      options.secret ??
      process.env.TTS_QUOTA_BYPASS_SECRET?.trim() ??
      undefined,
    ...(options.now == null ? {} : { now: options.now }),
  });
