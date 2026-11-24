/**
 * Keep a media element at the listener's chosen speed.
 *
 * Browsers reset `playbackRate` to `defaultPlaybackRate` when a new source
 * loads, and some (notably Safari on iOS) can also drop it around play or
 * seek. Setting both properties, then re-checking on those events, keeps
 * what the player shows and what the listener hears in step.
 */
export const applyPlaybackRate = (media: HTMLMediaElement, rate: number) => {
  if (!Number.isFinite(rate) || rate <= 0) return;
  if (media.defaultPlaybackRate !== rate) media.defaultPlaybackRate = rate;
  if (media.playbackRate !== rate) media.playbackRate = rate;
};

const RESYNC_EVENTS = [
  "loadedmetadata",
  "canplay",
  "play",
  "playing",
  "seeked",
  "ratechange",
] as const;

/** Re-applies `getRate()` whenever the element could have drifted. */
export const keepPlaybackRate = (
  media: HTMLMediaElement,
  getRate: () => number,
): (() => void) => {
  // Setting a different value fires one more ratechange, which then matches.
  const resync = () => applyPlaybackRate(media, getRate());
  for (const type of RESYNC_EVENTS) media.addEventListener(type, resync);
  return () => {
    for (const type of RESYNC_EVENTS) media.removeEventListener(type, resync);
  };
};
