import { afterEach, describe, expect, it } from "vitest";
import {
  getTtsQuotaBypassHeaders,
  TTS_QUOTA_BYPASS_HEADER,
} from "./tts-quota-bypass";

describe("getTtsQuotaBypassHeaders", () => {
  afterEach(() => {
    delete process.env.TTS_QUOTA_BYPASS_SECRET;
  });

  it("returns no headers when no trusted secret is configured", () => {
    expect(getTtsQuotaBypassHeaders()).toBeUndefined();
  });

  it("returns the trusted bypass header when configured", () => {
    process.env.TTS_QUOTA_BYPASS_SECRET = "internal-secret";

    expect(getTtsQuotaBypassHeaders()).toEqual({
      [TTS_QUOTA_BYPASS_HEADER]: "internal-secret",
    });
  });
});
