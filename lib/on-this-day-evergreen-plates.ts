import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const EVERGREEN_ON_THIS_DAY_EYEBROW = "A DAILY WALK THROUGH HISTORY";
export const EVERGREEN_ON_THIS_DAY_SUBTITLE =
  "History's defining moments, notable lives, and holidays — every day of the year.";

const EVERGREEN_PLATES_DIR = join(
  process.cwd(),
  "app",
  "(app)",
  "on-this-day",
  "evergreen-plates",
);

const evergreenPlateManifestEntrySchema = z.object({
  id: z.string().min(1),
  filename: z.string().regex(/^[a-z0-9-]+\.jpg$/u),
  year: z.number().int(),
  yearLabel: z.string().min(1),
  title: z.string().min(1),
  isHero: z.boolean(),
  isPortrait: z.boolean(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  commonsTitle: z.string().startsWith("File:"),
  commonsUrl: z.url(),
  author: z.string().min(1),
  licenseBasis: z.string().min(1),
});

const evergreenPlateManifestSchema = z
  .array(evergreenPlateManifestEntrySchema)
  .min(1);

export type EvergreenOnThisDayPlateManifestEntry = z.infer<
  typeof evergreenPlateManifestEntrySchema
>;

export type EvergreenOnThisDayPlate = {
  id: string;
  year: number;
  yearLabel: string;
  title: string;
  isHero: boolean;
  isPortrait: boolean;
  width: number;
  height: number;
  imageDataUrl: string;
};

let cachedManifestPromise: Promise<
  EvergreenOnThisDayPlateManifestEntry[]
> | null = null;
let cachedPlatesPromise: Promise<EvergreenOnThisDayPlate[]> | null = null;

function isValidJpegHeader(buffer: Buffer): boolean {
  return (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  );
}

export async function loadEvergreenOnThisDayPlateManifest(): Promise<
  EvergreenOnThisDayPlateManifestEntry[]
> {
  if (cachedManifestPromise) {
    return await cachedManifestPromise;
  }

  const pending = (async () => {
    const manifestPath = join(EVERGREEN_PLATES_DIR, "manifest.json");
    const rawJson = await readFile(manifestPath, "utf8");
    const parsed: unknown = JSON.parse(rawJson);
    return evergreenPlateManifestSchema.parse(parsed);
  })();

  cachedManifestPromise = pending;
  try {
    return await pending;
  } catch (error) {
    cachedManifestPromise = null;
    throw error;
  }
}

export async function loadEvergreenOnThisDayPlates(): Promise<
  EvergreenOnThisDayPlate[]
> {
  if (cachedPlatesPromise) {
    return await cachedPlatesPromise;
  }

  const pending = (async () => {
    const manifest = await loadEvergreenOnThisDayPlateManifest();
    return await Promise.all(
      manifest.map(async (entry): Promise<EvergreenOnThisDayPlate> => {
        const imagePath = join(EVERGREEN_PLATES_DIR, entry.filename);
        const bytes = await readFile(imagePath);
        if (!isValidJpegHeader(bytes)) {
          throw new Error(
            `Evergreen On This Day plate "${entry.filename}" is not a valid JPEG file`,
          );
        }

        return {
          id: entry.id,
          year: entry.year,
          yearLabel: entry.yearLabel,
          title: entry.title,
          isHero: entry.isHero,
          isPortrait: entry.isPortrait,
          width: entry.width,
          height: entry.height,
          imageDataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
        };
      }),
    );
  })();

  cachedPlatesPromise = pending;
  try {
    return await pending;
  } catch (error) {
    cachedPlatesPromise = null;
    throw error;
  }
}
