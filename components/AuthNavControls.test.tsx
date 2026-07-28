import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthNavControls } from "./AuthNavControls";

let authState: "signed-in" | "signed-out" = "signed-out";

vi.mock("@clerk/nextjs", () => ({
  Show: ({
    when,
    children,
  }: {
    when: "signed-in" | "signed-out";
    children: ReactNode;
  }) => (when === authState ? createElement("div", null, children) : null),
  SignInButton: ({ children }: { children: ReactNode }) =>
    createElement("div", { "data-clerk-button": "sign-in" }, children),
  UserButton: Object.assign(
    ({ children }: { children?: ReactNode }) =>
      createElement("div", null, "User menu", children),
    {
      MenuItems: ({ children }: { children: ReactNode }) =>
        createElement("div", { "data-clerk-menu-items": true }, children),
      Link: ({
        href,
        label,
        labelIcon,
      }: {
        href: string;
        label: string;
        labelIcon: ReactNode;
      }) => createElement("a", { href }, labelIcon, label),
    },
  ),
}));

describe("AuthNavControls", () => {
  it("shows a single sign-in control and no sign-up button when signed out", () => {
    authState = "signed-out";

    const markup = renderToStaticMarkup(createElement(AuthNavControls));

    expect(markup).toContain("Sign in");
    expect(markup).toContain("cursor-pointer");
    expect(markup).not.toContain("Sign up");
  });

  it("uses a pointer cursor for the mobile sign-in control", () => {
    authState = "signed-out";

    const markup = renderToStaticMarkup(
      createElement(AuthNavControls, { mobile: true }),
    );

    expect(markup).toContain("cursor-pointer");
  });

  it("shows the user menu when signed in", () => {
    authState = "signed-in";

    const markup = renderToStaticMarkup(createElement(AuthNavControls));

    expect(markup).toContain("User menu");
    expect(markup).toContain("Account &amp; data");
    expect(markup).toContain('href="/account"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain('width="16"');
    expect(markup).toContain('height="16"');
  });
});
