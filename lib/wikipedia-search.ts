export function normalizeWikipediaSearchTerm(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function formatWikipediaSearchStatus(
  term: string,
  resultCount?: number,
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
  if (resultCount === 0) {
    return `No search results found for ${normalizedTerm}.`;
  }

  return `${resultCount} search result${resultCount === 1 ? "" : "s"} found for ${normalizedTerm}.`;
}
