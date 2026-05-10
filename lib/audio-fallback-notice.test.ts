import { describe, expect, it } from "vitest";
import {
  HIGH_DEMAND_FALLBACK_NOTICE,
  getQuotaFallbackNoticeForPlayback,
} from "./audio-fallback-notice";

describe("getQuotaFallbackNoticeForPlayback", () => {
  it("returns the high-demand notice for the first quota fallback playback on an article", () => {
    expect(
      getQuotaFallbackNoticeForPlayback({
        articleKey: "Grace_Hopper",
        announcedArticleKey: null,
        fallbackReason: "openai_quota",
      }),
    ).toEqual({
      articleKey: "Grace_Hopper",
      message: HIGH_DEMAND_FALLBACK_NOTICE,
    });
  });

  it("does not repeat the notice for the same article", () => {
    expect(
      getQuotaFallbackNoticeForPlayback({
        articleKey: "Grace_Hopper",
        announcedArticleKey: "Grace_Hopper",
        fallbackReason: "openai_quota",
      }),
    ).toBeNull();
  });

  it("does not show the high-demand notice for non-quota fallback audio", () => {
    expect(
      getQuotaFallbackNoticeForPlayback({
        articleKey: "Grace_Hopper",
        announcedArticleKey: null,
        fallbackReason: "openai_error",
      }),
    ).toBeNull();
  });
});
