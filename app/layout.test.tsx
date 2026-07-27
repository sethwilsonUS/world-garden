import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Fraunces: () => ({ variable: "fraunces" }),
  DM_Sans: () => ({ variable: "dm-sans" }),
  JetBrains_Mono: () => ({ variable: "jetbrains-mono" }),
}));

vi.mock("@clerk/nextjs", () => ({
  ClerkProvider: () => {
    throw new Error("The global layout must not depend on Clerk middleware");
  },
}));

vi.mock("@/lib/tts-profile", () => ({
  getActiveTtsProfile: () => "test",
  getTtsMetadata: () => ({}),
  serializeTtsMetadataForInlineScript: () => "{}",
}));

import RootLayout from "./layout";

describe("RootLayout", () => {
  it("can render a global not-found response without Clerk middleware", () => {
    const markup = renderToStaticMarkup(
      createElement(
        RootLayout,
        null,
        createElement("main", null, "Page not found"),
      ),
    );

    expect(markup).toContain("Page not found");
  });
});
