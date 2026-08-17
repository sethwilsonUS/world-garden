import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { WikipediaArticle } from "@curio-garden/domain";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

import { GardenThemeProvider } from "../theme/GardenThemeProvider";
import {
  ARTICLE_PARAGRAPH_CHUNK_LIMIT,
  ArticleDocument,
  buildCanonicalArticleUrl,
  buildWikipediaRevisionUrl,
  DEFAULT_LEAD_IMAGE_ASPECT_RATIO,
  MAX_LEAD_IMAGE_ASPECT_RATIO,
  MIN_LEAD_IMAGE_ASPECT_RATIO,
  normalizeLeadImageUrl,
  resolveLeadImageAspectRatio,
  splitArticleProse,
} from "./ArticleDocument";

const baseArticle: WikipediaArticle = {
  wikiPageId: "736",
  revisionId: "1234",
  title: "Ada Lovelace",
  language: "en",
  narrationVersion: 2,
  lastEdited: "2026-07-25T15:30:00.000Z",
  summary: "Ada Lovelace was an English mathematician and writer.",
  sections: [
    {
      wikiSectionIndex: "1",
      title: "Early life",
      level: 2,
      content: "She was born in London.\n\nHer education began at home.",
    },
    {
      wikiSectionIndex: "2",
      title: "Legacy",
      level: 2,
      content: "Her notes outlived the machine they described.",
    },
  ],
};

async function renderDocument(
  articleOverrides: Partial<WikipediaArticle> = {},
  propOverrides: Partial<React.ComponentProps<typeof ArticleDocument>> = {},
) {
  const props = {
    article: { ...baseArticle, ...articleOverrides },
    onExternalLinkError: jest.fn(),
    onExternalLinkStart: jest.fn(),
    openUrl: jest.fn().mockResolvedValue(undefined),
    renderArticleAudioPlayer: (summaryDisclosure: ReactNode) => (
      <View testID="article-audio-player">{summaryDisclosure}</View>
    ),
    ...propOverrides,
  };

  const view = await render(
    <GardenThemeProvider
      accessibilityPreferencesOverride={{}}
      colorSchemeOverride="light"
    >
      <ArticleDocument {...props} />
    </GardenThemeProvider>,
  );

  return { ...props, ...view };
}

function collectTestIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectTestIds);
  if (typeof value !== "object" || value === null) return [];
  const node = value as {
    children?: unknown;
    props?: Readonly<{ testID?: unknown }>;
  };
  const own = typeof node.props?.testID === "string" ? [node.props.testID] : [];
  return [...own, ...collectTestIds(node.children)];
}

describe("ArticleDocument URL helpers", () => {
  it("encodes canonical Curio Garden routes exactly once", () => {
    expect(buildCanonicalArticleUrl("AC/DC")).toBe(
      "https://curiogarden.org/article/AC%2FDC",
    );
    expect(buildCanonicalArticleUrl("Crème brûlée 東京")).toBe(
      "https://curiogarden.org/article/Cr%C3%A8me_br%C3%BBl%C3%A9e_%E6%9D%B1%E4%BA%AC",
    );
    expect(buildCanonicalArticleUrl("   ")).toBeNull();
  });

  it("pins Wikipedia links to validated language and revision parts", () => {
    expect(buildWikipediaRevisionUrl("EN", "00042")).toBe(
      "https://en.wikipedia.org/w/index.php?oldid=42",
    );
    expect(buildWikipediaRevisionUrl("zh-min-nan", "987654")).toBe(
      "https://zh-min-nan.wikipedia.org/w/index.php?oldid=987654",
    );
    expect(buildWikipediaRevisionUrl("en.evil.example", "42")).toBeNull();
    expect(buildWikipediaRevisionUrl("en", "42&redirect=yes")).toBeNull();
  });

  it("accepts only explicit safe HTTPS lead image URLs", () => {
    expect(normalizeLeadImageUrl("https://images.example/lead.png")).toBe(
      "https://images.example/lead.png",
    );
    expect(normalizeLeadImageUrl("http://images.example/lead.png")).toBeNull();
    expect(
      normalizeLeadImageUrl("https://user:secret@images.example/lead.png"),
    ).toBeNull();
    expect(normalizeLeadImageUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLeadImageUrl(undefined)).toBeNull();
  });
});

