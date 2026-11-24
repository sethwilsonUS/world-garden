import { fetchWikimedia } from "./wikimedia-client";

const WIKI_REST_API = "https://en.wikipedia.org/api/rest_v1";

export type WikiSummary = {
  title: string;
  extract: string;
  thumbnailUrl?: string;
};

export function slugToTitle(slug: string): string {
  return decodeURIComponent(slug).replace(/_/g, " ");
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.5) {
    return truncated.slice(0, lastSpace) + "\u2026";
  }
  return truncated + "\u2026";
}

export async function fetchWikiSummary(
  slug: string,
): Promise<WikiSummary | null> {
  try {
    const title = encodeURIComponent(slugToTitle(slug));
    const response = await fetchWikimedia(
      `${WIKI_REST_API}/page/summary/${title}`,
      {
        next: { revalidate: 3600 },
      },
    );
    if (!response.ok) return null;

    const data = await response.json();
    return {
      title: data.title ?? slug,
      extract: data.extract ?? "",
      thumbnailUrl: data.thumbnail?.source,
    };
  } catch {
    return null;
  }
}
