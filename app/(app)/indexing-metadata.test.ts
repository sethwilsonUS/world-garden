import { describe, expect, it } from "vitest";
import { metadata as aboutMetadata } from "./about/page";
import { metadata as accountMetadata } from "./account/page";
import { metadata as dashboardMetadata } from "./dashboard/page";
import { metadata as feedbackMetadata } from "./feedback/page";
import { metadata as homeMetadata } from "./page";
import { metadata as libraryMetadata } from "./library/layout";
import { metadata as podcastsMetadata } from "./podcasts/page";
import { generateMetadata as generatePodcastMetadata } from "./podcasts/[slug]/page";
import { metadata as privacyMetadata } from "./privacy/page";
import { metadata as searchMetadata } from "./search/page";
import { metadata as signInMetadata } from "./sign-in/[[...sign-in]]/page";
import { metadata as termsMetadata } from "./terms/page";
import { metadata as trendingMetadata } from "./trending/layout";

describe("public indexing metadata", () => {
  it.each([
    ["home", homeMetadata, "/"],
    ["about", aboutMetadata, "/about"],
    ["feedback", feedbackMetadata, "/feedback"],
    ["podcasts", podcastsMetadata, "/podcasts"],
    ["privacy", privacyMetadata, "/privacy"],
    ["terms", termsMetadata, "/terms"],
    ["trending", trendingMetadata, "/trending"],
  ])("gives %s a self-referencing canonical", (_name, metadata, canonical) => {
    expect(metadata.alternates?.canonical).toBe(canonical);
    expect(metadata.robots).not.toMatchObject({ index: false });
  });

  it.each([
    ["account", accountMetadata, "/account"],
    ["dashboard", dashboardMetadata, "/dashboard"],
    ["library", libraryMetadata, "/library"],
    ["search", searchMetadata, "/search"],
    ["sign-in", signInMetadata, "/sign-in"],
  ])("keeps the %s utility route out of search", (_name, metadata, canonical) => {
    expect(metadata.alternates?.canonical).toBe(canonical);
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it.each([
    ["featured", "/podcasts/featured"],
    ["trending", "/podcasts/trending"],
  ])("gives the %s podcast archive unique indexable metadata", async (slug, canonical) => {
    const metadata = await generatePodcastMetadata({
      params: Promise.resolve({ slug }),
    });

    expect(metadata.alternates?.canonical).toBe(canonical);
    expect(metadata.title).toEqual(expect.stringContaining("Curio Garden"));
    expect(metadata.description).toEqual(expect.any(String));
    expect(metadata.robots).not.toMatchObject({ index: false });
  });

  it("marks unknown podcast archives as not indexable", async () => {
    const metadata = await generatePodcastMetadata({
      params: Promise.resolve({ slug: "second-breakfast" }),
    });

    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});
