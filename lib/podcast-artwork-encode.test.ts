import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { convertArtworkToJpeg } from "./podcast-artwork-encode";

describe("convertArtworkToJpeg", () => {
  it("produces baseline opaque jpeg artwork", async () => {
    const source = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: {
          r: 12,
          g: 34,
          b: 56,
          alpha: 0.5,
        },
      },
    })
      .png()
      .toBuffer();

    const converted = await convertArtworkToJpeg({
      data: new Uint8Array(source),
      background: "#102030",
    });

    const metadata = await sharp(Buffer.from(converted)).metadata();

    expect(metadata.format).toBe("jpeg");
    expect(metadata.isProgressive).toBe(false);
    expect(metadata.hasAlpha).toBe(false);
  });
});
