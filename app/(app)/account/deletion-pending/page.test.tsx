import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountDeletionPendingPage, { metadata } from "./page";

describe("AccountDeletionPendingPage", () => {
  it("explains a durable pending request without claiming completion", () => {
    const markup = renderToStaticMarkup(
      createElement(AccountDeletionPendingPage),
    );

    expect(metadata.title).toBe("Account deletion in progress — Curio Garden");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(markup).toContain("Your deletion request is still being finished.");
    expect(markup).toContain("saved the request");
    expect(markup).toContain("You do not need to submit it again");
    expect(markup).not.toContain("Your Curio Garden account has been deleted.");
  });
});
