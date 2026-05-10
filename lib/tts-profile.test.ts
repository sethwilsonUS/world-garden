import { describe, expect, it } from "vitest";
import { isEdgeTtsVoice } from "./tts-profile";

describe("isEdgeTtsVoice", () => {
  it("accepts standard Edge neural voice IDs", () => {
    expect(isEdgeTtsVoice("en-US-AriaNeural")).toBe(true);
    expect(isEdgeTtsVoice("de-DE-ConradNeural")).toBe(true);
  });

  it("accepts Azure Dragon HD Edge-compatible voice IDs", () => {
    expect(isEdgeTtsVoice("en-US-Brian:DragonHDLatestNeural")).toBe(true);
    expect(isEdgeTtsVoice("de-DE-Conrad:DragonHDOmniLatestNeural")).toBe(true);
  });

  it("rejects malformed Edge voice IDs", () => {
    expect(isEdgeTtsVoice("marin")).toBe(false);
    expect(isEdgeTtsVoice("en-US-Brian:UnknownLatestNeural")).toBe(false);
  });
});
