export const getPersonalPlaylistOpenAiQuotaKey = (
  viewerTokenIdentifier: string,
): string => `personal-playlist:openai:daily:${viewerTokenIdentifier}`;

export const getArticleAudioExportQuotaKey = (
  ownerTokenIdentifier: string,
): string => `article-audio-export:openai:daily:${ownerTokenIdentifier}`;
