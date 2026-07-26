import { afterEach, describe, expect, it } from "vitest";
import {
  getAudioGenerationBaseUrl,
  getRequestAudioGenerationBaseUrl,
  isTrustedAudioGenerationBaseUrl,
} from "./audio-generation-url";

const originalBaseUrl = process.env.AUDIO_GENERATION_BASE_URL;
const originalVercelUrl = process.env.VERCEL_URL;
const originalVercelEnv = process.env.VERCEL_ENV;

afterEach(() => {
  if (originalBaseUrl == null) {
    delete process.env.AUDIO_GENERATION_BASE_URL;
  } else {
    process.env.AUDIO_GENERATION_BASE_URL = originalBaseUrl;
  }
  if (originalVercelUrl == null) {
    delete process.env.VERCEL_URL;
  } else {
    process.env.VERCEL_URL = originalVercelUrl;
  }
  if (originalVercelEnv == null) {
    delete process.env.VERCEL_ENV;
  } else {
    process.env.VERCEL_ENV = originalVercelEnv;
  }
});

describe("getAudioGenerationBaseUrl", () => {
  it("uses the canonical Curio Garden origin by default", () => {
    delete process.env.AUDIO_GENERATION_BASE_URL;
    delete process.env.VERCEL_URL;
    expect(getAudioGenerationBaseUrl()).toBe("https://curiogarden.org");
  });

  it("accepts an explicitly configured trusted HTTPS origin", () => {
    process.env.AUDIO_GENERATION_BASE_URL =
      "https://world-garden-preview.vercel.app/some/path";
    expect(getAudioGenerationBaseUrl()).toBe(
      "https://world-garden-preview.vercel.app",
    );
  });

  it("rejects unsafe schemes instead of using a client-controlled target", () => {
    process.env.AUDIO_GENERATION_BASE_URL = "http://attacker.example";
    delete process.env.VERCEL_URL;
    expect(getAudioGenerationBaseUrl()).toBe("https://curiogarden.org");
  });

  it("uses a validated Vercel deployment hostname for previews", () => {
    delete process.env.AUDIO_GENERATION_BASE_URL;
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "world-garden-git-edge-voice.vercel.app";

    expect(getAudioGenerationBaseUrl()).toBe(
      "https://world-garden-git-edge-voice.vercel.app",
    );
  });

  it("keeps Preview self-calls on the exact deployment even when a canonical origin is configured", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "world-garden-git-edge-voice.vercel.app";
    process.env.AUDIO_GENERATION_BASE_URL = "https://curiogarden.org";

    expect(
      getAudioGenerationBaseUrl(),
    ).toBe("https://world-garden-git-edge-voice.vercel.app");
    expect(
      getRequestAudioGenerationBaseUrl(
        "https://attacker.example/api/article/audio",
      ),
    ).toBe("https://world-garden-git-edge-voice.vercel.app");
  });

  it("fails closed when a Preview deployment origin is unavailable", () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_URL = "attacker.example";
    process.env.AUDIO_GENERATION_BASE_URL = "https://curiogarden.org";

    expect(() =>
      getAudioGenerationBaseUrl(),
    ).toThrow("validated Vercel Preview audio origin");
    expect(() =>
      getRequestAudioGenerationBaseUrl(
        "https://attacker.example/api/article/audio",
      ),
    ).toThrow("validated Vercel Preview audio origin");
  });

  it("only trusts the exact configured generation origin", () => {
    process.env.AUDIO_GENERATION_BASE_URL =
      "https://world-garden-preview.vercel.app";

    expect(
      isTrustedAudioGenerationBaseUrl(
        "https://world-garden-preview.vercel.app/api/tts",
      ),
    ).toBe(true);
    expect(
      isTrustedAudioGenerationBaseUrl("https://curiogarden.org"),
    ).toBe(false);
    expect(
      isTrustedAudioGenerationBaseUrl("https://attacker.example"),
    ).toBe(false);
  });

  it("rejects a non-Vercel deployment hostname", () => {
    delete process.env.AUDIO_GENERATION_BASE_URL;
    process.env.VERCEL_URL = "attacker.example";

    expect(getAudioGenerationBaseUrl()).toBe("https://curiogarden.org");
  });

  it("allows only loopback HTTP origins for local route self-calls", () => {
    delete process.env.AUDIO_GENERATION_BASE_URL;
    delete process.env.VERCEL_URL;

    expect(
      getRequestAudioGenerationBaseUrl(
        "http://localhost:3000/api/article/audio",
      ),
    ).toBe("http://localhost:3000");
    expect(
      getRequestAudioGenerationBaseUrl(
        "http://attacker.example/api/article/audio",
      ),
    ).toBe("https://curiogarden.org");
  });
});
