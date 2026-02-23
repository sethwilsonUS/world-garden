const WIKI_ACTION_API = "https://en.wikipedia.org/w/api.php";
const USER_AGENT = "WorldGarden/1.0 (accessibility-first Wikipedia audio reader)";

export type WikiSearchResult = {
  wikiPageId: string;
  title: string;
  description: string;
  url: string;
};

export type WikiSection = {
  title: string;
  level: number;
  content: string;
};

export type WikiArticle = {
  wikiPageId: string;
  title: string;
  language: string;
  revisionId: string;
  lastEdited: string;
  summary: string;
  contentText: string;
  sections: WikiSection[];
  thumbnailUrl?: string;
};

export const searchWikipedia = async (
  term: string,
): Promise<WikiSearchResult[]> => {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    list: "search",
    srsearch: term,
    srlimit: "10",
    srprop: "snippet",
    origin: "*",
  });

  const response = await fetch(`${WIKI_ACTION_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia search failed: ${response.status}`);
  }

  const data = await response.json();
  const results = data.query?.search ?? [];

  return results.map(
    (item: { pageid: number; title: string; snippet: string }) => ({
      wikiPageId: String(item.pageid),
      title: item.title,
      description: stripHtml(item.snippet),
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, "_"))}`,
    }),
  );
};

export const fetchArticleByPageId = async (
  pageId: string,
): Promise<WikiArticle> => {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    pageids: pageId,
    prop: "extracts|revisions|info|pageimages",
    explaintext: "1",
    exsectionformat: "wiki",
    rvprop: "ids|timestamp",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "800",
    origin: "*",
  });

  const response = await fetch(`${WIKI_ACTION_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia fetch failed: ${response.status}`);
  }

  const data = await response.json();
  const page = data.query?.pages?.[pageId];

  if (!page || page.missing !== undefined) {
    throw new Error(`Wikipedia article not found: pageId ${pageId}`);
  }

  const revision = page.revisions?.[0];
  const fullText = page.extract ?? "";
  const { summary, sections } = parseSections(fullText);
  const contentText = cleanContentForTts(fullText);
  const thumbnail = page.thumbnail as { source: string } | undefined;

  return {
    wikiPageId: String(page.pageid),
    title: page.title,
    language: "en",
    revisionId: revision ? String(revision.revid) : "unknown",
    lastEdited: revision?.timestamp ?? new Date().toISOString(),
    summary,
    contentText,
    sections,
    thumbnailUrl: thumbnail?.source,
  };
};

export const titleToSlug = (title: string): string => {
  return title.replace(/ /g, "_");
};

export const slugToTitle = (slug: string): string => {
  return slug.replace(/_/g, " ");
};

export const fetchArticleByTitle = async (
  title: string,
): Promise<WikiArticle> => {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    titles: title,
    prop: "extracts|revisions|info|pageimages",
    explaintext: "1",
    exsectionformat: "wiki",
    rvprop: "ids|timestamp",
    inprop: "url",
    piprop: "thumbnail",
    pithumbsize: "800",
    redirects: "1",
    origin: "*",
  });

  const response = await fetch(`${WIKI_ACTION_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`Wikipedia fetch failed: ${response.status}`);
  }

  const data = await response.json();
  const pages = data.query?.pages ?? {};
  const page = Object.values(pages)[0] as Record<string, unknown> | undefined;

  if (!page || page.missing !== undefined) {
    throw new Error(`Wikipedia article not found: "${title}"`);
  }

  const revisions = page.revisions as Array<Record<string, unknown>> | undefined;
  const revision = revisions?.[0];
  const fullText = (page.extract as string) ?? "";
  const { summary, sections } = parseSections(fullText);
  const contentText = cleanContentForTts(fullText);
  const thumbnail = page.thumbnail as { source: string } | undefined;

  return {
    wikiPageId: String(page.pageid),
    title: page.title as string,
    language: "en",
    revisionId: revision ? String(revision.revid) : "unknown",
    lastEdited: (revision?.timestamp as string) ?? new Date().toISOString(),
    summary,
    contentText,
    sections,
    thumbnailUrl: thumbnail?.source,
  };
};

const NOISE_SECTIONS = new Set([
  "see also",
  "references",
  "external links",
  "notes",
  "further reading",
  "bibliography",
  "sources",
  "citations",
  "footnotes",
]);

/**
 * Split Wikipedia plaintext (from explaintext=1) into a lead summary
 * and an ordered array of sections. Filters out reference/noise sections.
 */
export const parseSections = (fullText: string): {
  summary: string;
  sections: WikiSection[];
} => {
  const sectionHeadingRe = /^(={2,})\s*(.+?)\s*\1$/gm;
  const matches = [...fullText.matchAll(sectionHeadingRe)];

  if (matches.length === 0) {
    return { summary: fullText.trim(), sections: [] };
  }

  const summary = fullText.substring(0, matches[0].index!).trim();

  const sections: WikiSection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const level = m[1].length;
    const title = m[2];

    if (NOISE_SECTIONS.has(title.toLowerCase())) continue;

    const contentStart = m.index! + m[0].length;
    const contentEnd =
      i + 1 < matches.length ? matches[i + 1].index! : fullText.length;
    const content = cleanSectionContent(
      fullText.substring(contentStart, contentEnd),
    );

    sections.push({ title, level, content });
  }

  return { summary, sections };
};

