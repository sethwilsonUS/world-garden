import { describe, expect, it } from "vitest";
import sitemap from "./sitemap";

describe("sitemap", () => {
  it("does not include the removed Did You Know page", () => {
    const paths = sitemap().map((entry) => new URL(entry.url).pathname);

    expect(paths).toContain("/trending");
    expect(paths).toContain("/podcasts");
    expect(paths).toContain("/about");
    expect(paths).not.toContain("/did-you-know");
  });
});
