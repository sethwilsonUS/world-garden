import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMutation = vi.hoisted(() => vi.fn());

vi.mock("convex/nextjs", () => ({ fetchMutation }));

const originalEnv = {
  convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
  localMode: process.env.NEXT_PUBLIC_LOCAL_MODE,
  quotaSecret: process.env.TTS_QUOTA_BYPASS_SECRET,
  writeSecret: process.env.PRODUCT_FEEDBACK_WRITE_SECRET,
};

const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchMutation.mockReset();
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";
  process.env.NEXT_PUBLIC_LOCAL_MODE = "false";
  delete process.env.TTS_QUOTA_BYPASS_SECRET;
  process.env.PRODUCT_FEEDBACK_WRITE_SECRET = "feedback-write-secret";
  fetchMutation
    .mockResolvedValueOnce({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    })
    .mockResolvedValueOnce({ feedbackId: "productFeedback-1" });
});

afterEach(() => {
  restore("NEXT_PUBLIC_CONVEX_URL", originalEnv.convexUrl);
  restore("NEXT_PUBLIC_LOCAL_MODE", originalEnv.localMode);
  restore("TTS_QUOTA_BYPASS_SECRET", originalEnv.quotaSecret);
  restore("PRODUCT_FEEDBACK_WRITE_SECRET", originalEnv.writeSecret);
});

const request = (
  body: unknown,
  {
    contentType = "application/json",
    url = "https://curiogarden.org/api/feedback?query=private-search",
  }: { contentType?: string; url?: string } = {},
) =>
  new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "x-forwarded-for": "203.0.113.42",
      "user-agent": "Private assistive-tech browser details",
      referer: "https://curiogarden.org/article/Private_reading_history",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const validFeedback = {
  kind: "accessibility",
  message: "  The play button needs a clearer name.  ",
  environment: " VoiceOver and Safari ",
  contactEmail: " reader@example.com ",
  researchOptIn: true,
  articleTitle: " Saturn ",
  articleSlug: " Saturn ",
  articleRevisionId: " 1357913579 ",
};

describe("POST /api/feedback", () => {
  it("persists only normalized public fields through the protected mutation", async () => {
    const { POST } = await import("./route");
    const response = await POST(request(validFeedback));

    expect(response.status).toBe(202);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(fetchMutation).toHaveBeenCalledTimes(2);

    const quotaArgs = fetchMutation.mock.calls[0]?.[1];
    expect(quotaArgs).toMatchObject({
      key: expect.stringMatching(/^route-quota:product-feedback:[a-f0-9]{64}$/),
      limit: 5,
      windowMs: 60 * 60 * 1_000,
    });
    expect(JSON.stringify(quotaArgs)).not.toContain("203.0.113.42");

    expect(fetchMutation.mock.calls[1]?.[1]).toEqual({
      adminSecret: "feedback-write-secret",
      kind: "accessibility",
      message: "The play button needs a clearer name.",
      environment: "VoiceOver and Safari",
      contactEmail: "reader@example.com",
      researchOptIn: true,
      articleTitle: "Saturn",
      articleSlug: "Saturn",
      articleRevisionId: "1357913579",
    });
    expect(JSON.stringify(fetchMutation.mock.calls)).not.toContain(
      "Private assistive-tech browser details",
    );
    expect(JSON.stringify(fetchMutation.mock.calls)).not.toContain(
      "private-search",
    );
    expect(JSON.stringify(fetchMutation.mock.calls)).not.toContain(
      "Private_reading_history",
    );
  });

  it("returns safe validation errors without attempting persistence", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request({
        kind: "product",
        message: "I would like to help with research.",
        researchOptIn: true,
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Contact email is required for research volunteers",
    });
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("rejects incoherent article context without deriving it from the URL", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      request(
        {
          kind: "technical",
          message: "Article feedback",
          researchOptIn: false,
          articleRevisionId: "1357913579",
        },
        {
          url: "https://curiogarden.org/api/feedback?articleSlug=Saturn",
        },
      ),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Article title and slug are required together",
    });
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("rejects non-JSON and oversized requests", async () => {
    const { POST } = await import("./route");

    const wrongType = await POST(
      request(JSON.stringify(validFeedback), {
        contentType: "text/plain",
      }),
    );
    expect(wrongType.status).toBe(400);
    await expect(wrongType.json()).resolves.toEqual({
      error: "Feedback must be sent as JSON",
    });

    fetchMutation.mockReset().mockResolvedValue({
      allowed: true,
      remaining: 4,
      resetAt: Date.now() + 60_000,
    });
    const oversized = await POST(request("x".repeat(8_193)));
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toEqual({
      error: "Feedback request is too large",
    });
  });

  it("rejects an oversized declared body without reading its stream", async () => {
    const body = new ReadableStream<Uint8Array>({ pull: () => undefined });
    const oversized = new Request(
      "https://curiogarden.org/api/feedback",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "8193",
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );
    const { POST } = await import("./route");

    const response = await POST(oversized as NextRequest);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Feedback request is too large",
    });
    expect(oversized.bodyUsed).toBe(false);
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("returns a retryable response when the submission quota is exhausted", async () => {
    fetchMutation.mockReset().mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 30_000,
    });
    const { POST } = await import("./route");
    const response = await POST(request(validFeedback));

    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(response.json()).resolves.toEqual({
      error: "Feedback is being sent too often. Try again later.",
    });
    expect(fetchMutation).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the platform does not supply a client address", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validFeedback),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Feedback is temporarily unavailable. Try again later.",
    });
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      "[/api/feedback] Feedback quota check failed",
    );

    consoleError.mockRestore();
  });

  it.each([
    ["missing Convex", { NEXT_PUBLIC_CONVEX_URL: "" }],
    ["local mode", { NEXT_PUBLIC_LOCAL_MODE: "true" }],
    ["missing write secret", { PRODUCT_FEEDBACK_WRITE_SECRET: "" }],
  ])("fails clearly without persistence in %s", async (_name, environment) => {
    Object.assign(process.env, environment);
    const { POST } = await import("./route");
    const response = await POST(request(validFeedback));

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Feedback is temporarily unavailable. Try again later.",
    });
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("does not expose quota or persistence failures", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    fetchMutation
      .mockReset()
      .mockResolvedValueOnce({
        allowed: true,
        remaining: 4,
        resetAt: Date.now() + 60_000,
      })
      .mockRejectedValueOnce(new Error("database detail for 203.0.113.42"));
    const { POST } = await import("./route");
    const response = await POST(request(validFeedback));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Feedback is temporarily unavailable. Try again later.",
    });
    expect(consoleError).toHaveBeenCalledWith(
      "[/api/feedback] Feedback persistence failed",
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      "203.0.113.42",
    );

    consoleError.mockRestore();
  });
});
