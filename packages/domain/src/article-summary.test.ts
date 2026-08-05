import { describe, expect, it } from "vitest";

import { splitArticleSummary } from "./index";

describe("article summary disclosure", () => {
  it("separates one complete lead sentence from the remaining summary", () => {
    expect(
      splitArticleSummary(
        "Pumpkins are a cultivated winter squash. Their history spans thousands of years.",
      ),
    ).toEqual({
      lead: "Pumpkins are a cultivated winter squash.",
      remainder: "Their history spans thousands of years.",
    });
  });

  it("recognizes question and exclamation marks as sentence endings", () => {
    expect(
      splitArticleSummary("Why pumpkins? Because they are splendid!"),
    ).toEqual({
      lead: "Why pumpkins?",
      remainder: "Because they are splendid!",
    });
  });

  it("does not split at a question mark embedded in an unquoted title", () => {
    expect(
      splitArticleSummary(
        "Is It Wrong to Try to Pick Up Girls in a Dungeon? is a Japanese light novel series. It began publication in 2013.",
      ),
    ).toEqual({
      lead: "Is It Wrong to Try to Pick Up Girls in a Dungeon? is a Japanese light novel series.",
      remainder: "It began publication in 2013.",
    });
  });

  it("keeps closing quotation marks and brackets with the lead sentence", () => {
    expect(
      splitArticleSummary(
        "The guide called it “the great pumpkin.”) Then everyone cheered.",
      ),
    ).toEqual({
      lead: "The guide called it “the great pumpkin.”)",
      remainder: "Then everyone cheered.",
    });
  });

  it("keeps spaced personal initials with the name they introduce", () => {
    expect(
      splitArticleSummary(
        "J. R. R. Tolkien was an English writer. He wrote fantasy novels.",
      ),
    ).toEqual({
      lead: "J. R. R. Tolkien was an English writer.",
      remainder: "He wrote fantasy novels.",
    });
    expect(
      splitArticleSummary(
        "Harry S. Truman was the 33rd U.S. president. He took office in 1945.",
      ),
    ).toEqual({
      lead: "Harry S. Truman was the 33rd U.S. president.",
      remainder: "He took office in 1945.",
    });
  });

  it.each([
    [
      "Dr. Rivera studies pumpkins. The work began in autumn.",
      "Dr. Rivera studies pumpkins.",
      "The work began in autumn.",
    ],
    [
      "Prof. Rivera studies pumpkins. The work began in autumn.",
      "Prof. Rivera studies pumpkins.",
      "The work began in autumn.",
    ],
    [
      "Gourds, e.g. pumpkins, are fruit. They grow on vines.",
      "Gourds, e.g. pumpkins, are fruit.",
      "They grow on vines.",
    ],
    [
      "A pepo is a berry, i.e. a fruit with a hard rind. Pumpkins are pepos.",
      "A pepo is a berry, i.e. a fruit with a hard rind.",
      "Pumpkins are pepos.",
    ],
  ])(
    "does not mistake a reviewed abbreviation for a sentence: %s",
    (summary, lead, remainder) => {
      expect(splitArticleSummary(summary)).toEqual({ lead, remainder });
    },
  );

  it("distinguishes a sentence-final street suffix from Saint in a name", () => {
    expect(
      splitArticleSummary(
        "The parade continued along Main St. It ended near the river.",
      ),
    ).toEqual({
      lead: "The parade continued along Main St.",
      remainder: "It ended near the river.",
    });
    expect(
      splitArticleSummary(
        "St. Louis hosts a pumpkin festival. It opens in October.",
      ),
    ).toEqual({
      lead: "St. Louis hosts a pumpkin festival.",
      remainder: "It opens in October.",
    });
  });

  it.each([
    [
      "Martin Luther King Jr. was an American minister. He led a civil rights movement.",
      "Martin Luther King Jr. was an American minister.",
      "He led a civil rights movement.",
    ],
    [
      "Martin Luther King Sr. was an American preacher. He was born in Georgia.",
      "Martin Luther King Sr. was an American preacher.",
      "He was born in Georgia.",
    ],
  ])(
    "keeps a generational suffix with the name it follows: %s",
    (summary, lead, remainder) => {
      expect(splitArticleSummary(summary)).toEqual({ lead, remainder });
    },
  );

  it.each([
    [
      "Mr. Green grows pumpkins. His garden is nearby.",
      "Mr. Green grows pumpkins.",
      "His garden is nearby.",
    ],
    [
      "Mrs. Green grows pumpkins. Her garden is nearby.",
      "Mrs. Green grows pumpkins.",
      "Her garden is nearby.",
    ],
    [
      "Ms. Green grows pumpkins. Their garden is nearby.",
      "Ms. Green grows pumpkins.",
      "Their garden is nearby.",
    ],
    [
      "St. Louis hosts a pumpkin festival. It opens in October.",
      "St. Louis hosts a pumpkin festival.",
      "It opens in October.",
    ],
  ])(
    "keeps a common honorific with the name it introduces: %s",
    (summary, lead, remainder) => {
      expect(splitArticleSummary(summary)).toEqual({ lead, remainder });
    },
  );

  it.each([
    [
      "The U.S. pumpkin crop is large. Farmers harvest it in autumn.",
      "The U.S. pumpkin crop is large.",
      "Farmers harvest it in autumn.",
    ],
    [
      "She earned a Ph.D. in botany. Her research concerns squash.",
      "She earned a Ph.D. in botany.",
      "Her research concerns squash.",
    ],
    [
      "The U.S. Department of Agriculture studies pumpkins. Its reports are public.",
      "The U.S. Department of Agriculture studies pumpkins.",
      "Its reports are public.",
    ],
    [
      "The U.K. Government publishes guidance. It updates the guidance regularly.",
      "The U.K. Government publishes guidance.",
      "It updates the guidance regularly.",
    ],
    [
      "The program is administered by the U.S. Department of Agriculture. It began in 1933.",
      "The program is administered by the U.S. Department of Agriculture.",
      "It began in 1933.",
    ],
    [
      "The catalog is maintained by R.E.M. Records. It is updated annually.",
      "The catalog is maintained by R.E.M. Records.",
      "It is updated annually.",
    ],
  ])(
    "keeps a reviewed initialism inside its sentence: %s",
    (summary, lead, remainder) => {
      expect(splitArticleSummary(summary)).toEqual({ lead, remainder });
    },
  );

  it.each([
    [
      "The cultivar was developed in the U.S. It spread worldwide.",
      "The cultivar was developed in the U.S.",
      "It spread worldwide.",
    ],
    [
      "The botanist earned a Ph.D. She later studied pumpkins.",
      "The botanist earned a Ph.D.",
      "She later studied pumpkins.",
    ],
    [
      "The organization is based in the U.K. It has members worldwide.",
      "The organization is based in the U.K.",
      "It has members worldwide.",
    ],
  ])(
    "recognizes when a reviewed initialism ends the sentence: %s",
    (summary, lead, remainder) => {
      expect(splitArticleSummary(summary)).toEqual({ lead, remainder });
    },
  );

  it("keeps a corporate suffix with the sentence that follows it", () => {
    expect(
      splitArticleSummary(
        "Example Inc. is a fictional company. It appears in documentation.",
      ),
    ).toEqual({
      lead: "Example Inc. is a fictional company.",
      remainder: "It appears in documentation.",
    });
  });

  it("does not absorb a sentence that begins with a stylized proper name", () => {
    expect(
      splitArticleSummary(
        "Example is a fictional company. eBay facilitates real online sales. It was founded in 1995.",
      ),
    ).toEqual({
      lead: "Example is a fictional company.",
      remainder: "eBay facilitates real online sales. It was founded in 1995.",
    });
  });

  it("does not mistake a sentence-final capital for a personal initial", () => {
    expect(
      splitArticleSummary(
        "The supplement contains vitamin A. Deficiency can damage vision. It is preventable.",
      ),
    ).toEqual({
      lead: "The supplement contains vitamin A.",
      remainder: "Deficiency can damage vision. It is preventable.",
    });
  });

  it.each([
    [
      "The Symphony No. 5 in C minor is by Beethoven. It premiered in 1808.",
      "The Symphony No. 5 in C minor is by Beethoven.",
      "It premiered in 1808.",
    ],
    [
      "The artist was born c. 1450 in Florence. The exact year is unknown.",
      "The artist was born c. 1450 in Florence.",
      "The exact year is unknown.",
    ],
    [
      "Fig. 2 shows the cultivar. It has a ribbed rind.",
      "Fig. 2 shows the cultivar.",
      "It has a ribbed rind.",
    ],
  ])(
    "keeps a reviewed numeric abbreviation inside its sentence: %s",
    (summary, lead, remainder) => {
      expect(splitArticleSummary(summary)).toEqual({ lead, remainder });
    },
  );

  it.each([
    [
      "Pumpkin seeds contain about 3.14 milligrams in this example. The figure is illustrative.",
      "Pumpkin seeds contain about 3.14 milligrams in this example.",
      "The figure is illustrative.",
    ],
    [
      "The cultivar registry uses version 2.0 today. A later revision may differ.",
      "The cultivar registry uses version 2.0 today.",
      "A later revision may differ.",
    ],
  ])(
    "does not split a decimal or version number: %s",
    (summary, lead, remainder) => {
      expect(splitArticleSummary(summary)).toEqual({ lead, remainder });
    },
  );

  it.each([
    [
      "南瓜是一种冬季南瓜。它原产于美洲。",
      "南瓜是一种冬季南瓜。",
      "它原产于美洲。",
    ],
    ["南瓜好吃吗？当然好吃！", "南瓜好吃吗？", "当然好吃！"],
    ["ما هو اليقطين؟ إنه نوع من القرع.", "ما هو اليقطين؟", "إنه نوع من القرع."],
    [
      "یہ ایک کدو ہے۔ یہ خزاں میں اگتا ہے۔",
      "یہ ایک کدو ہے۔",
      "یہ خزاں میں اگتا ہے۔",
    ],
  ])(
    "recognizes CJK and Arabic-family sentence punctuation: %s",
    (summary, lead, remainder) => {
      expect(splitArticleSummary(summary)).toEqual({ lead, remainder });
    },
  );

  it("preserves emoji and a complete terminal punctuation cluster", () => {
    expect(
      splitArticleSummary("Did the pumpkin grin 🎃?! “Naturally,” said Sam."),
    ).toEqual({
      lead: "Did the pumpkin grin 🎃?!",
      remainder: "“Naturally,” said Sam.",
    });
  });

  it.each([
    [
      "The pumpkin paused... Then rolled away.",
      "The pumpkin paused...",
      "Then rolled away.",
    ],
    [
      "The pumpkin paused… Then rolled away.",
      "The pumpkin paused…",
      "Then rolled away.",
    ],
  ])(
    "keeps an ellipsis with the sentence it ends: %s",
    (summary, lead, remainder) => {
      expect(splitArticleSummary(summary)).toEqual({ lead, remainder });
    },
  );

  it.each([
    [
      "The pumpkin paused… then continued growing. It ripened in autumn.",
      "The pumpkin paused… then continued growing.",
      "It ripened in autumn.",
    ],
    [
      "...And Justice for All is a 1979 film. It was directed by Norman Jewison.",
      "...And Justice for All is a 1979 film.",
      "It was directed by Norman Jewison.",
    ],
  ])(
    "keeps a continuing ellipsis inside the first sentence: %s",
    (summary, lead, remainder) => {
      expect(splitArticleSummary(summary)).toEqual({ lead, remainder });
    },
  );

  it.each([
    ["", { lead: "", remainder: null }],
    [" \n\t ", { lead: "", remainder: null }],
    [
      "A single complete sentence.",
      { lead: "A single complete sentence.", remainder: null },
    ],
    [
      "A summary without terminal punctuation",
      { lead: "A summary without terminal punctuation", remainder: null },
    ],
    ["One sentence. \n\t ", { lead: "One sentence.", remainder: null }],
  ])(
    "returns no disclosure text when none remains: %j",
    (summary, expected) => {
      expect(splitArticleSummary(summary)).toEqual(expected);
    },
  );

  it("trims only outer and separating whitespace while preserving meaningful text", () => {
    expect(
      splitArticleSummary("  Café  🍂 stays composed.\n\n  Déjà vu follows.  "),
    ).toEqual({
      lead: "Café  🍂 stays composed.",
      remainder: "Déjà vu follows.",
    });
  });

  it("returns nonduplicated slices that recompose the meaningful summary", () => {
    const summary =
      "Pumpkins belong to the genus Cucurbita. Their seeds remain in the disclosure.";
    const { lead, remainder } = splitArticleSummary(summary);

    expect(`${lead} ${remainder}`).toBe(summary);
  });

  it("does not impose an arbitrary length clamp on a sentence-free summary", () => {
    const summary = `A${" very".repeat(2_000)} long summary`;

    expect(splitArticleSummary(summary)).toEqual({
      lead: summary,
      remainder: null,
    });
  });
});
