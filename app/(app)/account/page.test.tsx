import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AccountPage, { metadata } from "./page";

vi.mock("@clerk/nextjs", () => ({
  SignInButton: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

describe("AccountPage", () => {
  it("publishes account-data metadata and renders the account export route", () => {
    const markup = renderToStaticMarkup(createElement(AccountPage));

    expect(metadata.title).toBe("Account & data — Curio Garden");
    expect(metadata.description).toContain("export");
    expect(markup).toContain("Account &amp; data");
    expect(markup).toContain("Sign in to export your account data");
  });
});
