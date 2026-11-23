import { beforeEach, describe, expect, it, vi } from "vitest";

const { notFoundMock, permanentRedirectMock, getInitialMock } = vi.hoisted(
  () => ({
    notFoundMock: vi.fn(() => {
      throw new Error("NEXT_NOT_FOUND");
    }),
    permanentRedirectMock: vi.fn((url: string) => {
      throw new Error(`NEXT_PERMANENT_REDIRECT:${url}`);
    }),
    getInitialMock: vi.fn(async () => null),
  }),
);

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  permanentRedirect: permanentRedirectMock,
}));
vi.mock("@/lib/on-this-day-page-data", () => ({
  getInitialOnThisDayPageResponse: getInitialMock,
}));

import OnThisDayCalendarPage, {
  generateMetadata,
  generateStaticParams,
} from "./page";

describe("/on-this-day/[day] route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses on-demand ISR by returning an empty generateStaticParams array", async () => {
    await expect(generateStaticParams()).resolves.toEqual([]);
  });

  it("generates day-specific metadata with self-referencing canonical URL", async () => {
    const meta = await generateMetadata({
      params: Promise.resolve({ day: "march-5" }),
    });
    expect(meta.title).toBe("On This Day: March 5 — Curio Garden");
    expect(meta.description).toContain("March 5");
    expect(meta.alternates?.canonical).toBe("/on-this-day/march-5");
  });

  it("permanently redirects non-canonical slugs like 03-05 while preserving category and order", async () => {
    await expect(
      OnThisDayCalendarPage({ params: Promise.resolve({ day: "03-05" }) }),
    ).rejects.toThrow("NEXT_PERMANENT_REDIRECT:/on-this-day/march-5");
    expect(permanentRedirectMock).toHaveBeenCalledWith("/on-this-day/march-5");

    await expect(
      OnThisDayCalendarPage({
        params: Promise.resolve({ day: "03-05" }),
        searchParams: Promise.resolve({
          category: "births",
          order: "oldest",
        }),
      }),
    ).rejects.toThrow(
      "NEXT_PERMANENT_REDIRECT:/on-this-day/march-5?category=births&order=oldest",
    );
    expect(permanentRedirectMock).toHaveBeenCalledWith(
      "/on-this-day/march-5?category=births&order=oldest",
    );
  });

  it("returns 404 via notFound() for invalid calendar slugs", async () => {
    await expect(
      OnThisDayCalendarPage({
        params: Promise.resolve({ day: "february-30" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalledTimes(1);
  });
});
