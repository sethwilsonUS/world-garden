import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWikiSummary } from "@/lib/wiki-summary";
import { generateMetadata } from "./page";

vi.mock("@/lib/wiki-summary", () => ({
  fetchWikiSummary: vi.fn(),
  slugToTitle: (slug: string) => decodeURIComponent(slug).replace(/_/gu, " "),
}));

const mockedFetchWikiSummary = vi.mocked(fetchWikiSummary);

describe("article metadata", () => {
  beforeEach(() => {
    mockedFetchWikiSummary.mockReset();
  });

  it("uses Wikipedia's resolved title for the canonical article URL", async () => {
    mockedFetchWikiSummary.mockResolvedValue({
      title: "The Lord of the Rings",
      extract: "A very short walk involving rather a lot of walking.",
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "lord_of_the_rings" }),
    });

    expect(metadata.alternates?.canonical).toBe(
      "/article/The_Lord_of_the_Rings",
    );
    expect(metadata.openGraph?.url).toBe("/article/The_Lord_of_the_Rings");
  });

  it("encodes canonical titles as one safe route segment", async () => {
    mockedFetchWikiSummary.mockResolvedValue({
      title: "AC/DC",
      extract: "Australian rock band.",
    });

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "AC%2FDC" }),
    });

    expect(metadata.alternates?.canonical).toBe("/article/AC%2FDC");
  });

  it("parses an encoded canonical path when Wikipedia summary metadata is unavailable", async () => {
    mockedFetchWikiSummary.mockResolvedValue(null);

    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: "S%C3%A3o_Paulo" }),
    });

    expect(metadata.title).toBe("São Paulo — Curio Garden");
    expect(metadata.alternates?.canonical).toBe("/article/S%C3%A3o_Paulo");
    expect(metadata.openGraph?.url).toBe("/article/S%C3%A3o_Paulo");
  });
});
