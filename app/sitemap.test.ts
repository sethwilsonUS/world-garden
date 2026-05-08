import { describe, expect, it } from "vitest";
import sitemap from "./sitemap";

describe("sitemap", () => {
  it("does not include the removed Did You Know page", () => {
    const urls = sitemap().map((entry) => entry.url);

    expect(urls).toContain("http://localhost:3000/trending");
    expect(urls).not.toContain("http://localhost:3000/did-you-know");
  });
});
