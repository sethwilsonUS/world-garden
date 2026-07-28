import {
  createServerAttestation,
  requireServerAttestationSecret,
  verifyServerAttestation,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "./server-attestation";

export const PERSONAL_FEED_MEDIA_READ_ATTESTATION_SCOPE =
  "personal-feed-media:read";

export type PersonalFeedMediaReadIdentity = {
  feedToken: string;
  episodeId: string;
};

export const buildPersonalFeedMediaReadAttestationPayload = ({
  feedToken,
  episodeId,
}: PersonalFeedMediaReadIdentity): readonly ServerAttestationPayloadValue[] => [
  feedToken,
  episodeId,
];

export const createPersonalFeedMediaReadAttestation = async (
  identity: PersonalFeedMediaReadIdentity,
): Promise<ServerAttestation> =>
  await createServerAttestation({
    scope: PERSONAL_FEED_MEDIA_READ_ATTESTATION_SCOPE,
    payload: buildPersonalFeedMediaReadAttestationPayload(identity),
    secret: requireServerAttestationSecret(),
  });

export const verifyPersonalFeedMediaReadAttestation = async ({
  attestation,
  secret = process.env.TTS_QUOTA_BYPASS_SECRET?.trim() || undefined,
  now,
  ...identity
}: PersonalFeedMediaReadIdentity & {
  attestation: ServerAttestation | undefined;
  secret?: string;
  now?: number;
}): Promise<boolean> =>
  await verifyServerAttestation({
    attestation,
    scope: PERSONAL_FEED_MEDIA_READ_ATTESTATION_SCOPE,
    payload: buildPersonalFeedMediaReadAttestationPayload(identity),
    secret,
    ...(now == null ? {} : { now }),
  });
