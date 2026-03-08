import { describe, expect, it } from "vitest";
import { addMp3Metadata } from "./audio-metadata";

const decoder = new TextDecoder();

describe("addMp3Metadata", () => {
  it("prepends ID3 metadata and preserves the original mp3 bytes", () => {
    const originalMp3 = Uint8Array.of(0xff, 0xfb, 0x90, 0x64, 0x00, 0x11);

    const tagged = addMp3Metadata(originalMp3, {
      title: "Luisa Capetillo",
      artist: "Curio Garden",
      album: "Wikipedia Featured Articles Presented by Curio Garden",
      artwork: {
        mimeType: "image/png",
        data: Uint8Array.of(0x89, 0x50, 0x4e, 0x47),
      },
    });

    const ascii = decoder.decode(tagged);

    expect(ascii.startsWith("ID3")).toBe(true);
    expect(ascii).toContain("TIT2");
    expect(ascii).toContain("TPE1");
    expect(ascii).toContain("TALB");
    expect(ascii).toContain("APIC");
    expect(Array.from(tagged.slice(-originalMp3.length))).toEqual(
      Array.from(originalMp3),
    );
  });

  it("omits artwork metadata when no image is provided", () => {
    const tagged = addMp3Metadata(Uint8Array.of(0xff, 0xfb, 0x90, 0x64), {
      title: "Example episode",
    });

    expect(decoder.decode(tagged)).toContain("TIT2");
    expect(decoder.decode(tagged)).not.toContain("APIC");
  });
});