export const cleanSectionContent = (text: string): string => {
  return text
    .replace(/^={2,}\s*.+?\s*={2,}$/gm, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\[citation needed\]/gi, "")
    .replace(/\[edit\]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

export const stripHtml = (html: string): string => {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#039;/g, "'");
};

export type WikiSectionLinkCount = {
  title: string;
  count: number;
};

export type WikiCitation = {
  id: string;
  index: number;
  text: string;
  url?: string;
};

export type SectionCitationInfo = {
  title: string;
  count: number;
  citationIds: string[];
};

export type WikiLinkedArticle = {
  wikiPageId: string;
  title: string;
  description?: string;
};

export type ParsedPageData = {
  linkCounts: WikiSectionLinkCount[];
  citations: WikiCitation[];
  sectionCitations: SectionCitationInfo[];
  sectionIndexMap: { title: string; index: string }[];
};

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&ndash;/g, "\u2013")
    .replace(/&mdash;/g, "\u2014");

const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").trim();

const extractLinkCounts = (
  html: string,
  sections: { line: string; level: string }[],
): WikiSectionLinkCount[] => {
  const headingRe = /<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/g;
  const linkRe = /<a\s[^>]*href="\/wiki\/([^"#]+)"[^>]*>/g;
  const countLinks = (chunk: string) => {
    let n = 0;
    for (const m of chunk.matchAll(linkRe)) {
      if (!m[1].includes(":")) n++;
    }
    return n;
  };

  const headings = [...html.matchAll(headingRe)];
  const result: WikiSectionLinkCount[] = [];

  const leadEnd = headings.length > 0 ? headings[0].index! : html.length;
  result.push({ title: "__summary__", count: countLinks(html.slice(0, leadEnd)) });

  for (let i = 0; i < headings.length; i++) {
    const chunkStart = headings[i].index! + headings[i][0].length;
    const chunkEnd =
      i + 1 < headings.length ? headings[i + 1].index! : html.length;
    const chunk = html.slice(chunkStart, chunkEnd);

    const headingText = decodeEntities(stripTags(headings[i][2]));
    const normalised = headingText.toLowerCase();
    const matchedSection = sections.find(
      (s) => decodeEntities(stripTags(s.line)).toLowerCase() === normalised,
    );
    if (matchedSection) {
      result.push({
        title: decodeEntities(stripTags(matchedSection.line)),
        count: countLinks(chunk),
      });
    }
  }

  return result;
};

/**
 * Match individual <li id="cite_note-*"> elements by their start tags
 * and slice between them.
 *
 * Wikipedia encodes underscores as &#95; in id attributes but uses
 * literal underscores in href fragment references. We decode numeric
 * HTML entities in the id values so they match the href-based IDs
 * that extractSectionCitations collects.
 */
const extractCitations = (html: string): WikiCitation[] => {
  const citeNoteRe =
    /<li\b[^>]*\bid="(cite(?:_|&#95;)note(?:_|&#95;|-)[^"]+)"[^>]*>/gi;
  const matches = [...html.matchAll(citeNoteRe)];
  if (matches.length === 0) return [];

  const decodeNumericEntities = (s: string) =>
    s.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));

  const linkHrefRe =
    /<a\b[^>]*class="external[^"]*"[^>]*href="([^"]+)"[^>]*>/i;
  const citations: WikiCitation[] = [];

  for (let i = 0; i < matches.length; i++) {
    const id = decodeNumericEntities(matches[i][1]);
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : html.length;
    const content = html.slice(start, end);

    const text = content
      .replace(/<span class="mw-cite-backlink">[\s\S]*?<\/span>/gi, "")
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&#(\d+);/g, (_, code) =>
        String.fromCharCode(parseInt(code)),
      )
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, " ")
      .trim();

    if (!text || text.length < 5) continue;

    const urlMatch = content.match(linkHrefRe);
    citations.push({
      id,
      index: citations.length + 1,
      text,
      url: urlMatch?.[1],
    });
  }

  return citations;
};

/**
 * For each section of the HTML, find which cite_note IDs are referenced
 * via inline <a href="#cite_note-*"> links. Returns per-section counts
 * and ID lists so callers can look up full citation text on demand.
 */
