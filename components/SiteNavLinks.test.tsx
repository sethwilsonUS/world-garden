import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isSiteNavHrefCurrent, SiteNavLinks } from "./SiteNavLinks";

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

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("SiteNavLinks", () => {
  it("matches current navigation only at path boundaries", () => {
    expect(isSiteNavHrefCurrent("/about", "/about")).toBe(true);
    expect(isSiteNavHrefCurrent("/about/engineering", "/about")).toBe(true);
    expect(isSiteNavHrefCurrent("/aboutness", "/about")).toBe(false);
    expect(isSiteNavHrefCurrent("/library-archive", "/library")).toBe(false);
  });

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

  it("does not expose Did You Know as a standalone navigation item", () => {
    const markup = renderToStaticMarkup(
      createElement(SiteNavLinks, { variant: "desktop", authEnabled: false }),
    );

    expect(markup).not.toContain("Did you know?");
    expect(markup).not.toContain("/did-you-know");
  });

  it("marks the current page and includes About in footer navigation", () => {
    const markup = renderToStaticMarkup(
      createElement(SiteNavLinks, { variant: "footer", authEnabled: false }),
    );

    expect(markup).toContain('aria-current="page"');
    expect(markup).toContain('href="/about"');
  });
});
