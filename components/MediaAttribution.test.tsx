import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaAttribution } from "./MediaAttribution";

describe("MediaAttribution", () => {
  it("does not present source credit as the image creator", () => {
    const attribution = {
      credit: "Museum archive scan",
      sourceTitle: "File:Example.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
    };

    const compact = renderToStaticMarkup(
      createElement(MediaAttribution, { attribution, compact: true }),
    );
    const detailed = renderToStaticMarkup(
      createElement(MediaAttribution, { attribution }),
    );

    expect(compact).toContain("Image source");
    expect(compact).not.toContain("Image by Museum archive scan");
    expect(detailed).toContain("Credit:");
    expect(detailed).toContain("Museum archive scan");
    expect(detailed).not.toContain("Creator:");
  });
});