const extractSectionCitations = (
  html: string,
  sections: { line: string; level: string }[],
): SectionCitationInfo[] => {
  const headingRe = /<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/g;
  const citeRefRe = /href="#(cite_note-[^"]+)"/g;

  const headings = [...html.matchAll(headingRe)];
  const result: SectionCitationInfo[] = [];

  const leadEnd = headings.length > 0 ? headings[0].index! : html.length;
  const leadIds = [
    ...new Set([...html.slice(0, leadEnd).matchAll(citeRefRe)].map((m) => m[1])),
  ];
  result.push({ title: "__summary__", count: leadIds.length, citationIds: leadIds });

  for (let i = 0; i < headings.length; i++) {
    const chunkStart = headings[i].index!;
    const chunkEnd =
      i + 1 < headings.length ? headings[i + 1].index! : html.length;
    const chunk = html.slice(chunkStart, chunkEnd);

    const headingText = decodeEntities(stripTags(headings[i][2]));
    const normalised = headingText.toLowerCase();
    const matchedSection = sections.find(
      (s) => decodeEntities(stripTags(s.line)).toLowerCase() === normalised,
    );
    const title = matchedSection
      ? decodeEntities(stripTags(matchedSection.line))
      : headingText;

    const ids = [
      ...new Set([...chunk.matchAll(citeRefRe)].map((m) => m[1])),
    ];
    result.push({ title, count: ids.length, citationIds: ids });
  }

  return result;
};

/**
 * Single parse API call that extracts link counts, citations, per-section
 * citation mappings, and section index mappings. Callers should cache the
 * result in Convex so subsequent requests hit the database.
 */
export const fetchParsedPageData = async (
  pageId: string,
): Promise<ParsedPageData> => {
  const params = new URLSearchParams({
    action: "parse",
    format: "json",
    pageid: pageId,
    prop: "text|sections",
    origin: "*",
  });

  const response = await fetch(`${WIKI_ACTION_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    return {
      linkCounts: [],
      citations: [],
      sectionCitations: [],
      sectionIndexMap: [],
    };
  }

  const data = await response.json();
  const html: string = data.parse?.text?.["*"] ?? "";
  const sections: { line: string; level: string; index: string }[] =
    data.parse?.sections ?? [];

  return {
    linkCounts: extractLinkCounts(html, sections),
    citations: extractCitations(html),
    sectionCitations: extractSectionCitations(html, sections),
    sectionIndexMap: sections.map((s) => ({
      title: stripTags(s.line),
      index: s.index,
    })),
  };
};

/**
 * Fetch internal article links for a known section index. Skips the extra
 * sections-lookup call that the old fetchSectionLinks required — the caller
 * is expected to resolve the index from cached ParsedPageData.
 */
export const fetchSectionLinksByIndex = async (
  pageId: string,
  sectionIndex: string,
): Promise<WikiLinkedArticle[]> => {
  const params = new URLSearchParams({
    action: "parse",
    format: "json",
    pageid: pageId,
    prop: "links",
    section: sectionIndex,
    origin: "*",
  });
  const response = await fetch(`${WIKI_ACTION_API}?${params}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) return [];

  const data = await response.json();
  const links: { ns: number; "*": string; exists?: string }[] =
    data.parse?.links ?? [];
  const articleTitles = links
    .filter((l) => l.ns === 0 && "exists" in l)
    .map((l) => l["*"]);

  if (articleTitles.length === 0) return [];

  const resolved: WikiLinkedArticle[] = [];
  const BATCH_SIZE = 50;

  for (let i = 0; i < articleTitles.length; i += BATCH_SIZE) {
    const batch = articleTitles.slice(i, i + BATCH_SIZE);
    const qParams = new URLSearchParams({
      action: "query",
      format: "json",
      titles: batch.join("|"),
      prop: "description",
      redirects: "1",
      origin: "*",
    });
    const qResponse = await fetch(`${WIKI_ACTION_API}?${qParams}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!qResponse.ok) continue;

    const qData = await qResponse.json();
    const pages = qData.query?.pages ?? {};
    for (const p of Object.values(pages) as Record<string, unknown>[]) {
      if (p.pageid && p.missing === undefined) {
        resolved.push({
          wikiPageId: String(p.pageid),
          title: p.title as string,
          description: p.description as string | undefined,
        });
      }
    }
  }

  resolved.sort((a, b) => a.title.localeCompare(b.title));
  return resolved;
};

export const cleanContentForTts = (text: string): string => {
  let cleaned = text
    .replace(/\[\d+\]/g, "")
    .replace(/\[citation needed\]/gi, "")
    .replace(/\[edit\]/gi, "")
    .replace(/== See also ==[\s\S]*$/i, "")
    .replace(/== References ==[\s\S]*$/i, "")
    .replace(/== External links ==[\s\S]*$/i, "")
    .replace(/== Notes ==[\s\S]*$/i, "")
    .replace(/== Further reading ==[\s\S]*$/i, "")
    .replace(/^={2,}\s*.+?\s*={2,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const TTS_CHAR_LIMIT = 4800;
  if (cleaned.length > TTS_CHAR_LIMIT) {
    cleaned = cleaned.slice(0, TTS_CHAR_LIMIT);
    const lastSentence = cleaned.lastIndexOf(". ");
    if (lastSentence > TTS_CHAR_LIMIT * 0.5) {
      cleaned = cleaned.slice(0, lastSentence + 1);
    }
  }

  return cleaned;
};
