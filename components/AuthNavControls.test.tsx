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
  UserButton: () => createElement("div", null, "User menu"),
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
  });
});
