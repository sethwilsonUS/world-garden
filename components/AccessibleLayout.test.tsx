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
  it("describes both speech services without claiming one is always primary", () => {
    const markup = renderToStaticMarkup(
      createElement(
        AccessibleLayout,
        null,
        createElement("div", null, "Content"),
      ),
    );

    expect(markup).toContain(
      "Audio uses synthetic speech from Edge TTS and OpenAI.",
    );
    expect(markup).not.toContain("OpenAI with Edge TTS fallback");
    expect(markup).toContain("Wikipedia");
    expect(markup).toContain(
      "not endorsed by or affiliated with the Wikimedia Foundation",
    );
    expect(markup).toContain(
      "min-h-[calc(100svh_-_var(--site-header-height,48px))]",
    );
  });
});