describe("ArticleDocument prose helpers", () => {
  it("splits normal paragraphs into separate accessibility stops", () => {
    expect(splitArticleProse("First paragraph.\n\nSecond paragraph.")).toEqual([
      "First paragraph.",
      "Second paragraph.",
    ]);
    expect(splitArticleProse(" \n\n  ")).toEqual([]);
  });

  it("chunks an abnormal paragraph without dropping a character", () => {
    const paragraph = Array.from(
      { length: 90 },
      (_, index) => `word-${index}`,
    ).join(" ");
    const chunks = splitArticleProse(paragraph, 80);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 80)).toBe(true);
    expect(chunks.join("")).toBe(paragraph);
  });

  it("never splits a grapheme cluster between text nodes", () => {
    const fixtures = [
      {
        prefixLength: ARTICLE_PARAGRAPH_CHUNK_LIMIT - 1,
        grapheme: "🌿",
      },
      {
        prefixLength: ARTICLE_PARAGRAPH_CHUNK_LIMIT - 1,
        grapheme: "e\u0301",
      },
      {
        prefixLength: ARTICLE_PARAGRAPH_CHUNK_LIMIT - 2,
        grapheme: "👩‍💻",
      },
      {
        prefixLength: ARTICLE_PARAGRAPH_CHUNK_LIMIT - 2,
        grapheme: "🇺🇸",
      },
      {
        prefixLength: ARTICLE_PARAGRAPH_CHUNK_LIMIT - 2,
        grapheme: "👍🏽",
      },
    ];

    for (const { grapheme, prefixLength } of fixtures) {
      const prefix = "a".repeat(prefixLength);
      const prose = `${prefix}${grapheme}tail`;
      const chunks = splitArticleProse(prose);

      expect(chunks.join("")).toBe(prose);
      expect(chunks).toEqual([prefix, `${grapheme}tail`]);
    }

    expect(splitArticleProse("👩‍💻tail", 1)[0]).toBe("👩‍💻");
  });

  it("allows a chunk boundary after completed extender sequences", () => {
    const englandFlagTagSequence =
      "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";

    expect(splitArticleProse("e\u0301t", 2)).toEqual(["e\u0301", "t"]);
    expect(splitArticleProse("👍🏽t", 4)).toEqual(["👍🏽", "t"]);
    expect(
      splitArticleProse(
        `${englandFlagTagSequence}t`,
        englandFlagTagSequence.length,
      ),
    ).toEqual([englandFlagTagSequence, "t"]);
  });

  it("does not join unrelated text after a standalone zero-width joiner", () => {
    expect(splitArticleProse("A\u200dB", 2)).toEqual(["A\u200d", "B"]);
  });

  it("keeps a Hangul Jamo syllable in one chunk", () => {
    expect(splitArticleProse("\u1100\u1161\u11a8t", 1)).toEqual([
      "\u1100\u1161\u11a8",
      "t",
    ]);
  });

  it("keeps a Unicode Prepend character with the following grapheme", () => {
    expect(splitArticleProse("\u0600At", 1)).toEqual(["\u0600A", "t"]);
  });

  it("allows one grapheme to exceed the chunk target without an empty stop", () => {
    expect(splitArticleProse("👩‍💻", 1)).toEqual(["👩‍💻"]);
  });

  it("falls back and clamps corrupt or extreme image dimensions", () => {
    expect(resolveLeadImageAspectRatio(undefined, undefined)).toBe(
      DEFAULT_LEAD_IMAGE_ASPECT_RATIO,
    );
    expect(resolveLeadImageAspectRatio(0, 400)).toBe(
      DEFAULT_LEAD_IMAGE_ASPECT_RATIO,
    );
    expect(resolveLeadImageAspectRatio(Number.POSITIVE_INFINITY, 400)).toBe(
      DEFAULT_LEAD_IMAGE_ASPECT_RATIO,
    );
    expect(resolveLeadImageAspectRatio(100, 1_000)).toBe(
      MIN_LEAD_IMAGE_ASPECT_RATIO,
    );
    expect(resolveLeadImageAspectRatio(4_000, 100)).toBe(
      MAX_LEAD_IMAGE_ASPECT_RATIO,
    );
    expect(resolveLeadImageAspectRatio(800, 400)).toBe(2);
  });
});

