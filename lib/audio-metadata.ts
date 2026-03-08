type EmbeddedArtwork = {
  data: Uint8Array;
  mimeType: string;
  description?: string;
};

type Mp3Metadata = {
  title: string;
  artist?: string;
  album?: string;
  artwork?: EmbeddedArtwork;
};

const UTF16_TEXT_ENCODING = 0x01;
const APIC_FRONT_COVER_TYPE = 0x03;

const textEncoder = new TextEncoder();

const concatBytes = (...chunks: Uint8Array[]): Uint8Array => {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
};

const encodeUtf16WithBom = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(`\uFEFF${value}`, "utf16le"));

const encodeFrameId = (frameId: string): Uint8Array => textEncoder.encode(frameId);

const encodeFrameSize = (size: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, size, false);
  return bytes;
};

const encodeSynchsafeSize = (size: number): Uint8Array =>
  Uint8Array.of(
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  );

const createFrame = (frameId: string, payload: Uint8Array): Uint8Array =>
  concatBytes(
    encodeFrameId(frameId),
    encodeFrameSize(payload.length),
    Uint8Array.of(0x00, 0x00),
    payload,
  );

const createTextFrame = (frameId: string, value: string | undefined): Uint8Array | null => {
  if (!value) return null;
  return createFrame(
    frameId,
    concatBytes(Uint8Array.of(UTF16_TEXT_ENCODING), encodeUtf16WithBom(value)),
  );
};

const createApicFrame = (artwork: EmbeddedArtwork | undefined): Uint8Array | null => {
  if (!artwork) return null;

  const mimeType = textEncoder.encode(artwork.mimeType);
  const description = encodeUtf16WithBom(artwork.description ?? "Cover");
  const payload = concatBytes(
    Uint8Array.of(UTF16_TEXT_ENCODING),
    mimeType,
    Uint8Array.of(0x00),
    Uint8Array.of(APIC_FRONT_COVER_TYPE),
    description,
    Uint8Array.of(0x00, 0x00),
    artwork.data,
  );

  return createFrame("APIC", payload);
};

export const addMp3Metadata = (
  mp3Data: Uint8Array,
  metadata: Mp3Metadata,
): Uint8Array => {
  const frames = [
    createTextFrame("TIT2", metadata.title),
    createTextFrame("TPE1", metadata.artist),
    createTextFrame("TALB", metadata.album),
    createApicFrame(metadata.artwork),
  ].filter((frame): frame is Uint8Array => frame !== null);

  if (frames.length === 0) return mp3Data;

  const tagBody = concatBytes(...frames);
  const header = concatBytes(
    textEncoder.encode("ID3"),
    Uint8Array.of(0x03, 0x00, 0x00),
    encodeSynchsafeSize(tagBody.length),
  );

  return concatBytes(header, tagBody, mp3Data);
};

export const addMp3MetadataToBlob = async (
  mp3Blob: Blob,
  metadata: Mp3Metadata,
): Promise<Blob> => {
  const mp3Data = new Uint8Array(await mp3Blob.arrayBuffer());
  const taggedData = addMp3Metadata(mp3Data, metadata);
  const taggedBuffer = new ArrayBuffer(taggedData.byteLength);
  new Uint8Array(taggedBuffer).set(taggedData);
  return new Blob([taggedBuffer], { type: mp3Blob.type || "audio/mpeg" });
};
