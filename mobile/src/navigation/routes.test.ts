import {
  mapCanonicalPathToNativeHref,
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
    "https://example.com/article/Taylor_Swift",
    "http://curiogarden.org/article/Taylor_Swift",
    "https://www.curiogarden.org/article/Taylor_Swift",
    "curiogarden://evil.example/article/Taylor_Swift",
    "/article/AC/DC",
    "/account",
    "%",
  ])("falls back safely for an untrusted or unsupported link: %s", (path) => {
    expect(redirectIncomingSystemPath(path)).toBe("/");
  });
});
