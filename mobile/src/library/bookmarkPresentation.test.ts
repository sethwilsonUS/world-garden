import {
  bookmarkEntriesRevision,
  SAFE_LIBRARY_UPDATE_ERROR,
} from "./bookmarkPresentation";

describe("bookmark presentation", () => {
  it("serializes the ordered visible bookmark fields into one revision", () => {
    expect(
      bookmarkEntriesRevision([
        { savedAt: 20, slug: "mars", title: "Mars" },
        { savedAt: 10, slug: "venus", title: "Venus" },
      ]),
    ).toBe('[["mars","Mars",20],["venus","Venus",10]]');
  });

  it("owns one sanitized update message for every native Library surface", () => {
    expect(SAFE_LIBRARY_UPDATE_ERROR).toBe(
      "We couldn’t update your Library. Please try again.",
    );
  });
});
