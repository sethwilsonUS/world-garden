import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AboutPage from "./page";

describe("AboutPage", () => {
  it("explains the founder context without claiming one universal experience", () => {
    const markup = renderToStaticMarkup(createElement(AboutPage));

    expect(markup).toContain("Free knowledge, made listenable");
    expect(markup).toContain("Seth Wilson");
    expect(markup).toContain("is visually impaired");
    expect(markup).toContain(
      "That origin is context, not a claim to represent everyone",
    );
    expect(markup).toContain("One person&#x27;s workflow is one data point");
    expect(markup).toContain("github.com/sethwilsonUS/world-garden");
    expect(markup).toContain("not endorsed by or affiliated with");
  });
});
