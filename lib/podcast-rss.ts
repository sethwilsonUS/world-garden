export const PODCAST_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd";
export const ATOM_NS = "http://www.w3.org/2005/Atom";
export const CONTENT_NS = "http://purl.org/rss/1.0/modules/content/";

export const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export const formatPodcastDuration = (seconds?: number): string | null => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const totalSeconds = Math.round(seconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
};

export const xmlTag = (name: string, value?: string | null): string =>
  value ? `<${name}>${escapeXml(value)}</${name}>` : "";
