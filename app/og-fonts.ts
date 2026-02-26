import { readFile } from "node:fs/promises";
import { join } from "node:path";

type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: FontWeight;
  style: "normal";
};

let cached: OgFont[] | null = null;

export async function loadOgFonts(): Promise<OgFont[]> {
  if (cached) return cached;

  try {
    const fontsDir = join(process.cwd(), "app", "fonts");
    const [fraunces, dmSans] = await Promise.all([
      readFile(join(fontsDir, "Fraunces-Bold.ttf")),
      readFile(join(fontsDir, "DMSans-Regular.ttf")),
    ]);

    cached = [
      { name: "Fraunces", data: fraunces.buffer, weight: 700, style: "normal" },
      { name: "DM Sans", data: dmSans.buffer, weight: 400, style: "normal" },
    ];
    return cached;
  } catch {
    return [];
  }
}
