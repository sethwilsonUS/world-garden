const GOOGLE_FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Fraunces:wght@700&family=DM+Sans:wght@400;500&display=swap";

async function extractFontUrl(css: string, family: string): Promise<string> {
  const escaped = family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(
    new RegExp(
      `@font-face\\s*\\{[^}]*font-family:\\s*'${escaped}'[^}]*\\}`,
      "i",
    ),
  );
  if (!block) throw new Error(`Font family "${family}" not found in CSS`);
  const urlMatch = block[0].match(/url\(([^)]+)\)/);
  if (!urlMatch) throw new Error(`No URL found for font "${family}"`);
  return urlMatch[1];
}

let cached: { fraunces: ArrayBuffer; dmSans: ArrayBuffer } | null = null;

type FontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;

export async function loadOgFonts(): Promise<
  { name: string; data: ArrayBuffer; weight: FontWeight; style: "normal" }[]
> {
  if (!cached) {
    const cssResponse = await fetch(GOOGLE_FONTS_CSS, {
      headers: {
        // Request TrueType fonts (woff2 is not supported by Satori)
        "User-Agent":
          "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1",
      },
    });
    const css = await cssResponse.text();

    const [frauncesUrl, dmSansUrl] = await Promise.all([
      extractFontUrl(css, "Fraunces"),
      extractFontUrl(css, "DM Sans"),
    ]);

    const [fraunces, dmSans] = await Promise.all([
      fetch(frauncesUrl).then((r) => r.arrayBuffer()),
      fetch(dmSansUrl).then((r) => r.arrayBuffer()),
    ]);

    cached = { fraunces, dmSans };
  }

  return [
    { name: "Fraunces", data: cached.fraunces, weight: 700, style: "normal" },
    { name: "DM Sans", data: cached.dmSans, weight: 400, style: "normal" },
  ];
}
