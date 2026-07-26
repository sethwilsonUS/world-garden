import {
  createServerAttestation,
  requireServerAttestationSecret,
  verifyServerAttestation,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "./server-attestation";

export const PUBLIC_AUDIO_WRITE_ATTESTATION_SCOPE = "public-audio:write";

export type PublicAudioPipeline =
  | "did-you-know"
  | "featured"
  | "picture-of-day"
  | "today"
  | "trending";

export type PublicAudioWriteOperation =
  | "claim-job"
  | "finalize-job"
  | "generate-upload-url"
  | "save-record"
  | "save-show-asset"
  | "upsert-job";

type PublicAudioWriteIdentity = {
  pipeline: PublicAudioPipeline;
  operation: PublicAudioWriteOperation;
  args: unknown;
};

const canonicalize = (value: unknown): string => {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Public audio write attestations require finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Public audio write attestations require plain objects.");
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${canonicalize(entryValue)}`,
      )
      .join(",")}}`;
  }
  throw new Error("Public audio write attestation payload is not serializable.");
};

export const buildPublicAudioWriteAttestationPayload = ({
  pipeline,
  operation,
  args,
}: PublicAudioWriteIdentity): readonly ServerAttestationPayloadValue[] => [
  pipeline,
  operation,
  canonicalize(args),
];

export const createPublicAudioWriteAttestation = async (
  identity: PublicAudioWriteIdentity,
): Promise<ServerAttestation> =>
  await createServerAttestation({
    scope: PUBLIC_AUDIO_WRITE_ATTESTATION_SCOPE,
    payload: buildPublicAudioWriteAttestationPayload(identity),
    secret: requireServerAttestationSecret(),
  });

export const verifyPublicAudioWriteAttestation = async ({
  attestation,
  secret = process.env.TTS_QUOTA_BYPASS_SECRET?.trim() || undefined,
  now,
  ...identity
}: PublicAudioWriteIdentity & {
  attestation: ServerAttestation | undefined;
  secret?: string;
  now?: number;
}): Promise<boolean> =>
  await verifyServerAttestation({
    attestation,
    scope: PUBLIC_AUDIO_WRITE_ATTESTATION_SCOPE,
    payload: buildPublicAudioWriteAttestationPayload(identity),
    secret,
    ...(now == null ? {} : { now }),
  });

export const assertPublicAudioWriteAttestation = async (
  args: Parameters<typeof verifyPublicAudioWriteAttestation>[0],
): Promise<void> => {
  if (await verifyPublicAudioWriteAttestation(args)) return;
  throw new Error("A valid server attestation is required to publish audio.");
};
