export const NATIVE_PLAYBACK_RATES = [
  0.5, 0.75, 1, 1.25, 1.5, 1.75, 2,
] as const;

export type NativePlaybackRate = (typeof NATIVE_PLAYBACK_RATES)[number];

export const DEFAULT_NATIVE_PLAYBACK_RATE: NativePlaybackRate = 1;

export function parseNativePlaybackRate(
  value: string | null,
): NativePlaybackRate | null {
  for (const rate of NATIVE_PLAYBACK_RATES) {
    if (String(rate) === value) return rate;
  }

  return null;
}

export function getNextNativePlaybackRate(
  rate: NativePlaybackRate,
): NativePlaybackRate {
  const currentIndex = NATIVE_PLAYBACK_RATES.indexOf(rate);
  return (
    NATIVE_PLAYBACK_RATES[(currentIndex + 1) % NATIVE_PLAYBACK_RATES.length] ??
    DEFAULT_NATIVE_PLAYBACK_RATE
  );
}

export function formatNativePlaybackRate(rate: NativePlaybackRate): string {
  return `${rate}x`;
}
