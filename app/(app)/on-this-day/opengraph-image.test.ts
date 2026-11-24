import sharp from "sharp";
import { describe, expect, it } from "vitest";
import OgImage, {
  alt as ogAlt,
  contentType as ogContentType,
  size as ogSize,
} from "./opengraph-image";
import TwitterImage, {
  alt as twitterAlt,
  contentType as twitterContentType,
  size as twitterSize,
} from "./twitter-image";

const JPEG_SOI_SIGNATURE = [0xff, 0xd8, 0xff];

describe("On This Day evergreen OpenGraph and Twitter images", () => {
  it("exports literal image/jpeg metadata and 1200x630 size on both routes", () => {
    expect(TwitterImage).toBe(OgImage);
    expect(ogContentType).toBe("image/jpeg");
    expect(twitterContentType).toBe("image/jpeg");
    expect(ogSize).toEqual({ width: 1200, height: 630 });
    expect(twitterSize).toEqual({ width: 1200, height: 630 });
    expect(ogAlt).toContain("On This Day");
    expect(twitterAlt).toBe(ogAlt);
  });

  it("renders a valid 1200x630 JPEG using the 5 bundled Public Domain plates", async () => {
    const response = await OgImage();
    const bytes = new Uint8Array(await response.arrayBuffer());
    const metadata = await sharp(bytes).metadata();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("max-age=86400");
    expect(response.headers.get("cache-control")).toContain("s-maxage=604800");
    expect(Array.from(bytes.slice(0, 3))).toEqual(JPEG_SOI_SIGNATURE);
    expect(metadata.format).toBe("jpeg");
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
  }, 20_000);
});
