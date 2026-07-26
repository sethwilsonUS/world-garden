import {
  createServerAttestation,
  requireServerAttestationSecret,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "./server-attestation";

export const ARTICLE_AUDIO_EXPORT_READ_ATTESTATION_SCOPE =
  "article-audio-export:read";

export type ArticleAudioExportReadAttestationPayload = {
  exportId: string;
  ttsCacheKey: string;
};

export const buildArticleAudioExportReadAttestationPayload = (
  args: ArticleAudioExportReadAttestationPayload,
): readonly ServerAttestationPayloadValue[] => [
  args.exportId,
  args.ttsCacheKey,
];

export const createArticleAudioExportReadAttestation = async (
  args: ArticleAudioExportReadAttestationPayload,
): Promise<ServerAttestation> =>
  await createServerAttestation({
    scope: ARTICLE_AUDIO_EXPORT_READ_ATTESTATION_SCOPE,
    payload: buildArticleAudioExportReadAttestationPayload(args),
    secret: requireServerAttestationSecret(),
  });
