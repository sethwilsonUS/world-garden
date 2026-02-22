import { describe, it, expect } from "vitest";
import {
  titleToSlug,
  slugToTitle,
  parseSections,
  cleanSectionContent,
  stripHtml,
  cleanContentForTts,
} from "./wikipedia";

describe("titleToSlug", () => {
  it("replaces spaces with underscores", () => {
    expect(titleToSlug("United States")).toBe("United_States");
  });

  it("handles single-word titles", () => {
    expect(titleToSlug("Python")).toBe("Python");
  });

  it("handles multiple consecutive spaces", () => {
    expect(titleToSlug("New  York  City")).toBe("New__York__City");
  });

  it("returns empty string for empty input", () => {
    expect(titleToSlug("")).toBe("");
  });
});

describe("slugToTitle", () => {
  it("replaces underscores with spaces", () => {
    expect(slugToTitle("United_States")).toBe("United States");
  });

  it("handles single-word slugs", () => {
    expect(slugToTitle("Python")).toBe("Python");
  });

  it("round-trips with titleToSlug", () => {
    const title = "History of mathematics";
    expect(slugToTitle(titleToSlug(title))).toBe(title);
  });
});

describe("stripHtml", () => {
  it("removes HTML tags", () => {
    expect(stripHtml("<b>bold</b> text")).toBe("bold text");
  });

  it("decodes HTML entities", () => {
    expect(stripHtml("&amp; &lt; &gt; &quot; &#039;")).toBe('& < > " \'');
  });

  it("handles nested tags", () => {
    expect(stripHtml('<span class="x"><em>hi</em></span>')).toBe("hi");
  });

  it("returns plain text unchanged", () => {
    expect(stripHtml("no html here")).toBe("no html here");
  });

  it("returns empty string for empty input", () => {
    expect(stripHtml("")).toBe("");
  });

  it("handles self-closing tags", () => {
    expect(stripHtml("line one<br/>line two")).toBe("line oneline two");
  });
});

describe("cleanSectionContent", () => {
  it("removes citation references like [1], [23]", () => {
    expect(cleanSectionContent("Some text[1] with refs[23].")).toBe(
      "Some text with refs.",
    );
  });

  it("removes [citation needed] markers", () => {
    expect(
      cleanSectionContent("A claim[citation needed] was made."),
    ).toBe("A claim was made.");
  });

  it("removes [edit] markers", () => {
    expect(cleanSectionContent("Title[edit]")).toBe("Title");
  });

  it("collapses excessive newlines", () => {
    expect(cleanSectionContent("Line one\n\n\n\nLine two")).toBe(
      "Line one\n\nLine two",
    );
  });

  it("removes sub-headings from section content", () => {
    expect(
      cleanSectionContent("Intro text\n=== Sub heading ===\nMore text"),
    ).toBe("Intro text\n\nMore text");
  });

  it("returns empty string for empty input", () => {
    expect(cleanSectionContent("")).toBe("");
  });

  it("handles content with only whitespace", () => {
    expect(cleanSectionContent("   \n\n  ")).toBe("");
  });

  it("handles multiple citation types together", () => {
    expect(
      cleanSectionContent("Text[1][2][citation needed][edit] end."),
    ).toBe("Text end.");
  });
});

