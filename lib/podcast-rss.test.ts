import { describe, expect, it } from "vitest";
import {
  escapeXml,
  formatPodcastDuration,
  xmlTag,
} from "./podcast-rss";

describe("escapeXml", () => {
  it("escapes xml entities", () => {
    expect(escapeXml(`A&B <C> "D" 'E'`)).toBe(
      "A&amp;B &lt;C&gt; &quot;D&quot; &apos;E&apos;",
    );
  });
});

describe("formatPodcastDuration", () => {
  it("formats durations as hh:mm:ss", () => {
    expect(formatPodcastDuration(86)).toBe("00:01:26");
    expect(formatPodcastDuration(1343)).toBe("00:22:23");
  });

  it("returns null for missing or invalid values", () => {
    expect(formatPodcastDuration(undefined)).toBeNull();
    expect(formatPodcastDuration(-1)).toBeNull();
  });
});

describe("xmlTag", () => {
  it("omits empty values and escapes present ones", () => {
    expect(xmlTag("itunes:summary", "")).toBe("");
    expect(xmlTag("title", "A&B")).toBe("<title>A&amp;B</title>");
  });
});
