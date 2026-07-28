import type { AiCostSource } from "./ai-cost-ledger-contract";
import {
  createServerAttestation,
  requireServerAttestationSecret,
  verifyServerAttestation,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "./server-attestation";

export const TTS_AI_COST_SOURCE_HEADER = "X-Curio-AI-Cost-Source";
export const TTS_AI_COST_SOURCE_ATTESTATION_HEADER =
  "X-Curio-AI-Cost-Source-Attestation";
export const TTS_AI_COST_SOURCE_ATTESTATION_SCOPE =
  "ai-cost-ledger:tts-source:v1";
export const TTS_AI_COST_SOURCE_ATTESTATION_TTL_MS = 5 * 60 * 1_000;

const MAX_SOURCE_HEADER_LENGTH = 64;
const MAX_ATTESTATION_HEADER_LENGTH = 1_000;
const ATTESTATION_FIELDS = new Set([
  "issuedAt",
  "expiresAt",
  "nonce",
  "signature",
]);

export const TTS_AI_COST_SOURCES = [
  "interactive_article",
  "article_audio_export",
  "personal_playlist",
  "featured_podcast",
  "trending_podcast",
  "picture_of_day",
  "featured_audio_warm",
] as const satisfies readonly AiCostSource[];

export type TtsAiCostSource = (typeof TTS_AI_COST_SOURCES)[number];

const isTtsAiCostSource = (value: string): value is TtsAiCostSource =>
  (TTS_AI_COST_SOURCES as readonly string[]).includes(value);

const getTtsSourceAttestationPayload = (
  source: TtsAiCostSource,
): readonly ServerAttestationPayloadValue[] => ["tts", source];

const parseAttestation = (
  value: string | null,
): ServerAttestation | undefined => {
  if (!value || value.length > MAX_ATTESTATION_HEADER_LENGTH) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<ServerAttestation>;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      Object.keys(parsed).some((key) => !ATTESTATION_FIELDS.has(key)) ||
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

export const createTtsSourceAttestationHeaderValue = async (
  source: TtsAiCostSource,
  options: {
    secret?: string;
    now?: number;
    ttlMs?: number;
    nonce?: string;
  } = {},
): Promise<string> =>
  JSON.stringify(
    await createServerAttestation({
      scope: TTS_AI_COST_SOURCE_ATTESTATION_SCOPE,
      payload: getTtsSourceAttestationPayload(source),
      secret: options.secret ?? requireServerAttestationSecret(),
      ...(options.now === undefined ? {} : { now: options.now }),
      ttlMs: options.ttlMs ?? TTS_AI_COST_SOURCE_ATTESTATION_TTL_MS,
      ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
    }),
  );

export const resolveTtsAiCostSource = async (
  headers: Headers,
  options: { secret?: string; now?: number } = {},
): Promise<AiCostSource> => {
  const sourceValue = headers.get(TTS_AI_COST_SOURCE_HEADER);
  const attestationValue = headers.get(TTS_AI_COST_SOURCE_ATTESTATION_HEADER);
  if (sourceValue === null && attestationValue === null) {
    return "interactive_article";
  }
  if (
    !sourceValue ||
    sourceValue.length > MAX_SOURCE_HEADER_LENGTH ||
    !isTtsAiCostSource(sourceValue)
  ) {
    return "unknown";
  }
  const valid = await verifyServerAttestation({
    attestation: parseAttestation(attestationValue),
    scope: TTS_AI_COST_SOURCE_ATTESTATION_SCOPE,
    payload: getTtsSourceAttestationPayload(sourceValue),
    secret:
      options.secret ??
      process.env.TTS_QUOTA_BYPASS_SECRET?.trim() ??
      undefined,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return valid ? sourceValue : "unknown";
};