describe("parseSections", () => {
  it("returns entire text as summary when no headings exist", () => {
    const text = "Just a simple paragraph about something.";
    const result = parseSections(text);
    expect(result.summary).toBe(text);
    expect(result.sections).toEqual([]);
  });

  it("handles empty string", () => {
    const result = parseSections("");
    expect(result.summary).toBe("");
    expect(result.sections).toEqual([]);
  });

  it("splits text into summary and sections", () => {
    const text = [
      "This is the lead paragraph.",
      "",
      "== History ==",
      "The history section has enough content to pass the minimum length filter easily.",
      "",
      "== Geography ==",
      "The geography section also has enough content to pass the minimum length filter.",
    ].join("\n");

    const result = parseSections(text);
    expect(result.summary).toBe("This is the lead paragraph.");
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].title).toBe("History");
    expect(result.sections[0].level).toBe(2);
    expect(result.sections[1].title).toBe("Geography");
  });

  it("filters out noise sections like References and See also", () => {
    const text = [
      "Lead text.",
      "",
      "== History ==",
      "History content that is definitely long enough to pass the filter check.",
      "",
      "== References ==",
      "Some references here that should be filtered out completely.",
      "",
      "== See also ==",
      "Some see also links that should be filtered out completely.",
      "",
      "== External links ==",
      "Some external links that should be filtered out completely.",
    ].join("\n");

    const result = parseSections(text);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBe("History");
  });

  it("filters out all noise section variants", () => {
    const noiseNames = [
      "Notes",
      "Further reading",
      "Bibliography",
      "Sources",
      "Citations",
      "Footnotes",
    ];
    for (const name of noiseNames) {
      const text = [
        "Lead text.",
        "",
        "== Content ==",
        "Actual content that is long enough to pass the twenty char minimum.",
        "",
        `== ${name} ==`,
        "This noise section should be filtered out by parseSections.",
      ].join("\n");

      const result = parseSections(text);
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe("Content");
    }
  });

  it("keeps sections with very short content (UI handles graying out)", () => {
    const text = [
      "Lead text.",
      "",
      "== Empty Section ==",
      "Too short.",
      "",
      "== Real Section ==",
      "This section has enough content to be included in the output results.",
    ].join("\n");

    const result = parseSections(text);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].title).toBe("Empty Section");
    expect(result.sections[0].content).toBe("Too short.");
    expect(result.sections[1].title).toBe("Real Section");
  });

  it("handles level-3 headings", () => {
    const text = [
      "Lead text.",
      "",
      "== Main Section ==",
      "Main content that is long enough to pass the twenty character minimum.",
      "",
      "=== Sub Section ===",
      "Sub content that is also long enough to pass the twenty character minimum.",
    ].join("\n");

    const result = parseSections(text);
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].level).toBe(2);
    expect(result.sections[1].level).toBe(3);
  });
});

describe("cleanContentForTts", () => {
  it("removes citation references", () => {
    const result = cleanContentForTts("Einstein[1] developed[2] relativity.");
    expect(result).toBe("Einstein developed relativity.");
  });

  it("removes [citation needed] and [edit] markers", () => {
    const result = cleanContentForTts(
      "A claim[citation needed] in a section[edit].",
    );
    expect(result).toBe("A claim in a section.");
  });

  it("removes trailing reference sections", () => {
    const text =
      "Main content here.\n\n== See also ==\nSome links\n\n== References ==\n1. Ref";
    const result = cleanContentForTts(text);
    expect(result).toBe("Main content here.");
  });

  it("removes heading markers", () => {
    const result = cleanContentForTts("Intro.\n== History ==\nHistory text.");
    expect(result).toBe("Intro.\n\nHistory text.");
  });

  it("truncates long text at sentence boundary", () => {
    const longText = "First sentence. ".repeat(500);
    const result = cleanContentForTts(longText);
    expect(result.length).toBeLessThanOrEqual(4800);
    expect(result.endsWith(".")).toBe(true);
  });

  it("removes == Notes == section and everything after", () => {
    const text = "Main content.\n\n== Notes ==\nSome notes here.";
    expect(cleanContentForTts(text)).toBe("Main content.");
  });

  it("removes == Further reading == section and everything after", () => {
    const text = "Main content.\n\n== Further reading ==\nBooks to read.";
    expect(cleanContentForTts(text)).toBe("Main content.");
  });

  it("removes == External links == section and everything after", () => {
    const text = "Main content.\n\n== External links ==\nhttp://example.com";
    expect(cleanContentForTts(text)).toBe("Main content.");
  });

  it("handles text with no cleanable content", () => {
    const text = "Just plain text.";
    expect(cleanContentForTts(text)).toBe("Just plain text.");
  });

  it("collapses excessive newlines after cleanup", () => {
    const text = "Paragraph one.\n\n\n\n\nParagraph two.";
    expect(cleanContentForTts(text)).toBe("Paragraph one.\n\nParagraph two.");
  });
});
