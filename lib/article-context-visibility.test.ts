import { describe, expect, it } from "vitest";
import type { ContextBlock, ContextDiagramBlock } from "./article-context-types";
import { getVisibleArticleContextBlocks } from "./article-context-visibility";
import { isArticleGalleryImageCandidate } from "./article-image-policy";
import { getWikimediaMediaIdentity } from "./wikimedia-media";

const baseDiagram = (
  src: string,
  image: Partial<ContextDiagramBlock["diagram"]["image"]> = {},
): ContextDiagramBlock => ({
  id: `diagram-${src}`,
  kind: "diagram",
  title: "Source diagram",
  caption: "A source diagram with a complete visible caption.",
  longDescription: "A complete nonvisual description of the source diagram.",
  section: { index: "1", title: "Process" },
  order: 1,
  sources: [],
  provenance: {
    articleUrl: "https://en.wikipedia.org/wiki/Example",
    articleRevisionUrl: "https://en.wikipedia.org/w/index.php?oldid=123",
    sourceHash: "source-hash",
    extractorVersion: "2.0.1",
    descriptionMethod: "deterministic",
  },
  diagram: {
    image: {
      src,
      alt: "A source diagram.",
      width: 500,
      height: 320,
      ...image,
    },
    parts: [],
    relationships: [],
    walkthrough: ["Follow the source caption."],
    caption: "A source diagram with a complete caption.",
  },
});

const waterHero =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/USGS_WaterCycle_English_ONLINE_20221013.png/960px-USGS_WaterCycle_English_ONLINE_20221013.png";
const waterDiagram =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/USGS_WaterCycle_English_ONLINE_20221013.png/500px-USGS_WaterCycle_English_ONLINE_20221013.png";

describe("article context diagram visibility", () => {
  it("removes only a Gallery-eligible third copy of the hero image", () => {
    const mapBlock = { id: "map", kind: "map" } as ContextBlock;
    const distinctDiagram = baseDiagram(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Distinct.png/500px-Distinct.png",
    );
    const blocks = [mapBlock, baseDiagram(waterDiagram), distinctDiagram];

    expect(getVisibleArticleContextBlocks(blocks, waterHero)).toEqual([
      mapBlock,
      distinctDiagram,
    ]);
  });

  it("keeps a matching hero diagram when Gallery would exclude the figure", () => {
    const tooSmall = baseDiagram(waterDiagram, { width: 99 });
    const tooWide = baseDiagram(waterDiagram, { width: 601, height: 200 });

    expect(getVisibleArticleContextBlocks([tooSmall], waterHero)).toEqual([
      tooSmall,
    ]);
    expect(getVisibleArticleContextBlocks([tooWide], waterHero)).toEqual([
      tooWide,
    ]);
  });

  it("does not merge same-named files from Commons and English Wikipedia", () => {
    const commonsDiagram = baseDiagram(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Poster.png/500px-Poster.png",
    );
    const enwikiHero =
      "https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Poster.png/800px-Poster.png";

    expect(
      getVisibleArticleContextBlocks([commonsDiagram], enwikiHero),
    ).toEqual([commonsDiagram]);
  });

  it("preserves all blocks and their array identity without a usable hero", () => {
    const blocks = [baseDiagram(waterDiagram)];

    expect(getVisibleArticleContextBlocks(blocks, undefined)).toBe(blocks);
    expect(getVisibleArticleContextBlocks(blocks, "not a media URL")).toBe(
      blocks,
    );
  });

  it("keeps Gallery media whose canonical file differs from the hero", () => {
    const animatedDiagram = baseDiagram(
      "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Engine.gif/500px-Engine.gif",
    );

    expect(
      getVisibleArticleContextBlocks([animatedDiagram], waterHero),
    ).toEqual([animatedDiagram]);
  });
});

describe("article media identity and Gallery policy", () => {
  it("canonicalizes Wikimedia thumbnail sizes and rasterized SVG renditions", () => {
    expect(getWikimediaMediaIdentity(waterHero)).toBe(
      getWikimediaMediaIdentity(waterDiagram),
    );
    expect(
      getWikimediaMediaIdentity(
        "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Process.svg/500px-Process.svg.png",
      ),
    ).toBe("commons:file:Process.svg");
  });

  it("uses the Gallery's inclusive size and aspect-ratio boundaries", () => {
    expect(
      isArticleGalleryImageCandidate({ src: waterDiagram, width: 100, height: 100 }),
    ).toBe(true);
    expect(
      isArticleGalleryImageCandidate({ src: waterDiagram, width: 99, height: 100 }),
    ).toBe(false);
    expect(
      isArticleGalleryImageCandidate({ src: waterDiagram, width: 300, height: 100 }),
    ).toBe(true);
    expect(
      isArticleGalleryImageCandidate({ src: waterDiagram, width: 301, height: 100 }),
    ).toBe(false);
  });

  it("excludes SVG source segments and MediaWiki math images", () => {
    expect(
      isArticleGalleryImageCandidate({
        src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Process.svg",
      }),
    ).toBe(false);
    expect(
      isArticleGalleryImageCandidate({
        src: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Process.svg/500px-Process.svg.png",
      }),
    ).toBe(false);
    expect(
      isArticleGalleryImageCandidate({
        src: "https://wikimedia.org/api/rest_v1/media/math/render/png/example",
      }),
    ).toBe(false);
    expect(
      isArticleGalleryImageCandidate({
        src: "https://upload.wikimedia.org/wikipedia/commons/a/ab/Process.svg.png",
      }),
    ).toBe(true);
  });
});
