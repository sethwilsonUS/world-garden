import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccessibleLayout } from "./AccessibleLayout";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

vi.mock("./ThemeToggle", () => ({
  ThemeToggle: () => createElement("button", null, "Theme"),
}));

describe("AccessibleLayout", () => {
  it("describes OpenAI primary audio with Edge TTS fallback in the footer", () => {
    const markup = renderToStaticMarkup(
      createElement(AccessibleLayout, null, createElement("div", null, "Content")),
    );

    expect(markup).toContain("Audio powered by OpenAI with Edge TTS fallback.");
    expect(markup).not.toContain("Audio powered by Edge TTS.");
    expect(markup).toContain("Wikipedia");
  });
});
