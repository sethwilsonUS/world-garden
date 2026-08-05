import {
  mapCanonicalPathToNativeHref,
  normalizeNativeArticleSource,
  normalizeNativeArticleSlug,
  redirectIncomingSystemPath,
} from "./routes";

describe("native canonical route mapping", () => {
  it("maps a canonical article path to a typed Expo Router href", () => {
    expect(mapCanonicalPathToNativeHref("/article/Ada_Lovelace")).toEqual({
      pathname: "/article/[slug]",
      params: { slug: "Ada_Lovelace" },
    });
  });

  it("preserves an encoded slash as one decoded route parameter", () => {
    expect(mapCanonicalPathToNativeHref("/article/AC%2FDC")).toEqual({
      pathname: "/article/[slug]",
      params: { slug: "AC/DC" },
    });
  });

  it("normalizes only the first usable Expo Router article parameter", () => {
    expect(normalizeNativeArticleSlug(["  AC/DC  ", "ignored"])).toBe("AC/DC");
    expect(normalizeNativeArticleSlug("  Ada_Lovelace ")).toBe("Ada_Lovelace");
  });

  it.each([undefined, [], "", "   ", ["   "]])(
    "rejects a missing article route parameter: %j",
    (slug) => {
      expect(normalizeNativeArticleSlug(slug)).toBeNull();
    },
  );

  it.each([".", "..", "unsafe\u0000title", "x".repeat(513)])(
    "rejects an unsafe article route parameter: %j",
    (slug) => {
      expect(normalizeNativeArticleSlug(slug)).toBeNull();
    },
  );

  it("normalizes a decomposed Unicode article route parameter", () => {
    expect(normalizeNativeArticleSlug("  Lothlo\u0301rien  ")).toBe(
      "Lothlórien",
    );
  });

  it("accepts only an explicit Library article source marker", () => {
    expect(normalizeNativeArticleSource("library")).toBe("library");
    expect(normalizeNativeArticleSource(["library", "search"])).toBe("library");
  });

  it.each([undefined, "", "search", "library/../account", ["search"]])(
    "rejects an untrusted source marker: %j",
    (source) => {
      expect(normalizeNativeArticleSource(source)).toBeNull();
    },
  );

  it.each([
    "curiogarden://article/Taylor_Swift",
    "curiogarden-dev://article/Taylor_Swift",
    "curiogarden-preview://article/Taylor_Swift",
    "curiogarden-e2e://article/Taylor_Swift",
    "https://curiogarden.org/article/Taylor_Swift",
    "/article/Taylor_Swift",
  ])("normalizes a trusted incoming link: %s", (path) => {
    expect(redirectIncomingSystemPath(path)).toBe("/article/Taylor_Swift");
  });

  it.each([
    "org.curiogarden.app://callback?code=private&state=private",
    "org.curiogarden.app.dev://callback?code=private&state=private",
    "org.curiogarden.app.preview://callback?code=private&state=private",
    "org.curiogarden.app.e2e://callback?code=private&state=private",
    "clerk://org.curiogarden.app.hosted-callback?code=private&state=private",
    "clerk://org.curiogarden.app.dev.hosted-callback?code=private&state=private",
    "clerk://org.curiogarden.app.preview.hosted-callback?code=private&state=private",
    "clerk://org.curiogarden.app.e2e.hosted-callback?code=private&state=private",
  ])(
    "leaves an exact Clerk hosted callback with the active route: %s",
    (path) => {
      expect(redirectIncomingSystemPath(path)).toBeNull();
    },
  );

  it.each([
    "https://example.com/article/Taylor_Swift",
    "http://curiogarden.org/article/Taylor_Swift",
    "https://www.curiogarden.org/article/Taylor_Swift",
    "curiogarden://evil.example/article/Taylor_Swift",
    "clerk://org.curiogarden.app.e2e.hosted-callback.evil?code=private",
    "clerk://org.curiogarden.app.e2e.hosted-callback/another/path?code=private",
    "clerk://org.curiogarden.app.e2e.hosted-callback#private",
    "/article/AC/DC",
    "/account",
    "%",
  ])("falls back safely for an untrusted or unsupported link: %s", (path) => {
    expect(redirectIncomingSystemPath(path)).toBe("/");
  });
});
