import { describe, expect, it } from "vitest";
import OgImage from "./opengraph-image";
import TwitterImage from "./twitter-image";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

describe("On This Day calendar day OpenGraph and Twitter images", () => {
  it("renders a valid PNG for a canonical calendar day slug", async () => {
    expect(TwitterImage).toBe(OgImage);

    const response = await OgImage({
      params: Promise.resolve({ day: "march-5" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(Array.from(bytes.slice(0, 4))).toEqual(PNG_SIGNATURE);
  }, 20_000);

  it("renders February 29 cleanly", async () => {
    const response = await OgImage({
      params: Promise.resolve({ day: "february-29" }),
    });
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(Array.from(bytes.slice(0, 4))).toEqual(PNG_SIGNATURE);
  }, 20_000);
});
