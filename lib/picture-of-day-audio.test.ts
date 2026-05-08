import { describe, expect, it } from "vitest";
import {
  PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION,
  buildPictureOfDayAudioTitle,
  buildPictureOfDaySpeechScript,
} from "./picture-of-day-audio";
import type { WikipediaPictureOfDay } from "./featured-article";

const picture = {
  title: "File:Hoverfly May 2008-8.jpg",
  pictureKey: "File:Hoverfly May 2008-8.jpg",
  altText: "A Marmelade fly on flight.",
  description: "A Marmelade fly on flight.",
  artist: "Alvesgaspar",
  credit: "Own work",
  filePage: "https://commons.wikimedia.org/wiki/File:Hoverfly_May_2008-8.jpg",
  license: {
    type: "CC BY-SA 3.0",
    url: "https://creativecommons.org/licenses/by-sa/3.0",
  },
} satisfies WikipediaPictureOfDay;

describe("picture of day audio", () => {
  it("uses a stable script version", () => {
    expect(PICTURE_OF_DAY_AUDIO_SCRIPT_VERSION).toBe(1);
  });

  it("builds a descriptive title for the daily picture", () => {
    expect(buildPictureOfDayAudioTitle("2026-05-08")).toBe(
      "Picture of the Day: May 8, 2026",
    );
  });

  it("builds speech from description, artist, credit, source, and license", () => {
    const script = buildPictureOfDaySpeechScript({
      feedDateIso: "2026-05-08",
      picture,
    });

    expect(script).toContain("Curio Garden. Picture of the Day for May 8, 2026.");
    expect(script).toContain("A Marmelade fly on flight.");
    expect(script).toContain("Artist: Alvesgaspar.");
    expect(script).toContain("Credit: Own work.");
    expect(script).toContain("Source file: File:Hoverfly May 2008-8.jpg on Wikimedia Commons.");
    expect(script).toContain("License: CC BY-SA 3.0.");
  });

  it("uses useful fallbacks when optional Commons metadata is missing", () => {
    const script = buildPictureOfDaySpeechScript({
      feedDateIso: "2026-05-08",
      picture: {
        title: "File:Quiet garden.jpg",
        pictureKey: "File:Quiet garden.jpg",
        altText: "Wikipedia picture of the day",
        description: "",
      },
    });

    expect(script).toContain("The picture is titled File:Quiet garden.jpg.");
    expect(script).toContain("Creator and license details were not included in the feed metadata.");
  });
});
