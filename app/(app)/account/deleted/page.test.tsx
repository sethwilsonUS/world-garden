import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountDeletedPage, { metadata } from "./page";

describe("AccountDeletedPage", () => {
  it("confirms deletion without implying device-local or shared data vanished", () => {
    const markup = renderToStaticMarkup(createElement(AccountDeletedPage));

    expect(metadata.title).toBe("Account deleted — Curio Garden");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(markup).toContain("Your Curio Garden account has been deleted.");
    expect(markup).toContain("finish removing any remaining signed-in data");
    expect(markup).toContain("Browser-only history and preferences");
    expect(markup).toContain("Files already downloaded");
    expect(markup).toContain("Anonymous feedback");
    expect(markup).toContain('href="/feedback"');
  });
});
