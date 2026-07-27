import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalEnvironment = {
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
  e2eFormAvailable: process.env.CURIO_E2E_FEEDBACK_FORM_AVAILABLE,
  localMode: process.env.NEXT_PUBLIC_LOCAL_MODE,
  writeSecret: process.env.PRODUCT_FEEDBACK_WRITE_SECRET,
};

const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(() => {
  delete process.env.CURIO_E2E_FEEDBACK_FORM_AVAILABLE;
});

afterEach(() => {
  vi.resetModules();
  restore(
    "CURIO_E2E_FEEDBACK_FORM_AVAILABLE",
    originalEnvironment.e2eFormAvailable,
  );
  restore("NEXT_PUBLIC_CONVEX_URL", originalEnvironment.convexUrl);
  restore("NEXT_PUBLIC_LOCAL_MODE", originalEnvironment.localMode);
  restore("PRODUCT_FEEDBACK_WRITE_SECRET", originalEnvironment.writeSecret);
});

describe("FeedbackPage", () => {
  it("invites anonymous feedback without asking for a diagnosis", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    process.env.PRODUCT_FEEDBACK_WRITE_SECRET = "feedback-secret";
    const { default: FeedbackPage, metadata } = await import("./page");
    const markup = renderToStaticMarkup(
      await FeedbackPage({ searchParams: Promise.resolve({}) }),
    );

    expect(metadata.title).toBe("Feedback and research — Curio Garden");
    expect(markup).toContain("Help the garden learn");
    expect(markup).toContain("without signing in");
    expect(markup).toContain("No diagnosis is required");
    expect(markup).toContain("one experience cannot represent everyone");
    expect(markup).toContain('href="/privacy#privacy-feedback"');
    expect(markup).toContain("<form");
  });

  it("does not render a form that cannot persist in local mode", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    process.env.PRODUCT_FEEDBACK_WRITE_SECRET = "feedback-secret";
    const { default: FeedbackPage } = await import("./page");
    const markup = renderToStaticMarkup(
      await FeedbackPage({ searchParams: Promise.resolve({}) }),
    );

    expect(markup).not.toContain("<form");
    expect(markup).toContain("temporarily unavailable");
    expect(markup).toContain("Nothing has been recorded");
    expect(markup).toContain(
      "github.com/sethwilsonUS/world-garden/discussions",
    );
    expect(markup).toContain("Discussions are public");
  });

  it("shows bounded article context supplied by an article page", async () => {
    process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
    process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
    process.env.PRODUCT_FEEDBACK_WRITE_SECRET = "feedback-secret";
    const { default: FeedbackPage } = await import("./page");
    const markup = renderToStaticMarkup(
      await FeedbackPage({
        searchParams: Promise.resolve({
          articleTitle: "Lothlórien",
          articleSlug: "Lothlórien",
          articleRevisionId: "123456",
        }),
      }),
    );

    expect(markup).toContain("Feedback on this article");
    expect(markup).toContain("Lothlórien");
    expect(markup).toContain("Wikipedia revision 123456");
    expect(markup).toContain('href="/article/Lothl%C3%B3rien"');
    expect(markup).toContain("Back to Lothlórien");
  });
});
