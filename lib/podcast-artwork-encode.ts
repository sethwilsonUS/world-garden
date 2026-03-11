import sharp from "sharp";

export const convertArtworkToJpeg = async ({
  data,
  background,
  quality = 92,
}: {
  data: Uint8Array;
  background: string;
  quality?: number;
}): Promise<Uint8Array> => {
  const output = await sharp(Buffer.from(data))
    .flatten({ background })
    .jpeg({
      quality,
      mozjpeg: false,
      progressive: false,
      chromaSubsampling: "4:4:4",
    })
    .toBuffer();

  return new Uint8Array(output);
};
