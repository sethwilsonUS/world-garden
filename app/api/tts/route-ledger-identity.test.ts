import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => vi.fn());
const track = vi.hoisted(() => vi.fn(async () => undefined));
const after = vi.hoisted(() => vi.fn((task: () => void) => task()));
const recordProviderAttempt = vi.hoisted(() => vi.fn());
const randomUUID = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("system UUID source unavailable");
  }),
);

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return {
    ...actual,
    randomUUID,
  };
});

vi.mock("@clerk/nextjs/server", () => ({ auth }));
vi.mock("@vercel/analytics/server", () => ({ track }));
vi.mock("@/lib/ai-cost-provider-recorder", () => ({
  recordProviderAttemptFailOpen: recordProviderAttempt,
}));
vi.mock("next/server", async () => {
  const actual =
    await vi.importActual<typeof import("next/server")>("next/server");
  return { ...actual, after };
});

describe("POST /api/tts ledger identity failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.stubEnv("AI_COST_LEDGER_MODE", "observe");
    auth.mockResolvedValue({ userId: null });
  });

  it("still returns Edge audio when UUID instrumentation is unavailable", async () => {
    const providerFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(new Uint8Array([0xff, 0xfb, 0x89]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          provider: "edge",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Curio-TTS-Provider")).toBe("edge");
    expect(await response.arrayBuffer()).toHaveProperty("byteLength", 3);
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(randomUUID).toHaveBeenCalledOnce();
    expect(recordProviderAttempt).not.toHaveBeenCalled();
  });

  it("does not request ledger identity while observation mode is off", async () => {
    vi.stubEnv("AI_COST_LEDGER_MODE", "off");
    const providerFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(new Uint8Array([0xff, 0xfb, 0x90]), {
          status: 200,
          headers: { "Content-Type": "audio/mpeg" },
        }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const { POST } = await import("./route");
    const response = await POST(
      new NextRequest("https://curiogarden.org/api/tts", {
        method: "POST",
        body: JSON.stringify({
          text: "This article section text is comfortably long enough.",
          provider: "edge",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(randomUUID).not.toHaveBeenCalled();
    expect(recordProviderAttempt).not.toHaveBeenCalled();
  });
});
