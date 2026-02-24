import { describe, it, expect } from "vitest";
import {
  titleToSlug,
  slugToTitle,
  parseSections,
  cleanSectionContent,
  stripHtml,
  cleanContentForTts,
  upscaleThumbUrl,
  toOriginalUrl,
  extractImages,
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

describe("upscaleThumbUrl", () => {
  it("replaces the size in a standard Wikipedia thumb URL", () => {
    const url =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/220px-Example.jpg";
    expect(upscaleThumbUrl(url)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Example.jpg/800px-Example.jpg",
    );
  });

  it("returns non-thumb URLs unchanged", () => {
    const url =
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg";
    expect(upscaleThumbUrl(url)).toBe(url);
  });

  it("handles en.wikipedia thumb URLs", () => {
    const url =
      "https://upload.wikimedia.org/wikipedia/en/thumb/8/80/Flag.png/150px-Flag.png";
    expect(upscaleThumbUrl(url)).toBe(
      "https://upload.wikimedia.org/wikipedia/en/thumb/8/80/Flag.png/800px-Flag.png",
    );
  });

  it("returns empty string unchanged", () => {
    expect(upscaleThumbUrl("")).toBe("");
  });

  it("returns plain URLs without thumb path unchanged", () => {
    expect(upscaleThumbUrl("https://example.com/image.jpg")).toBe(
      "https://example.com/image.jpg",
    );
  });
});

describe("extractImages", () => {
  const makeFigure = (
    src: string,
    caption: string,
    width = 300,
    height = 200,
    alt = "",
  ) =>
    `<figure class="mw-default-size" typeof="mw:File/Thumb">` +
    `<a href="/wiki/File:Test.jpg">` +
    `<img src="${src}" width="${width}" height="${height}" alt="${alt}" />` +
    `</a>` +
    `<figcaption>${caption}</figcaption>` +
    `</figure>`;

  it("extracts images from figure elements", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/220px-Cat.jpg",
      "A domestic cat",
    );
    const images = extractImages(html);
    expect(images).toHaveLength(1);
    expect(images[0].caption).toBe("A domestic cat");
    expect(images[0].src).toContain("220px-Cat.jpg");
    expect(images[0].src.startsWith("https:")).toBe(true);
  });

  it("strips HTML tags from captions", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/220px-Cat.jpg",
      "A <b>bold</b> caption with <a href=\"/wiki/Link\">a link</a>",
    );
    const images = extractImages(html);
    expect(images).toHaveLength(1);
    expect(images[0].caption).toBe("A bold caption with a link");
  });

  it("filters out SVG images", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Icon.svg/220px-Icon.svg.png",
      "An SVG icon",
    );
    // src ends with .svg check — but this URL ends with .svg.png so it won't be filtered
    // Let's test an actual .svg src
    const svgHtml = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/a/ab/Diagram.svg",
      "SVG diagram",
    );
    const images = extractImages(svgHtml);
    expect(images).toHaveLength(0);
  });

  it("filters out math images", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/math/formula/abc123.png",
      "Math formula",
    );
    const images = extractImages(html);
    expect(images).toHaveLength(0);
  });

  it("filters out tiny images when both dimensions are below threshold", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tiny.jpg/50px-Tiny.jpg",
      "Tiny image",
      50,
      50,
    );
    const images = extractImages(html);
    expect(images).toHaveLength(0);
  });

  it("filters out images when either dimension is below threshold", () => {
    const narrow = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Tall.jpg/80px-Tall.jpg",
      "Narrow image",
      80,
      400,
    );
    expect(extractImages(narrow)).toHaveLength(0);

    const short = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Wide.jpg/400px-Wide.jpg",
      "Short image",
      400,
      80,
    );
    expect(extractImages(short)).toHaveLength(0);
  });

  it("deduplicates images with the same base URL", () => {
    const html =
      makeFigure(
        "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/220px-Cat.jpg",
        "First caption",
      ) +
      makeFigure(
        "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/300px-Cat.jpg",
        "Second caption",
      );
    const images = extractImages(html);
    expect(images).toHaveLength(1);
    expect(images[0].caption).toBe("First caption");
  });

  it("extracts multiple distinct images", () => {
    const html =
      makeFigure(
        "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/220px-Cat.jpg",
        "A cat",
      ) +
      makeFigure(
        "//upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Dog.jpg/220px-Dog.jpg",
        "A dog",
      );
    const images = extractImages(html);
    expect(images).toHaveLength(2);
  });

  it("returns empty array for HTML with no figures", () => {
    const html = "<p>Just some text with no images.</p>";
    expect(extractImages(html)).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(extractImages("")).toEqual([]);
  });

  it("handles figures without figcaption", () => {
    const html =
      `<figure typeof="mw:File/Thumb">` +
      `<img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Pic.jpg/220px-Pic.jpg" width="220" height="165" alt="A picture" />` +
      `</figure>`;
    const images = extractImages(html);
    expect(images).toHaveLength(1);
    expect(images[0].caption).toBe("");
    expect(images[0].alt).toBe("A picture");
  });

  it("includes width and height when available", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/220px-Cat.jpg",
      "Cat",
      300,
      200,
    );
    const images = extractImages(html);
    expect(images[0].width).toBe(300);
    expect(images[0].height).toBe(200);
  });

  it("omits width/height when zero", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/220px-Cat.jpg",
      "Cat",
      0,
      0,
    );
    const images = extractImages(html);
    expect(images).toHaveLength(1);
    expect(images[0].width).toBeUndefined();
    expect(images[0].height).toBeUndefined();
  });

  it("decodes HTML entities in alt text", () => {
    const html =
      `<figure typeof="mw:File/Thumb">` +
      `<img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Pic.jpg/220px-Pic.jpg" width="220" height="165" alt="Tom &amp; Jerry" />` +
      `<figcaption>Caption</figcaption>` +
      `</figure>`;
    const images = extractImages(html);
    expect(images[0].alt).toBe("Tom & Jerry");
  });

  it("filters out images with extreme landscape aspect ratio", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Banner.jpg/400px-Banner.jpg",
      "Wide banner",
      400,
      50,
    );
    expect(extractImages(html)).toHaveLength(0);
  });

  it("filters out images with extreme portrait aspect ratio", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Strip.jpg/120px-Strip.jpg",
      "Tall strip",
      120,
      500,
    );
    expect(extractImages(html)).toHaveLength(0);
  });

  it("keeps images with reasonable aspect ratios", () => {
    const landscape = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Wide.jpg/320px-Wide.jpg",
      "16:9 image",
      320,
      180,
    );
    expect(extractImages(landscape)).toHaveLength(1);

    const portrait = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Tall.jpg/200px-Tall.jpg",
      "3:4 image",
      200,
      267,
    );
    expect(extractImages(portrait)).toHaveLength(1);

    const square = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/c/cd/Square.jpg/250px-Square.jpg",
      "Square image",
      250,
      250,
    );
    expect(extractImages(square)).toHaveLength(1);
  });

  it("filters out figures with mw:Error typeof", () => {
    const html =
      `<figure typeof="mw:Error mw:File/Thumb">` +
      `<img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Missing.jpg/220px-Missing.jpg" width="220" height="165" alt="" />` +
      `<figcaption>Broken image</figcaption>` +
      `</figure>`;
    expect(extractImages(html)).toHaveLength(0);
  });

  it("keeps figures without mw:Error typeof", () => {
    const html =
      `<figure typeof="mw:File/Thumb">` +
      `<img src="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Good.jpg/220px-Good.jpg" width="220" height="165" alt="" />` +
      `<figcaption>Good image</figcaption>` +
      `</figure>`;
    expect(extractImages(html)).toHaveLength(1);
  });

  it("populates originalSrc for thumb URLs", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/220px-Cat.jpg",
      "A cat",
    );
    const images = extractImages(html);
    expect(images[0].originalSrc).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Cat.jpg",
    );
  });

  it("leaves originalSrc undefined for non-thumb URLs", () => {
    const html = makeFigure(
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Direct.jpg",
      "Direct image",
    );
    const images = extractImages(html);
    expect(images[0].originalSrc).toBeUndefined();
  });

  it("does not upscale src to 800px", () => {
    const html = makeFigure(
      "//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Cat.jpg/250px-Cat.jpg",
      "A cat",
    );
    const images = extractImages(html);
    expect(images[0].src).toContain("250px-Cat.jpg");
    expect(images[0].src).not.toContain("800px");
  });

  it("extracts video poster images from figure elements", () => {
    const html =
      `<figure typeof="mw:File/Thumb">` +
      `<video poster="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Video.webm/320px-Video.webm.jpg" width="320" height="240">` +
      `<source src="//upload.wikimedia.org/wikipedia/commons/a/ab/Video.webm" type="video/webm" />` +
      `</video>` +
      `<figcaption>A cool video</figcaption>` +
      `</figure>`;
    const images = extractImages(html);
    expect(images).toHaveLength(1);
    expect(images[0].src).toContain("Video.webm.jpg");
    expect(images[0].src.startsWith("https:")).toBe(true);
    expect(images[0].videoSrc).toContain("Video.webm");
    expect(images[0].videoSrc!.startsWith("https:")).toBe(true);
    expect(images[0].caption).toBe("A cool video");
  });

  it("skips video figures without a poster attribute", () => {
    const html =
      `<figure typeof="mw:File/Thumb">` +
      `<video width="320" height="240">` +
      `<source src="//upload.wikimedia.org/wikipedia/commons/a/ab/Video.webm" type="video/webm" />` +
      `</video>` +
      `<figcaption>No poster</figcaption>` +
      `</figure>`;
    expect(extractImages(html)).toHaveLength(0);
  });

  it("handles video figures without a source element", () => {
    const html =
      `<figure typeof="mw:File/Thumb">` +
      `<video poster="//upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Video.webm/320px-Video.webm.jpg" width="320" height="240">` +
      `</video>` +
      `<figcaption>Poster only</figcaption>` +
      `</figure>`;
    const images = extractImages(html);
    expect(images).toHaveLength(1);
    expect(images[0].videoSrc).toBeUndefined();
  });
});

describe("toOriginalUrl", () => {
  it("converts a standard commons thumb URL to the original", () => {
    const url =
      "https://upload.wikimedia.org/wikipedia/commons/thumb/5/53/File.jpg/250px-File.jpg";
    expect(toOriginalUrl(url)).toBe(
      "https://upload.wikimedia.org/wikipedia/commons/5/53/File.jpg",
    );
  });

  it("returns non-thumb URLs unchanged", () => {
    const url =
      "https://upload.wikimedia.org/wikipedia/commons/a/ab/Example.jpg";
    expect(toOriginalUrl(url)).toBe(url);
  });

  it("converts en.wikipedia thumb URLs", () => {
    const url =
      "https://upload.wikimedia.org/wikipedia/en/thumb/8/80/Flag.png/150px-Flag.png";
    expect(toOriginalUrl(url)).toBe(
      "https://upload.wikimedia.org/wikipedia/en/8/80/Flag.png",
    );
  });

  it("returns empty string unchanged", () => {
    expect(toOriginalUrl("")).toBe("");
  });

  it("returns plain URLs without thumb path unchanged", () => {
    expect(toOriginalUrl("https://example.com/image.jpg")).toBe(
      "https://example.com/image.jpg",
    );
  });
});
