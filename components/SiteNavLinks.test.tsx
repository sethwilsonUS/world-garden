import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteNavLinks } from "./SiteNavLinks";

let authState: "signed-in" | "signed-out" = "signed-out";

vi.mock("@clerk/nextjs", () => ({
  Show: ({
    when,
    children,
  }: {
    when: "signed-in" | "signed-out";
    children: ReactNode;
  }) => (when === authState ? createElement("div", null, children) : null),
}));

describe("SiteNavLinks", () => {
  it("shows Library for signed-out navigation", () => {
    authState = "signed-out";

    const markup = renderToStaticMarkup(
      createElement(SiteNavLinks, { variant: "desktop", authEnabled: true }),
    );

    expect(markup).toContain("Library");
    expect(markup).not.toContain("Dashboard");
  });

  it("shows Dashboard instead of Library for signed-in navigation", () => {
    authState = "signed-in";

    const markup = renderToStaticMarkup(
      createElement(SiteNavLinks, { variant: "desktop", authEnabled: true }),
    );

    expect(markup).toContain("Dashboard");
    expect(markup).not.toContain("Library");
  });

  it("falls back to Library when auth is disabled", () => {
    const markup = renderToStaticMarkup(
      createElement(SiteNavLinks, { variant: "footer", authEnabled: false }),
    );

    expect(markup).toContain("Library");
  });
});
