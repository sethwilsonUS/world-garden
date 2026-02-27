import { describe, it, expect } from "vitest";
import { normalizeTtsText } from "./tts-normalize";

describe("normalizeTtsText", () => {
  describe("context-dependent abbreviations", () => {
    it("expands 'St.' or 'St' before a capitalized word to 'Saint'", () => {
      expect(normalizeTtsText("St. Louis")).toBe("Saint Louis");
      expect(normalizeTtsText("St. Patrick")).toBe("Saint Patrick");
      expect(normalizeTtsText("St. Francis")).toBe("Saint Francis");
      // Wikipedia sometimes omits the period
      expect(normalizeTtsText("St Francis of Assisi")).toBe(
        "Saint Francis of Assisi",
      );
    });

    it("expands 'St.' after a word to 'Street'", () => {
      expect(normalizeTtsText("Main St.")).toBe("Main Street");
      expect(normalizeTtsText("Baker St.")).toBe("Baker Street");
    });

    it("expands 'Dr.' before a capitalized word to 'Doctor'", () => {
      expect(normalizeTtsText("Dr. King")).toBe("Doctor King");
      expect(normalizeTtsText("Dr. Smith")).toBe("Doctor Smith");
    });

    it("expands 'Dr.' after a word to 'Drive'", () => {
      expect(normalizeTtsText("Sunset Dr.")).toBe("Sunset Drive");
    });

    it("expands 'Mt.' to 'Mount'", () => {
      expect(normalizeTtsText("Mt. Everest")).toBe("Mount Everest");
      expect(normalizeTtsText("Mt. Rushmore")).toBe("Mount Rushmore");
    });

    it("expands 'Ft.' before a capitalized word to 'Fort'", () => {
      expect(normalizeTtsText("Ft. Lauderdale")).toBe("Fort Lauderdale");
    });
  });

  describe("unambiguous abbreviations", () => {
    it("expands street/address abbreviations", () => {
      expect(normalizeTtsText("Park Ave.")).toBe("Park Avenue");
      expect(normalizeTtsText("Sunset Blvd.")).toBe("Sunset Boulevard");
    });

    it("expands title abbreviations", () => {
      expect(normalizeTtsText("Martin Luther King Jr.")).toBe(
        "Martin Luther King Junior",
      );
      expect(normalizeTtsText("Corp. and Inc.")).toBe(
        "Corporation and Incorporated",
      );
    });

    it("expands 'vs.' to 'versus'", () => {
      expect(normalizeTtsText("Roe vs. Wade")).toBe("Roe versus Wade");
    });

    it("expands 'ca.' before a number to 'circa'", () => {
      expect(normalizeTtsText("ca. 1500")).toBe("circa 1500");
    });

    it("expands 'No.' before a number to 'Number'", () => {
      expect(normalizeTtsText("No. 5")).toBe("Number 5");
    });

    it("expands military/political titles before names", () => {
      expect(normalizeTtsText("Gen. Patton")).toBe("General Patton");
      expect(normalizeTtsText("Gov. Newsom")).toBe("Governor Newsom");
      expect(normalizeTtsText("Sgt. Pepper")).toBe("Sergeant Pepper");
      expect(normalizeTtsText("Col. Mustard")).toBe("Colonel Mustard");
      expect(normalizeTtsText("Prof. Xavier")).toBe("Professor Xavier");
      expect(normalizeTtsText("Sen. Warren")).toBe("Senator Warren");
      expect(normalizeTtsText("Capt. America")).toBe("Captain America");
      expect(normalizeTtsText("Lt. Dan")).toBe("Lieutenant Dan");
      expect(normalizeTtsText("Rep. Jones")).toBe("Representative Jones");
    });

    it("expands honorific abbreviations", () => {
      expect(normalizeTtsText("Robert Downey Sr.")).toBe(
        "Robert Downey Senior",
      );
    });

    it("expands organization abbreviations", () => {
      expect(normalizeTtsText("Dept. of Defense")).toBe(
        "Department of Defense",
      );
      expect(normalizeTtsText("Acme Ltd.")).toBe("Acme Limited");
    });

    it("expands volume and part abbreviations", () => {
      expect(normalizeTtsText("Vol. 3")).toBe("Volume 3");
      expect(normalizeTtsText("Pt. 2")).toBe("Part 2");
    });
  });

  describe("edge cases", () => {
    it("handles text with no abbreviations", () => {
      const text = "The quick brown fox jumps over the lazy dog.";
      expect(normalizeTtsText(text)).toBe(text);
    });

    it("handles multiple abbreviations in one string", () => {
      expect(normalizeTtsText("Dr. King lived on Main St.")).toBe(
        "Doctor King lived on Main Street",
      );
    });

    it("handles empty string", () => {
      expect(normalizeTtsText("")).toBe("");
    });
  });
});
