import type {
  WikipediaSearchResponse,
  WikipediaSearchResult,
} from "@/lib/wikipedia-contracts";

export function normalizeWikipediaSearchTerm(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function normalizeWikipediaSearchResponse(
  payload: WikipediaSearchResult[] | WikipediaSearchResponse,
): WikipediaSearchResponse {
  if (Array.isArray(payload)) {
    return { results: payload };
  }
  const suggestion = payload.suggestion
    ? normalizeWikipediaSearchTerm(payload.suggestion)
    : "";
  return {
    results: payload.results,
    ...(suggestion ? { suggestion } : {}),
  };
}

export function formatWikipediaSearchStatus(
  term: string,
  resultCount?: number,
  suggestion?: string,
): string {
  if (
    resultCount !== undefined &&
    (!Number.isSafeInteger(resultCount) || resultCount < 0)
  ) {
    throw new RangeError(
      "Wikipedia result counts must be non-negative integers",
    );
  }

  const normalizedTerm = normalizeWikipediaSearchTerm(term);
  if (!normalizedTerm) return "";

  if (resultCount === undefined) {
    return `Searching Wikipedia for ${normalizedTerm}.`;
  }

  const normalizedSuggestion = suggestion
    ? normalizeWikipediaSearchTerm(suggestion)
    : "";
  const suggestionSuffix = normalizedSuggestion
    ? ` Did you mean ${normalizedSuggestion}?`
    : "";

  if (resultCount === 0) {
    return `No search results found for ${normalizedTerm}.${suggestionSuffix}`;
  }

  return `${resultCount} search result${resultCount === 1 ? "" : "s"} found for ${normalizedTerm}.${suggestionSuffix}`;
}

export function formatWikipediaTypeaheadStatus(
  term: string,
  suggestionCount: number,
): string {
  if (!Number.isSafeInteger(suggestionCount) || suggestionCount < 0) {
    throw new RangeError(
      "Wikipedia suggestion counts must be non-negative integers",
    );
  }

  const normalizedTerm = normalizeWikipediaSearchTerm(term);
  if (!normalizedTerm) return "";

  if (suggestionCount === 0) {
    return `No instant suggestions for ${normalizedTerm}. Press Enter to run a full search.`;
  }

  return `${suggestionCount} suggestion${suggestionCount === 1 ? "" : "s"} available for ${normalizedTerm}. Use up and down arrow keys to choose, or press Enter to search.`;
}
