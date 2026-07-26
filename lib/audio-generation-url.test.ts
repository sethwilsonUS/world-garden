import { afterEach, describe, expect, it } from "vitest";
import {
  getAudioGenerationBaseUrl,
  getRequestAudioGenerationBaseUrl,
} from "./audio-generation-url";

const originalBaseUrl = process.env.AUDIO_GENERATION_BASE_URL;
const originalVercelUrl = process.env.VERCEL_URL;

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
    process.env.VERCEL_URL = "world-garden-git-edge-voice.vercel.app";

    expect(getAudioGenerationBaseUrl()).toBe(
      "https://world-garden-git-edge-voice.vercel.app",
    );
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
