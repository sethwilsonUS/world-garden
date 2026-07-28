import { beforeEach, describe, expect, it, vi } from "vitest";

const { permanentRedirect } = vi.hoisted(() => ({
  permanentRedirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ permanentRedirect }));

import DidYouKnowPage from "./did-you-know/page";
import PodcastPage from "./podcast/page";

describe("legacy public routes", () => {
  beforeEach(() => {
    permanentRedirect.mockClear();
  });

  it("permanently redirects the old singular podcast URL", () => {
    PodcastPage();

    expect(permanentRedirect).toHaveBeenCalledWith("/podcasts");
  });

  it("permanently redirects Did You Know to its current homepage section", () => {
    DidYouKnowPage();

    expect(permanentRedirect).toHaveBeenCalledWith("/#today-dyk-heading");
  });
});
