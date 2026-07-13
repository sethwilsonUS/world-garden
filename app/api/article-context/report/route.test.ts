import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchAction = vi.hoisted(() => vi.fn());

vi.mock("convex/nextjs", () => ({ fetchAction }));

const originalEnv = {
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
  localMode: process.env.NEXT_PUBLIC_LOCAL_MODE,
  secret: process.env.ARTICLE_CONTEXT_WRITE_SECRET,
};

const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
  process.env.ARTICLE_CONTEXT_WRITE_SECRET = "report-secret";
  fetchAction.mockResolvedValue({ created: true });
});

afterEach(() => {
  restore("NEXT_PUBLIC_CONVEX_URL", originalEnv.convexUrl);
  restore("NEXT_PUBLIC_LOCAL_MODE", originalEnv.localMode);
  restore("ARTICLE_CONTEXT_WRITE_SECRET", originalEnv.secret);
});

const request = (body: Record<string, unknown>) =>
  new NextRequest("https://curiogarden.org/api/article-context/report", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.42",
      "user-agent": "test-browser",
    },
    body: JSON.stringify(body),
  });

describe("POST /api/article-context/report", () => {
  it("persists a normalized report without exposing the IP address", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request({
        wikiPageId: "42",
        revisionId: "100",
        blockId: "context-map-example",
        sourceHash: "abc123",
        reason: "inaccessible",
        details: "The place controls need clearer labels.",
      }),
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      accepted: true,
      persisted: true,
    });
    expect(fetchAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        reason: "accessibility",
        reporterKey: expect.stringMatching(/^context-reporter:[a-f0-9]{40}$/),
      }),
    );
    expect(JSON.stringify(fetchAction.mock.calls)).not.toContain("203.0.113.42");
  });

  it("requires details for an other report", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request({
        wikiPageId: "42",
        revisionId: "100",
        blockId: "context-map-example",
        sourceHash: "abc123",
        reason: "other",
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchAction).not.toHaveBeenCalled();
  });

  it("rejects inherited object property names as report reasons", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request({
        wikiPageId: "42",
        revisionId: "100",
        blockId: "context-map-example",
        sourceHash: "abc123",
        reason: "toString",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Report reason is invalid",
    });
    expect(fetchAction).not.toHaveBeenCalled();
  });

  it("accepts locally without pretending the report was persisted", async () => {
    process.env.NEXT_PUBLIC_LOCAL_MODE = "true";
    const { POST } = await import("./route");
    const response = await POST(
      request({
        wikiPageId: "42",
        revisionId: "100",
        blockId: "context-map-example",
        sourceHash: "abc123",
        reason: "incorrect",
      }),
    );

    await expect(response.json()).resolves.toEqual({
      accepted: true,
      persisted: false,
    });
  });
});
