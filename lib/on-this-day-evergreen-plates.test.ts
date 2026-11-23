import { access } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  EVERGREEN_ON_THIS_DAY_EYEBROW,
  EVERGREEN_ON_THIS_DAY_SUBTITLE,
  loadEvergreenOnThisDayPlateManifest,
  loadEvergreenOnThisDayPlates,
} from "./on-this-day-evergreen-plates";

const EVERGREEN_PLATES_DIR = join(
  process.cwd(),
  "app",
  "(app)",
  "on-this-day",
  "evergreen-plates",
);

const EXPECTED_FILENAMES = [
  "1969-apollo-11.jpg",
  "1903-wright-flyer.jpg",
  "1921-albert-einstein.jpg",
  "1831-great-wave.jpg",
  "1879-frederick-douglass.jpg",
] as const;

describe("on-this-day evergreen plates", () => {
  it("exports the evergreen eyebrow and subtitle copy", () => {
    expect(EVERGREEN_ON_THIS_DAY_EYEBROW).toBe("A DAILY WALK THROUGH HISTORY");
    expect(EVERGREEN_ON_THIS_DAY_SUBTITLE).toBe(
      "History's defining moments, notable lives, and holidays — every day of the year.",
    );
  });

  it("bundles all 5 evergreen plate JPEGs and complete Public Domain manifest metadata", async () => {
    const manifest = await loadEvergreenOnThisDayPlateManifest();

    expect(manifest).toHaveLength(5);
    expect(manifest.map((entry) => entry.filename)).toEqual(
      Array.from(EXPECTED_FILENAMES),
    );

    for (const entry of manifest) {
      await expect(
        access(join(EVERGREEN_PLATES_DIR, entry.filename)),
      ).resolves.toBeUndefined();
      expect(entry.id).toBeTruthy();
      expect(entry.yearLabel).toBe(String(entry.year));
      expect(entry.title).toBeTruthy();
      expect(entry.commonsTitle.startsWith("File:")).toBe(true);
      expect(
        entry.commonsUrl.startsWith("https://commons.wikimedia.org/wiki/File:"),
      ).toBe(true);
      expect(entry.author).toBeTruthy();
      expect(entry.licenseBasis).toMatch(/Public Domain/i);
      expect(entry.width).toBeGreaterThanOrEqual(300);
      expect(entry.height).toBeGreaterThanOrEqual(300);
      expect(entry.width).toBeLessThanOrEqual(640);
      expect(entry.height).toBeLessThanOrEqual(640);
      expect(entry.isPortrait).toBe(entry.height > entry.width);
    }
  });

  it("loads all 5 plates as valid baseline JPEG data URLs matching manifest dimensions and flags", async () => {
    const [manifest, plates] = await Promise.all([
      loadEvergreenOnThisDayPlateManifest(),
      loadEvergreenOnThisDayPlates(),
    ]);

    expect(plates).toHaveLength(5);

    const heroes = plates.filter((plate) => plate.isHero);
    expect(heroes).toHaveLength(1);
    expect(heroes[0]?.id).toBe("1969-apollo-11");

    const portraitIds = plates
      .filter((plate) => plate.isPortrait)
      .map((plate) => plate.id);
    expect(portraitIds).toEqual([
      "1921-albert-einstein",
      "1879-frederick-douglass",
    ]);

    for (let index = 0; index < plates.length; index += 1) {
      const plate = plates[index];
      const entry = manifest[index];
      expect(plate).toBeDefined();
      expect(entry).toBeDefined();
      if (!plate || !entry) {
        continue;
      }

      expect(plate.id).toBe(entry.id);
      expect(plate.year).toBe(entry.year);
      expect(plate.yearLabel).toBe(entry.yearLabel);
      expect(plate.title).toBe(entry.title);
      expect(plate.isHero).toBe(entry.isHero);
      expect(plate.isPortrait).toBe(entry.isPortrait);
      expect(plate.width).toBe(entry.width);
      expect(plate.height).toBe(entry.height);

      const prefix = "data:image/jpeg;base64,";
      expect(plate.imageDataUrl.startsWith(prefix)).toBe(true);

      const decoded = Buffer.from(
        plate.imageDataUrl.slice(prefix.length),
        "base64",
      );
      expect(decoded.byteLength).toBeGreaterThan(10_000);
      expect(decoded[0]).toBe(0xff);
      expect(decoded[1]).toBe(0xd8);
      expect(decoded[2]).toBe(0xff);

      const metadata = await sharp(decoded).metadata();
      expect(metadata.format).toBe("jpeg");
      expect(metadata.isProgressive).toBe(false);
      expect(metadata.width).toBe(plate.width);
      expect(metadata.height).toBe(plate.height);
      expect(metadata.width).toBeGreaterThanOrEqual(300);
      expect(metadata.height).toBeGreaterThanOrEqual(300);
      expect(metadata.width).toBeLessThanOrEqual(640);
      expect(metadata.height).toBeLessThanOrEqual(640);
    }
  });

  it("caches loaded plates in module memory across calls", async () => {
    const first = await loadEvergreenOnThisDayPlates();
    const second = await loadEvergreenOnThisDayPlates();

    expect(second).toBe(first);
  });
});