describe("ArticleDocument", () => {
  it("starts below the parent title and exposes article headings in order", async () => {
    await renderDocument({
      sections: [
        {
          wikiSectionIndex: "0",
          title: "Foundations",
          level: 2,
          content: "",
        },
        {
          wikiSectionIndex: "0.1",
          title: "Origins",
          level: 3,
          content: "A populated child subsection.",
        },
        ...(baseArticle.sections ?? []),
        {
          wikiSectionIndex: "3",
          title: "Empty appendix",
          level: 2,
          content: "  \n\n ",
        },
      ],
    });

    const headings = screen.getAllByRole("header");
    expect(headings).toHaveLength(7);
    expect(headings[0]).toHaveAccessibleName("Article text");
    expect(headings[1]).toHaveAccessibleName("Foundations");
    expect(headings[2]).toHaveAccessibleName("Origins");
    expect(headings[3]).toHaveAccessibleName("Early life");
    expect(headings[4]).toHaveAccessibleName("Legacy");
    expect(headings[5]).toHaveAccessibleName("Source and license");
    expect(headings[6]).toHaveAccessibleName("More on Curio Garden web");
    expect(screen.getByText("3 readable sections follow.")).toBeOnTheScreen();
    expect(
      screen.queryByRole("header", { name: baseArticle.title }),
    ).not.toBeOnTheScreen();
    expect(
      screen.queryByRole("header", { name: "Empty appendix" }),
    ).not.toBeOnTheScreen();
    expect(screen.getByTestId("article-section-0")).toHaveTextContent(
      "Foundations",
    );
    expect(
      screen.queryByTestId("article-section-0-paragraph-0"),
    ).not.toBeOnTheScreen();
  });

  it("keeps one lead and the disclosed remainder unclamped and lossless", async () => {
    const lead = "A short opening sentence.";
    const remainder = "Summary remainder ".repeat(190).trim();
    const summary = `${lead} ${remainder}`;
    const sectionContent = "Section prose ".repeat(220).trim();
    await renderDocument({
      summary,
      sections: [
        {
          wikiSectionIndex: "1",
          title: "A long section",
          level: 2,
          content: sectionContent,
        },
      ],
    });

    expect(screen.getByTestId("article-summary-lead")).toHaveTextContent(lead);
    expect(screen.queryByTestId("article-summary-remainder")).toBeNull();
    const disclosure = screen.getByRole("button", {
      name: "Show full text summary",
    });
    expect(disclosure).toHaveProp("accessibilityState", {
      busy: false,
      disabled: false,
      expanded: false,
    });

    await fireEvent.press(disclosure);

    const expandedDisclosure = screen.getByRole("button", {
      name: "Hide full text summary",
    });
    expect(expandedDisclosure).toBe(disclosure);
    expect(expandedDisclosure).toHaveProp("accessibilityState", {
      busy: false,
      disabled: false,
      expanded: true,
    });
    const summaryStops = screen.getAllByTestId(
      /^article-summary-remainder-paragraph-/u,
    );
    const sectionStops = screen.getAllByTestId(
      /^article-section-0-paragraph-/u,
    );

    expect(summaryStops.length).toBeGreaterThan(1);
    expect(sectionStops.length).toBeGreaterThan(1);
    expect(summaryStops.map((node) => node.props.children).join("")).toBe(
      remainder,
    );
    expect(screen.getAllByText(lead)).toHaveLength(1);
    expect(
      screen.getByTestId("article-summary-remainder"),
    ).not.toHaveTextContent(lead);
    expect(sectionStops.map((node) => node.props.children).join("")).toBe(
      sectionContent,
    );

    for (const prose of [...summaryStops, ...sectionStops]) {
      expect(prose.props.numberOfLines).toBeUndefined();
      expect(prose.props.adjustsFontSizeToFit).toBeUndefined();
    }

    await fireEvent.press(expandedDisclosure);
    expect(screen.queryByTestId("article-summary-remainder")).toBeNull();
    expect(screen.getByRole("button", { name: "Show full text summary" })).toBe(
      disclosure,
    );
  });

  it("orders native reading as lead, audio, disclosure, sections, then media", async () => {
    const view = await renderDocument({
      summary: "Pumpkins are fruits. Their story continues here.",
      thumbnailUrl: "https://images.example/pumpkin.png",
    });
    await fireEvent.press(
      screen.getByRole("button", { name: "Show full text summary" }),
    );
    const testIds = collectTestIds(view.toJSON());

    expect(testIds.indexOf("article-summary-lead")).toBeLessThan(
      testIds.indexOf("article-audio-player"),
    );
    expect(testIds.indexOf("article-audio-player")).toBeLessThan(
      testIds.indexOf("article-summary-disclosure"),
    );
    expect(testIds.indexOf("article-summary-disclosure")).toBeLessThan(
      testIds.indexOf("article-summary-remainder"),
    );
    expect(testIds.indexOf("article-summary-remainder")).toBeLessThan(
      testIds.indexOf("article-section-0"),
    );
    expect(testIds.indexOf("article-section-0")).toBeLessThan(
      testIds.indexOf("article-source-and-media"),
    );
    expect(testIds.indexOf("article-source-and-media")).toBeLessThan(
      testIds.indexOf("article-source-and-license"),
    );
  });

  it("omits disclosure for one sentence and keeps section audio ahead of text when no summary exists", async () => {
    const view = await renderDocument({ summary: "One complete sentence." });

    expect(screen.getByTestId("article-audio-player")).toBeOnTheScreen();
    expect(screen.queryByTestId("article-summary-disclosure")).toBeNull();

    await view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleDocument
          article={{ ...baseArticle, summary: " " }}
          onExternalLinkError={view.onExternalLinkError}
          onExternalLinkStart={view.onExternalLinkStart}
          openUrl={view.openUrl}
          renderArticleAudioPlayer={(summaryDisclosure) => (
            <View testID="article-audio-player">{summaryDisclosure}</View>
          )}
        />
      </GardenThemeProvider>,
    );

    expect(screen.getByTestId("article-audio-player")).toBeOnTheScreen();
    expect(screen.queryByTestId("article-summary-disclosure")).toBeNull();
    const noSummaryTestIds = collectTestIds(view.toJSON());
    expect(
      noSummaryTestIds.indexOf("article-audio-player"),
    ).toBeGreaterThanOrEqual(0);
    expect(noSummaryTestIds.indexOf("article-audio-player")).toBeLessThan(
      noSummaryTestIds.indexOf("article-section-0"),
    );
  });

  it("collapses disclosed text when the rendered article identity changes", async () => {
    const view = await renderDocument({
      summary: "The old lead. The old remainder.",
    });
    await fireEvent.press(
      screen.getByRole("button", { name: "Show full text summary" }),
    );
    expect(screen.getByText("The old remainder.")).toBeOnTheScreen();

    await view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleDocument
          article={{
            ...baseArticle,
            revisionId: "5678",
            summary: "The new lead. The new remainder.",
          }}
          onExternalLinkError={view.onExternalLinkError}
          onExternalLinkStart={view.onExternalLinkStart}
          openUrl={view.openUrl}
          renderArticleAudioPlayer={(summaryDisclosure) => (
            <View testID="article-audio-player">{summaryDisclosure}</View>
          )}
        />
      </GardenThemeProvider>,
    );

    expect(screen.getByText("The new lead.")).toBeOnTheScreen();
    expect(screen.queryByText("The old remainder.")).toBeNull();
    expect(screen.queryByText("The new remainder.")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show full text summary" }),
    ).toHaveProp("accessibilityState", {
      busy: false,
      disabled: false,
      expanded: false,
    });
  });

  it("uses honest provenance labels and provides useful empty-content copy", async () => {
    await renderDocument({ summary: " ", sections: undefined });

    expect(
      screen.getByText("Wikipedia (EN) · Revision 1234"),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/July 25, 2026/iu)).not.toBeOnTheScreen();
    expect(screen.queryByText(/last edited/iu)).not.toBeOnTheScreen();
    expect(
      screen.getByText("No summary is available for this revision."),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("No article sections are available for this revision."),
    ).toBeOnTheScreen();
    expect(screen.getByText("0 readable sections follow.")).toBeOnTheScreen();
  });

  it("contains a guarded contain-fit lead image with visible attribution", async () => {
    await renderDocument({
      thumbnailUrl: "https://images.example/ada.png",
      thumbnailWidth: 400,
      thumbnailHeight: 800,
      thumbnailAttribution: {
        creator: "Jane Example",
        credit: "Example Archive",
        licenseName: "CC BY 4.0",
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
        sourceTitle: "Ada portrait file page",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Ada.png",
      },
    });

    const image = screen.getByTestId("article-lead-image");
    expect(image).toHaveProp("accessibilityRole", "image");
    expect(image).toHaveAccessibleName("Lead image for Ada Lovelace");
    expect(image).toHaveProp("resizeMode", "contain");
    expect(StyleSheet.flatten(image.props.style)).toMatchObject({
      aspectRatio: MIN_LEAD_IMAGE_ASPECT_RATIO,
      width: "100%",
    });
    expect(screen.getByText("Lead image credit")).toBeOnTheScreen();
    expect(screen.getByText("Creator: Jane Example")).toBeOnTheScreen();
    expect(screen.getByText("Credit: Example Archive")).toBeOnTheScreen();
    expect(
      screen.getByRole("link", { name: "Image license: CC BY 4.0" }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("link", {
        name: "Image source: Ada portrait file page",
      }),
    ).toBeOnTheScreen();
  });

  it("keeps a valid image-license link when its name is absent", async () => {
    const props = await renderDocument({
      thumbnailUrl: "https://images.example/ada.png",
      thumbnailAttribution: {
        licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      },
    });

    const licenseLink = screen.getByRole("link", {
      name: "Image license: View license terms",
    });
    expect(
      screen.queryByText(
        "No image credit was included with this source revision.",
      ),
    ).not.toBeOnTheScreen();

    await fireEvent.press(licenseLink);
    expect(props.openUrl).toHaveBeenCalledWith(
      "https://creativecommons.org/licenses/by/4.0/",
    );
  });

  it("shows an inert fallback for an invalid URL or a native image failure", async () => {
    const view = await renderDocument({
      thumbnailUrl: "http://images.example/unsafe.png",
      thumbnailWidth: Number.NaN,
      thumbnailHeight: -10,
    });

    expect(screen.queryByTestId("article-lead-image")).not.toBeOnTheScreen();
    expect(screen.getByText("Lead image unavailable.")).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
    expect(screen.queryByRole("status")).not.toBeOnTheScreen();

    await view.rerender(
      <GardenThemeProvider
        accessibilityPreferencesOverride={{}}
        colorSchemeOverride="light"
      >
        <ArticleDocument
          article={{
            ...baseArticle,
            thumbnailUrl: "https://images.example/fails.png",
          }}
          onExternalLinkError={view.onExternalLinkError}
          onExternalLinkStart={view.onExternalLinkStart}
          openUrl={view.openUrl}
          renderArticleAudioPlayer={(summaryDisclosure) => (
            <View testID="article-audio-player">{summaryDisclosure}</View>
          )}
        />
      </GardenThemeProvider>,
    );
    const image = screen.getByTestId("article-lead-image");
    await fireEvent(image, "error", {
      nativeEvent: { error: "network detail" },
    });

    expect(screen.queryByTestId("article-lead-image")).not.toBeOnTheScreen();
    expect(screen.getByText("Lead image unavailable.")).toBeOnTheScreen();
    expect(screen.queryByRole("alert")).not.toBeOnTheScreen();
  });

  it("shows honest fallback copy for an absent image and retains stray attribution", async () => {
    await renderDocument({
      thumbnailUrl: undefined,
      thumbnailAttribution: {
        creator: "Archived contributor",
        sourceTitle: "Archived file record",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Archived.png",
      },
    });

    expect(screen.queryByTestId("article-lead-image")).not.toBeOnTheScreen();
    expect(
      screen.getByText("No lead image is available for this revision."),
    ).toBeOnTheScreen();
    expect(screen.getByText("Creator: Archived contributor")).toBeOnTheScreen();
    expect(
      screen.getByRole("link", {
        name: "Image source: Archived file record",
      }),
    ).toBeOnTheScreen();
  });

  it("opens every exact source destination through the shared link boundary", async () => {
    const props = await renderDocument({ title: "AC/DC" });

    await fireEvent.press(
      screen.getByRole("link", { name: "View Wikipedia revision 1234" }),
    );
    await fireEvent.press(
      screen.getByRole("link", {
        name: "Read the Creative Commons Attribution-ShareAlike 4.0 License",
      }),
    );
    await fireEvent.press(
      screen.getByRole("link", {
        name: "Open richer article features on Curio Garden web",
      }),
    );

    expect(props.openUrl).toHaveBeenNthCalledWith(
      1,
      "https://en.wikipedia.org/w/index.php?oldid=1234",
    );
    expect(props.openUrl).toHaveBeenNthCalledWith(
      2,
      "https://creativecommons.org/licenses/by-sa/4.0/",
    );
    expect(props.openUrl).toHaveBeenNthCalledWith(
      3,
      "https://curiogarden.org/article/AC%2FDC",
    );
    expect(props.onExternalLinkStart).toHaveBeenCalledTimes(3);
  });

  it("names the richer-web features without claiming unsupported native ones", async () => {
    await renderDocument();

    expect(
      screen.getByText(
        "Galleries, broader context, and citation details remain available on the canonical Curio Garden web article.",
      ),
    ).toBeOnTheScreen();
    expect(
      screen.queryByText(/offline|push notification/iu),
    ).not.toBeOnTheScreen();
  });

  it("forwards launch failures without exposing the raw error", async () => {
    const props = await renderDocument(
      {},
      {
        openUrl: jest.fn().mockRejectedValue(new Error("browser secret")),
      },
    );

    await fireEvent.press(
      screen.getByRole("link", {
        name: "Open richer article features on Curio Garden web",
      }),
    );

    expect(props.onExternalLinkStart).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(props.onExternalLinkError).toHaveBeenCalledTimes(1),
    );
    expect(props.onExternalLinkError).toHaveBeenCalledWith(
      jest.mocked(props.onExternalLinkStart).mock.calls[0]?.[0],
    );
    expect(screen.queryByText(/browser secret/iu)).not.toBeOnTheScreen();
  });

  it("keeps unsafe attribution destinations inert and visibly unavailable", async () => {
    await renderDocument({
      thumbnailUrl: "https://images.example/ada.png",
      thumbnailAttribution: {
        licenseName: "Mystery license",
        licenseUrl: "javascript:alert(1)",
        sourceTitle: "Mystery source",
        sourceUrl: "http://example.com/source",
      },
    });

    expect(
      screen.getByText("Image license: Mystery license"),
    ).toBeOnTheScreen();
    expect(
      screen.getByText("Image source: Mystery source — link unavailable"),
    ).toBeOnTheScreen();
    expect(
      screen.queryByRole("link", { name: /Mystery/iu }),
    ).not.toBeOnTheScreen();
  });
});
