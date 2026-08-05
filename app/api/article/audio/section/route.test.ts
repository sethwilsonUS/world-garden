import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { buildArticleNarrationTracks } from "@/lib/section-narration";
import {
  buildTtsMetadataHeaders,
  getTtsMetadata,
  getTtsProfile,
} from "@/lib/tts-profile";
import { createAudioCacheLedgerAssetKey } from "@/lib/audio-cache-ledger";

const auth = vi.hoisted(() => vi.fn());
const fetchQuery = vi.hoisted(() => vi.fn());
const fetchMutation = vi.hoisted(() => vi.fn());
const generateTtsAudioWithMetadata = vi.hoisted(() => vi.fn());
const fetchArticleByTitle = vi.hoisted(() => vi.fn());
const pendingAfterTasks = vi.hoisted(() => [] as Promise<unknown>[]);
const after = vi.hoisted(() =>
  vi.fn((task: () => unknown) => {
    pendingAfterTasks.push(Promise.resolve().then(task));
  }),
);

vi.mock("@clerk/nextjs/server", () => ({ auth }));
vi.mock("convex/nextjs", () => ({ fetchQuery, fetchMutation }));
vi.mock("@/lib/tts-client", () => ({ generateTtsAudioWithMetadata }));
vi.mock("@/convex/lib/wikipedia", () => ({
  fetchArticleByTitle,
  slugToTitle: (slug: string) => slug.replace(/_/g, " "),
}));
vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after };
});

const article = {
  _id: "article-1",
  title: "The Silmarillion",
  slug: "The_Silmarillion",
  revisionId: "123456",
  narrationVersion: 2,
  summary: "A history of the elder days of Middle-earth.",
  sections: [],
};
const summary = buildArticleNarrationTracks(article)[0];
const edgeMetadata = getTtsMetadata(getTtsProfile("edge"));
const openAiMetadata = getTtsMetadata(getTtsProfile("openai"));
const brokenLedgerAssetKey = "00000000-0000-4000-8000-000000000001";

const request = (
  provider: "edge" | "openai" = "edge",
  sourceHash = summary.sourceHash,
) =>
  new NextRequest("https://preview.example/api/article/audio/section", {
    method: "POST",
    headers: {
      cookie: "__session=session-cookie",
      "x-forwarded-for": "203.0.113.5",
    },
    body: JSON.stringify({
      slug: article.slug,
      sectionKey: summary.sectionKey,
      sourceHash,
      provider,
    }),
  });

const nativeRequest = ({
  authorization,
  cookie,
  provider = "edge",
  revisionId = article.revisionId,
  narrationVersion = article.narrationVersion,
}: {
  authorization?: string;
  cookie?: string;
  provider?: "edge" | "openai";
  revisionId?: string;
  narrationVersion?: number;
} = {}) =>
  new NextRequest("https://preview.example/api/article/audio/section", {
    method: "POST",
    headers: {
      cookie:
        cookie ??
        (authorization === undefined
          ? "__session=session-cookie"
          : "theme=garden"),
      ...(authorization !== undefined ? { authorization } : {}),
    },
    body: JSON.stringify({
      slug: article.slug,
      revisionId,
      narrationVersion,
      sectionKey: summary.sectionKey,
      provider,
    }),
  });

const rawArticleAudioRequest = (body: Record<string, unknown>) =>
  new NextRequest("https://preview.example/api/article/audio/section", {
    method: "POST",
    headers: { cookie: "__session=session-cookie" },
    body: JSON.stringify(body),
  });

