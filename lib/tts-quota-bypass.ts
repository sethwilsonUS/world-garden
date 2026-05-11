import { TTS_QUOTA_BYPASS_HEADER } from "./tts-quota-headers";

export { TTS_QUOTA_BYPASS_HEADER };

export const getTtsQuotaBypassHeaders = ():
  | Record<typeof TTS_QUOTA_BYPASS_HEADER, string>
  | undefined => {
  const secret = process.env.TTS_QUOTA_BYPASS_SECRET?.trim();
  if (!secret) return undefined;
  return { [TTS_QUOTA_BYPASS_HEADER]: secret };
};
