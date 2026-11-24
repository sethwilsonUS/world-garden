import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn() }),
}));

const { HeaderSearch, SearchForm, isHeaderSearchHidden } = await import(
  "./SearchForm"
);

describe("HeaderSearch", () => {
  afterEach(() => {
    pathname = "/";
  });

  it.each(["/", "/search"])(
    "stays out of the header on %s, which already leads with search",
    (path) => {
      pathname = path;
      expect(isHeaderSearchHidden(path)).toBe(true);
      expect(renderToStaticMarkup(createElement(HeaderSearch))).toBe("");
    },
  );

  it("renders a labelled site search landmark on other pages", () => {
    pathname = "/article/Ada_Lovelace";
    const markup = renderToStaticMarkup(createElement(HeaderSearch));

    expect(markup).toContain('role="search"');
    expect(markup).toContain('aria-label="Site search"');
    expect(markup).toContain('id="header-search-input"');
    expect(markup).toContain(">Search articles</label>");
    expect(markup).toContain('aria-label="Search"');
    // Must not collide with the page-level search field's id or name.
    expect(markup).not.toContain('id="search-input"');
    expect(markup).not.toContain("Search topic");
  });
});

describe("SearchForm", () => {
  it("keeps the page-level field name and an optional description", () => {
    const markup = renderToStaticMarkup(
      createElement(SearchForm, {
        variant: "workbench",
        describedBy: "home-search-description",
      }),
    );

    expect(markup).toContain(">Search topic</label>");
    expect(markup).toContain('id="search-input"');
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-autocomplete="list"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain('aria-controls="search-input-suggestions"');
    expect(markup).toContain('id="search-input-suggestions"');
    expect(markup).toContain('role="listbox"');
    expect(markup).toContain('aria-describedby="home-search-description"');
    expect(markup).toContain('placeholder="Search any topic…"');
  });
});