describe("POST /api/article/audio/section", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    pendingAfterTasks.length = 0;
    fetchQuery.mockReset();
    fetchMutation.mockReset();
    generateTtsAudioWithMetadata.mockReset();
    fetchArticleByTitle.mockReset();
    vi.stubEnv("AUDIO_GENERATION_BASE_URL", "https://trusted.example");
    vi.stubEnv("TTS_QUOTA_BYPASS_SECRET", "server-secret");
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    auth.mockResolvedValue({ userId: null, getToken: vi.fn() });
    fetchQuery.mockResolvedValueOnce(article);
    fetchMutation.mockImplementation(async (functionReference) => {
      switch (getFunctionName(functionReference)) {
        case "audio:getAllSectionAudioForServer":
          return { urls: {}, durations: {}, metadata: {} };
        case "audio:recordSectionAudioCacheReadResult":
        case "audio:recordSectionAudioCacheWriteFailure":
          return { created: true, disposition: "inserted" };
        case "audio:generateUploadUrl":
          return "https://upload.example/audio";
        case "audio:saveSectionAudioRecord":
          return "audio-record-1";
        default:
          throw new Error(
            `Unexpected mutation: ${getFunctionName(functionReference)}`,
          );
      }
    });
    generateTtsAudioWithMetadata.mockResolvedValue({
      blob: new Blob([Uint8Array.of(1, 2, 3)], { type: "audio/mpeg" }),
      metadata: edgeMetadata,
    });
    fetchArticleByTitle.mockResolvedValue({
      title: article.title,
      revisionId: article.revisionId,
      narrationVersion: article.narrationVersion,
      summary: article.summary,
      sections: article.sections,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "https://upload.example/audio") {
          return Response.json({ storageId: "storage-1" });
        }
        throw new Error(`Unexpected fetch: ${String(input)}`);
      }),
    );
  });

  it("coerces a guest OpenAI request to Edge and persists canonical audio", async () => {
    const { POST } = await import("./route");
    const response = await POST(request("openai"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(response.headers.get("X-Curio-TTS-Fallback-Reason")).toBe(
      "openai_auth",
    );
    expect(generateTtsAudioWithMetadata).toHaveBeenCalledWith(
      { text: summary.text, provider: "edge" },
      {
        apiBaseUrl: "https://trusted.example",
        headers: expect.objectContaining({
          cookie: "__session=session-cookie",
          "x-forwarded-for": "203.0.113.5",
        }),
      },
    );
    const generatedHeaders = generateTtsAudioWithMetadata.mock.calls[0][1]
      .headers as Record<string, string>;
    expect(generatedHeaders).not.toHaveProperty("x-curio-tts-quota-bypass");
    expect(fetchMutation).toHaveBeenCalledTimes(4);
    expect(fetchMutation.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        articleId: article._id,
        ttsCacheKey: edgeMetadata.ttsCacheKey,
        attestation: expect.any(Object),
      }),
    );
    const saveCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) === "audio:saveSectionAudioRecord",
    );
    expect(saveCall?.[1]).toEqual(
      expect.objectContaining({
        articleId: article._id,
        sectionKey: summary.sectionKey,
        sourceHash: summary.sourceHash,
        storageId: "storage-1",
        provider: "edge",
        byteLength: 3,
        ledgerAssetKey: expect.any(String),
        ledgerSource: "interactive_article",
        attestation: expect.any(Object),
      }),
    );
  });

  it("persists generated audio when ledger identity creation fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
    fetchQuery.mockReset();
    fetchArticleByTitle.mockResolvedValue(article);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const audioRequest = request("edge");
    const { POST } = await import("./route");
    vi.spyOn(crypto, "randomUUID").mockImplementation(() => {
      if (
        (new Error().stack ?? "").includes("createAudioCacheLedgerAssetKey")
      ) {
        throw new Error("random source unavailable");
      }
      return "00000000-0000-4000-8000-000000000002";
    });

    const response = await POST(audioRequest);
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    const saveCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) === "audio:saveSectionAudioRecord",
    );
    expect(saveCall?.[1]).toEqual(
      expect.objectContaining({
        articleId: article._id,
        storageId: "storage-1",
        attestation: expect.any(Object),
      }),
    );
    expect(saveCall?.[1]).not.toHaveProperty("ledgerAssetKey");
    expect(saveCall?.[1]).not.toHaveProperty("ledgerSource");
    expect(
      fetchMutation.mock.calls.some(
        ([functionReference]) =>
          getFunctionName(functionReference) ===
          "audio:recordSectionAudioCacheWriteFailure",
      ),
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "[ai-cost-ledger] Audio cache identity was not created.",
    );
  });

  it("keeps cache persistence uninstrumented while the ledger is off", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "off");

    const { POST } = await import("./route");
    const createId = vi.fn(() => "00000000-0000-4000-8000-000000000003");
    expect(
      createAudioCacheLedgerAssetKey({ mode: "off", createId }),
    ).toBeUndefined();
    expect(createId).not.toHaveBeenCalled();
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    const saveCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) === "audio:saveSectionAudioRecord",
    );
    expect(saveCall?.[1]).toEqual(
      expect.objectContaining({
        articleId: article._id,
        storageId: "storage-1",
        attestation: expect.any(Object),
      }),
    );
    expect(saveCall?.[1]).not.toHaveProperty("ledgerAssetKey");
    expect(saveCall?.[1]).not.toHaveProperty("expectedExistingLedgerAssetKey");
    expect(saveCall?.[1]).not.toHaveProperty("ledgerSource");
  });

  it("uses OpenAI and an authenticated Convex cache lookup for a signed-in request", async () => {
    const getToken = vi.fn().mockResolvedValue("convex-jwt");
    auth.mockResolvedValue({ userId: "user-1", getToken });
    generateTtsAudioWithMetadata.mockResolvedValue({
      blob: new Blob([Uint8Array.of(4, 5, 6)], { type: "audio/mpeg" }),
      metadata: openAiMetadata,
    });

    const { POST } = await import("./route");
    const response = await POST(request("openai"));
    await Promise.all(pendingAfterTasks);

    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("openai");
    expect(getToken).toHaveBeenCalledWith({ template: "convex" });
    expect(fetchMutation.mock.calls[0][2]).toEqual({ token: "convex-jwt" });
    expect(generateTtsAudioWithMetadata).toHaveBeenCalledWith(
      { text: summary.text, provider: "openai" },
      expect.any(Object),
    );
  });

  it("resolves a native article identity to the canonical source hash", async () => {
    const { POST } = await import("./route");
    const response = await POST(nativeRequest());
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    expect(generateTtsAudioWithMetadata).toHaveBeenCalledWith(
      { text: summary.text, provider: "edge" },
      expect.any(Object),
    );
    const saveCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) === "audio:saveSectionAudioRecord",
    );
    expect(saveCall?.[1]).toEqual(
      expect.objectContaining({ sourceHash: summary.sourceHash }),
    );
  });

  it.each([
    { revisionId: "654321", narrationVersion: article.narrationVersion },
    { revisionId: article.revisionId, narrationVersion: 1 },
  ])(
    "rejects a stale native article identity before cache or generation (%o)",
    async ({ revisionId, narrationVersion }) => {
      const { POST } = await import("./route");
      const response = await POST(
        nativeRequest({ revisionId, narrationVersion }),
      );

      expect(response.status).toBe(409);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: "Article narration changed; refresh and try again.",
      });
      expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
      expect(fetchMutation).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      caseName: "mixed legacy and native identities",
      body: {
        slug: article.slug,
        sectionKey: summary.sectionKey,
        sourceHash: summary.sourceHash,
        revisionId: article.revisionId,
        narrationVersion: article.narrationVersion,
        provider: "edge",
      },
    },
    {
      caseName: "native identity missing revisionId",
      body: {
        slug: article.slug,
        sectionKey: summary.sectionKey,
        narrationVersion: article.narrationVersion,
        provider: "edge",
      },
    },
    {
      caseName: "native identity missing narrationVersion",
      body: {
        slug: article.slug,
        sectionKey: summary.sectionKey,
        revisionId: article.revisionId,
        provider: "edge",
      },
    },
    {
      caseName: "zero revisionId",
      body: {
        slug: article.slug,
        sectionKey: summary.sectionKey,
        revisionId: "0",
        narrationVersion: article.narrationVersion,
        provider: "edge",
      },
    },
    {
      caseName: "overlong canonical revisionId",
      body: {
        slug: article.slug,
        sectionKey: summary.sectionKey,
        revisionId: "9".repeat(21),
        narrationVersion: article.narrationVersion,
        provider: "edge",
      },
    },
    {
      caseName: "overlong raw revisionId",
      body: {
        slug: article.slug,
        sectionKey: summary.sectionKey,
        revisionId: `${" ".repeat(64)}1`,
        narrationVersion: article.narrationVersion,
        provider: "edge",
      },
    },
    {
      caseName: "non-numeric revisionId",
      body: {
        slug: article.slug,
        sectionKey: summary.sectionKey,
        revisionId: "revision-123",
        narrationVersion: article.narrationVersion,
        provider: "edge",
      },
    },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((narrationVersion) => ({
      caseName: `invalid narrationVersion ${narrationVersion}`,
      body: {
        slug: article.slug,
        sectionKey: summary.sectionKey,
        revisionId: article.revisionId,
        narrationVersion,
        provider: "edge",
      },
    })),
  ])("rejects $caseName before authentication or storage", async ({ body }) => {
    const { POST } = await import("./route");
    const response = await POST(rawArticleAudioRequest(body));

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(auth).not.toHaveBeenCalled();
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: "incoming leading-zero and whitespace form",
      storedRevisionId: article.revisionId,
      requestedRevisionId: `  000${article.revisionId}  `,
    },
    {
      caseName: "stored leading-zero and whitespace form",
      storedRevisionId: `  000${article.revisionId}  `,
      requestedRevisionId: article.revisionId,
    },
  ])(
    "normalizes the $caseName with the shared MediaWiki identity rules",
    async ({ storedRevisionId, requestedRevisionId }) => {
      fetchQuery.mockReset();
      fetchQuery.mockResolvedValueOnce({
        ...article,
        revisionId: storedRevisionId,
      });

      const { POST } = await import("./route");
      const response = await POST(
        nativeRequest({ revisionId: requestedRevisionId }),
      );
      await Promise.all(pendingAfterTasks);

      expect(response.status).toBe(200);
      expect(generateTtsAudioWithMetadata).toHaveBeenCalledWith(
        { text: summary.text, provider: "edge" },
        expect.any(Object),
      );
      const readCall = fetchMutation.mock.calls.find(
        ([functionReference]) =>
          getFunctionName(functionReference) ===
          "audio:getAllSectionAudioForServer",
      );
      expect(readCall?.[1]).toEqual(
        expect.objectContaining({
          sourceHashes: [
            {
              sectionKey: summary.sectionKey,
              sourceHash: summary.sourceHash,
            },
          ],
        }),
      );
      const saveCall = fetchMutation.mock.calls.find(
        ([functionReference]) =>
          getFunctionName(functionReference) === "audio:saveSectionAudioRecord",
      );
      expect(saveCall?.[1]).toEqual(
        expect.objectContaining({ sourceHash: summary.sourceHash }),
      );
    },
  );

  it("rejects an unknown native section before cache access or generation", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      rawArticleAudioRequest({
        slug: article.slug,
        revisionId: article.revisionId,
        narrationVersion: article.narrationVersion,
        sectionKey: "section-999",
        provider: "edge",
      }),
    );

    expect(response.status).toBe(409);
    expect(fetchQuery).toHaveBeenCalledOnce();
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: "revisionId",
      storedArticle: { ...article, revisionId: undefined },
    },
    {
      caseName: "narrationVersion",
      storedArticle: { ...article, narrationVersion: undefined },
    },
  ])(
    "rejects stored articles missing $caseName before cache access or generation",
    async ({ storedArticle }) => {
      fetchQuery.mockReset();
      fetchQuery.mockResolvedValueOnce(storedArticle);

      const { POST } = await import("./route");
      const response = await POST(nativeRequest());

      expect(response.status).toBe(409);
      expect(fetchQuery).toHaveBeenCalledOnce();
      expect(fetchMutation).not.toHaveBeenCalled();
      expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    "Basic abc.def.ghi",
    "Bearer",
    "Bearer abc.def.ghi extra",
    "Bearer abc.def.ghi,Bearer second.def.ghi",
  ])(
    "rejects a malformed Authorization header without consulting Clerk or article storage: %s",
    async (authorization) => {
      const { POST } = await import("./route");
      const response = await POST(nativeRequest({ authorization }));

      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: "Authentication is required.",
      });
      expect(auth).not.toHaveBeenCalled();
      expect(fetchQuery).not.toHaveBeenCalled();
      expect(fetchMutation).not.toHaveBeenCalled();
      expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
    },
  );

  it.each([
    { caseName: "invalid bearer", authResult: { userId: null } },
    {
      caseName: "pending session",
      authResult: { userId: null, sessionStatus: "pending" },
    },
    {
      caseName: "machine token",
      authResult: { userId: null, tokenType: "machine_token" },
    },
  ])(
    "rejects a middleware-signed-out $caseName before storage",
    async ({ authResult }) => {
      auth.mockResolvedValue(authResult);

      const { POST } = await import("./route");
      const response = await POST(
        nativeRequest({ authorization: "Bearer invalid.jwt.value" }),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: "Authentication is required.",
      });
      expect(auth).toHaveBeenCalledWith({ treatPendingAsSignedOut: true });
      expect(fetchQuery).not.toHaveBeenCalled();
      expect(fetchMutation).not.toHaveBeenCalled();
      expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
    },
  );

  it.each([
    "secret-key-invalid",
    "jwk-local-missing",
    "jwk-remote-failed-to-load",
    "jwk-remote-invalid",
    "jwk-remote-missing",
    "jwk-failed-to-resolve",
    "unexpected-error",
  ])(
    "maps signed-out middleware infrastructure reason %s to a generic 503",
    async (authReason) => {
      const debug = vi.fn(() => ({
        authReason,
        authMessage: "private.session.jwt",
      }));
      auth.mockResolvedValue({ userId: null, debug });

      const { POST } = await import("./route");
      const response = await POST(
        nativeRequest({ authorization: "Bearer invalid.jwt.value" }),
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      await expect(response.json()).resolves.toEqual({
        error: "Authentication is temporarily unavailable.",
      });
      expect(debug).toHaveBeenCalledOnce();
      expect(fetchQuery).not.toHaveBeenCalled();
      expect(fetchMutation).not.toHaveBeenCalled();
      expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
    },
  );

  it("tolerates middleware-shaped debug reasons for infrastructure failures", async () => {
    auth.mockResolvedValue({
      userId: null,
      debug: () => ({ reason: "jwk-remote-failed-to-load" }),
    });

    const { POST } = await import("./route");
    const response = await POST(
      nativeRequest({ authorization: "Bearer invalid.jwt.value" }),
    );

    expect(response.status).toBe(503);
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it.each([
    "token-expired",
    "token-invalid-signature",
    "jwk-kid-mismatch",
    "token-type-mismatch",
  ])("keeps signed-out invalid reason %s at 401", async (authReason) => {
    auth.mockResolvedValue({
      userId: null,
      debug: () => ({ authReason }),
    });

    const { POST } = await import("./route");
    const response = await POST(
      nativeRequest({ authorization: "Bearer invalid.jwt.value" }),
    );

    expect(response.status).toBe(401);
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
  });

  it.each([
    {
      caseName: "throwing debug function",
      debug: () => {
        throw new Error("private.session.jwt");
      },
    },
    {
      caseName: "malformed debug reason",
      debug: () => ({
        authReason: 503,
        reason: "jwk-remote-failed-to-load",
      }),
    },
    {
      caseName: "overlong debug reason",
      debug: () => ({ authReason: "x".repeat(129) }),
    },
  ])("fails closed at 401 for a $caseName", async ({ debug }) => {
    auth.mockResolvedValue({ userId: null, debug });

    const { POST } = await import("./route");
    const response = await POST(
      nativeRequest({ authorization: "Bearer invalid.jwt.value" }),
    );

    expect(response.status).toBe(401);
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
  });

  it("returns a generic 503 when middleware authentication is unavailable", async () => {
    auth.mockRejectedValue(new Error("sensitive middleware detail"));

    const { POST } = await import("./route");
    const response = await POST(
      nativeRequest({ authorization: "Bearer valid.looking.jwt" }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Authentication is temporarily unavailable.",
    });
    expect(auth).toHaveBeenCalledWith({ treatPendingAsSignedOut: true });
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
    expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
  });

  it.each(["__session", "__session_aB3_-xY9"])(
    "rejects a bearer combined with Clerk session cookie %s",
    async (cookieName) => {
      const { POST } = await import("./route");
      const response = await POST(
        nativeRequest({
          authorization: "Bearer private.session.jwt",
          cookie: `${cookieName}=different-session`,
        }),
      );

      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(auth).not.toHaveBeenCalled();
      expect(fetchQuery).not.toHaveBeenCalled();
      expect(fetchMutation).not.toHaveBeenCalled();
      expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
    },
  );

  it("uses middleware bearer identity for private TTS without forwarding cookies", async () => {
    auth.mockResolvedValue({ userId: "user-native" });
    generateTtsAudioWithMetadata.mockResolvedValue({
      blob: new Blob([Uint8Array.of(4, 5, 6)], { type: "audio/mpeg" }),
      metadata: openAiMetadata,
    });

    const { POST } = await import("./route");
    const response = await POST(
      nativeRequest({
        authorization: "Bearer private.session.jwt",
        cookie: "theme=garden",
        provider: "openai",
      }),
    );
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("openai");
    expect(auth).toHaveBeenCalledWith({ treatPendingAsSignedOut: true });
    expect(generateTtsAudioWithMetadata).toHaveBeenCalledWith(
      { text: summary.text, provider: "openai" },
      {
        apiBaseUrl: "https://trusted.example",
        headers: expect.objectContaining({
          authorization: "Bearer private.session.jwt",
        }),
      },
    );
    const forwardedHeaders = generateTtsAudioWithMetadata.mock.calls[0][1]
      .headers as Record<string, string>;
    expect(forwardedHeaders).not.toHaveProperty("cookie");
    expect(await response.text()).not.toContain("private.session.jwt");
  });

  it("rejects a supplied bearer in local mode before middleware or Wikipedia work", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
    fetchQuery.mockReset();

    const { POST } = await import("./route");
    const response = await POST(
      nativeRequest({ authorization: "Bearer local.session.jwt" }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(auth).not.toHaveBeenCalled();
    expect(fetchArticleByTitle).not.toHaveBeenCalled();
    expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
  });

  it("does not expose unexpected server error details", async () => {
    auth.mockResolvedValue({ userId: "user-native" });
    fetchQuery.mockReset();
    fetchQuery.mockRejectedValue(new Error("private.session.jwt"));
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { POST } = await import("./route");
    const response = await POST(
      nativeRequest({ authorization: "Bearer private.session.jwt" }),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: "Article audio generation failed.",
    });
    expect(errorLog).toHaveBeenCalledWith(
      "[/api/article/audio/section] request failed",
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "private.session.jwt",
    );
  });

  it("serves an exact cached variant without regenerating or rewriting it", async () => {
    fetchMutation.mockReset();
    fetchMutation.mockImplementation(async (functionReference) => {
      switch (getFunctionName(functionReference)) {
        case "audio:getAllSectionAudioForServer":
          return {
            urls: { summary: "https://storage.example/summary.mp3" },
            durations: { summary: 12 },
            metadata: { summary: edgeMetadata },
          };
        case "audio:recordSectionAudioCacheReadResult":
          return { created: true, disposition: "inserted" };
        default:
          throw new Error(
            `Unexpected mutation: ${getFunctionName(functionReference)}`,
          );
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe("https://storage.example/summary.mp3");
        return new Response(Uint8Array.of(9, 8, 7), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      9, 8, 7,
    ]);
    for (const [name, value] of Object.entries(
      buildTtsMetadataHeaders(edgeMetadata),
    )) {
      expect(response.headers.get(name)).toBe(value);
    }
    expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
    expect(fetchMutation).toHaveBeenCalledTimes(2);
    expect(fetchMutation.mock.calls[0][1]).toHaveProperty("attestation");
    expect(after).toHaveBeenCalledOnce();
    const cacheResultCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) ===
        "audio:recordSectionAudioCacheReadResult",
    );
    expect(cacheResultCall?.[1]).toEqual({
      source: "interactive_article",
      provider: "edge",
      hit: true,
      byteLength: 3,
      durationSeconds: 12,
      attestation: expect.any(Object),
    });
  });

  it("estimates reused seconds when a legacy cache entry has no duration", async () => {
    fetchMutation.mockReset();
    fetchMutation.mockImplementation(async (functionReference) => {
      switch (getFunctionName(functionReference)) {
        case "audio:getAllSectionAudioForServer":
          return {
            urls: { summary: "https://storage.example/legacy-summary.mp3" },
            durations: {},
            metadata: { summary: edgeMetadata },
          };
        case "audio:recordSectionAudioCacheReadResult":
          return { created: true, disposition: "inserted" };
        default:
          throw new Error(
            `Unexpected mutation: ${getFunctionName(functionReference)}`,
          );
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(Uint8Array.of(9, 8, 7), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        });
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    const cacheResultCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) ===
        "audio:recordSectionAudioCacheReadResult",
    );
    expect(cacheResultCall?.[1]).toEqual({
      source: "interactive_article",
      provider: "edge",
      hit: true,
      byteLength: 3,
      durationSeconds: 3,
      attestation: expect.any(Object),
    });
  });

  it("records a miss instead of avoided generation when cached bytes are unusable", async () => {
    fetchMutation.mockReset();
    fetchMutation.mockImplementation(async (functionReference) => {
      switch (getFunctionName(functionReference)) {
        case "audio:getAllSectionAudioForServer":
          return {
            urls: { summary: "https://storage.example/broken.mp3" },
            durations: { summary: 12 },
            metadata: { summary: edgeMetadata },
            ledgerAssetKeys: { summary: brokenLedgerAssetKey },
          };
        case "audio:recordSectionAudioCacheReadResult":
          return { created: true, disposition: "inserted" };
        case "audio:generateUploadUrl":
          return "https://upload.example/audio";
        case "audio:saveSectionAudioRecord":
          return "audio-record-1";
        default:
          throw new Error(
            `Unexpected mutation: ${getFunctionName(functionReference)}`,
          );
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input) === "https://storage.example/broken.mp3") {
          return new Response("unavailable", { status: 503 });
        }
        if (String(input) === "https://upload.example/audio") {
          return Response.json({ storageId: "storage-1" });
        }
        throw new Error(`Unexpected fetch: ${String(input)}`);
      }),
    );

    const { POST } = await import("./route");
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    expect(generateTtsAudioWithMetadata).toHaveBeenCalledOnce();
    const cacheResultCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) ===
        "audio:recordSectionAudioCacheReadResult",
    );
    expect(cacheResultCall?.[1]).toEqual({
      source: "interactive_article",
      provider: "edge",
      hit: false,
      byteLength: 0,
      durationSeconds: 0,
      attestation: expect.any(Object),
    });
    const saveCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) === "audio:saveSectionAudioRecord",
    );
    expect(saveCall?.[1]).toEqual(
      expect.objectContaining({
        expectedExistingLedgerAssetKey: brokenLedgerAssetKey,
        ledgerAssetKey: expect.any(String),
      }),
    );
  });

  it("rejects stale client narration before generation or cache writes", async () => {
    const { POST } = await import("./route");
    const response = await POST(request("edge", "stale-source"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Article narration changed; refresh and try again.",
    });
    expect(generateTtsAudioWithMetadata).not.toHaveBeenCalled();
    expect(fetchMutation).not.toHaveBeenCalled();
  });

  it("keeps successful playback independent from best-effort cache failure", async () => {
    fetchMutation.mockReset();
    fetchMutation.mockRejectedValue(new Error("Convex unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("./route");
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    expect(await response.blob()).toHaveProperty("size", 3);
    expect(warn).toHaveBeenCalledWith(
      "[article-audio-cache] Failed to persist canonical section audio:",
      expect.any(Error),
    );
  });

  it("records a paid-generation cache upload failure without changing playback", async () => {
    fetchMutation.mockReset();
    fetchMutation.mockImplementation(async (functionReference) => {
      switch (getFunctionName(functionReference)) {
        case "audio:getAllSectionAudioForServer":
          return { urls: {}, durations: {}, metadata: {} };
        case "audio:recordSectionAudioCacheReadResult":
        case "audio:recordSectionAudioCacheWriteFailure":
          return { created: true, disposition: "inserted" };
        case "audio:generateUploadUrl":
          return "https://upload.example/audio";
        default:
          throw new Error(
            `Unexpected mutation: ${getFunctionName(functionReference)}`,
          );
      }
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const { POST } = await import("./route");
    const response = await POST(request("edge"));
    await Promise.all(pendingAfterTasks);

    expect(response.status).toBe(200);
    expect(await response.blob()).toHaveProperty("size", 3);
    const failureCall = fetchMutation.mock.calls.find(
      ([functionReference]) =>
        getFunctionName(functionReference) ===
        "audio:recordSectionAudioCacheWriteFailure",
    );
    expect(failureCall?.[1]).toEqual({
      ledgerAssetKey: expect.any(String),
      source: "interactive_article",
      provider: "edge",
      attestation: expect.any(Object),
    });
  });

  it("keeps local Edge playback independent from Convex", async () => {
    vi.stubEnv("NEXT_PUBLIC_LOCAL_MODE", "true");
    fetchQuery.mockReset();

    const { POST } = await import("./route");
    const response = await POST(request("openai"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(fetchArticleByTitle).toHaveBeenCalledWith("The Silmarillion");
    expect(fetchQuery).not.toHaveBeenCalled();
    expect(auth).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
});
