import { describe, expect, it } from "vitest";
import {
  addMp3Metadata,
  addMp3MetadataToBlob,
  concatenateMp3Buffers,
} from "./audio-metadata";

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

  it("prepends metadata to a blob without rewriting the original mp3 bytes", async () => {
    const originalMp3 = Uint8Array.of(0xff, 0xfb, 0x90, 0x64, 0x00, 0x11);
    const blob = new Blob([originalMp3], { type: "audio/mpeg" });

    const taggedBlob = await addMp3MetadataToBlob(blob, {
      title: "Nintendo",
      artist: "Curio Garden",
    });

    const taggedBytes = new Uint8Array(await taggedBlob.arrayBuffer());
    const ascii = decoder.decode(taggedBytes);

    expect(taggedBlob.type).toBe("audio/mpeg");
    expect(ascii.startsWith("ID3")).toBe(true);
    expect(ascii).toContain("TIT2");
    expect(ascii).toContain("TPE1");
    expect(Array.from(taggedBytes.slice(-originalMp3.length))).toEqual(
      Array.from(originalMp3),
    );
  });

  it("replaces an existing leading ID3 tag instead of stacking another one", async () => {
    const originalMp3 = Uint8Array.of(0xff, 0xfb, 0x90, 0x64, 0x00, 0x11);
    const firstPass = addMp3Metadata(originalMp3, {
      title: "First title",
      artist: "Curio Garden",
    });

    const updated = addMp3Metadata(firstPass, {
      title: "Second title",
      artist: "Curio Garden",
    });

    const ascii = decoder.decode(updated);
    expect(ascii.startsWith("ID3")).toBe(true);
    expect(ascii).toContain("TIT2");
    expect(ascii.indexOf("ID3", 3)).toBe(-1);
    expect(Array.from(updated.slice(-originalMp3.length))).toEqual(
      Array.from(originalMp3),
    );
  });

  it("strips embedded ID3 tags when concatenating multiple mp3 parts", () => {
    const firstAudio = Uint8Array.of(0xff, 0xfb, 0x90, 0x64, 0x00, 0x11);
    const secondAudio = Uint8Array.of(0xff, 0xfb, 0x91, 0x64, 0x22, 0x33);
    const firstTagged = addMp3Metadata(firstAudio, {
      title: "First chunk",
      artist: "Curio Garden",
    });
    const secondTagged = addMp3Metadata(secondAudio, {
      title: "Second chunk",
      artist: "Curio Garden",
    });

    const combined = concatenateMp3Buffers([firstTagged, secondTagged]);

    expect(decoder.decode(combined)).not.toContain("ID3");
    expect(Array.from(combined)).toEqual([
      ...Array.from(firstAudio),
      ...Array.from(secondAudio),
    ]);
  });

  it("removes embedded ID3 tags before adding the final metadata tag", async () => {
    const firstAudio = Uint8Array.of(0xff, 0xfb, 0x90, 0x64, 0x00, 0x11);
    const secondAudio = Uint8Array.of(0xff, 0xfb, 0x91, 0x64, 0x22, 0x33);
    const firstTagged = addMp3Metadata(firstAudio, {
      title: "First chunk",
      artist: "Curio Garden",
    });
    const secondTagged = addMp3Metadata(secondAudio, {
      title: "Second chunk",
      artist: "Curio Garden",
    });

    const taggedBlob = await addMp3MetadataToBlob(
      new Blob([firstTagged, secondTagged], { type: "audio/mpeg" }),
      {
        title: "Combined file",
        artist: "Curio Garden",
      },
    );

    const taggedBytes = new Uint8Array(await taggedBlob.arrayBuffer());
    const ascii = decoder.decode(taggedBytes);

    expect(ascii.startsWith("ID3")).toBe(true);
    expect(ascii.indexOf("ID3", 3)).toBe(-1);
    expect(Array.from(taggedBytes.slice(-(firstAudio.length + secondAudio.length)))).toEqual(
      [...Array.from(firstAudio), ...Array.from(secondAudio)],
    );
  });
});
