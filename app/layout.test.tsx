import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Fraunces: () => ({ variable: "fraunces" }),
  DM_Sans: () => ({ variable: "dm-sans" }),
  JetBrains_Mono: () => ({ variable: "jetbrains-mono" }),
}));

vi.mock("@clerk/nextjs", () => {
  throw new Error("The global layout must not depend on Clerk middleware");
});

vi.mock("@vercel/analytics/next", () => ({ Analytics: () => null }));
vi.mock("@vercel/speed-insights/next", () => ({ SpeedInsights: () => null }));

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
    expect(markup).toContain('name="text-scale"');
    expect(markup).toContain('content="scale"');
    expect(markup).toContain("-apple-system-body");
    expect(markup).toContain("--os-text-base");
    expect(markup).toContain("navigator.maxTouchPoints > 1");
  });
});
