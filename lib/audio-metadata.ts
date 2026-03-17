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

const encodeUtf16WithBom = (value: string): Uint8Array => {
  const result = new Uint8Array(2 + value.length * 2);
  result[0] = 0xff;
  result[1] = 0xfe;

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    const offset = 2 + index * 2;
    result[offset] = codeUnit & 0xff;
    result[offset + 1] = codeUnit >> 8;
  }

  return result;
};

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

const buildMp3MetadataTag = (metadata: Mp3Metadata): Uint8Array | null => {
  const frames = [
    createTextFrame("TIT2", metadata.title),
    createTextFrame("TPE1", metadata.artist),
    createTextFrame("TALB", metadata.album),
    createApicFrame(metadata.artwork),
  ].filter((frame): frame is Uint8Array => frame !== null);

  if (frames.length === 0) return null;

  const tagBody = concatBytes(...frames);
  return concatBytes(
    textEncoder.encode("ID3"),
    Uint8Array.of(0x03, 0x00, 0x00),
    encodeSynchsafeSize(tagBody.length),
    tagBody,
  );
};

const decodeSynchsafeSize = (bytes: Uint8Array): number =>
  ((bytes[0] ?? 0) << 21) |
  ((bytes[1] ?? 0) << 14) |
  ((bytes[2] ?? 0) << 7) |
  (bytes[3] ?? 0);

const readId3TagSizeAt = (
  mp3Data: Uint8Array,
  offset: number,
): number | null => {
  if (
    offset < 0 ||
    offset + 10 > mp3Data.length ||
    mp3Data[offset] !== 0x49 ||
    mp3Data[offset + 1] !== 0x44 ||
    mp3Data[offset + 2] !== 0x33
  ) {
    return null;
  }

  const sizeBytes = mp3Data.slice(offset + 6, offset + 10);
  if (sizeBytes.some((byte) => byte > 0x7f)) {
    return null;
  }

  const tagSize = decodeSynchsafeSize(sizeBytes);
  const totalTagSize = 10 + tagSize;
  return offset + totalTagSize <= mp3Data.length ? totalTagSize : null;
};

export const stripAllId3Tags = (mp3Data: Uint8Array): Uint8Array => {
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  let segmentStart = 0;

  while (cursor < mp3Data.length) {
    const tagSize = readId3TagSizeAt(mp3Data, cursor);
    if (tagSize == null) {
      cursor += 1;
      continue;
    }

    if (segmentStart < cursor) {
      chunks.push(mp3Data.slice(segmentStart, cursor));
    }

    cursor += tagSize;
    segmentStart = cursor;
  }

  if (segmentStart === 0) {
    return mp3Data;
  }

  if (segmentStart < mp3Data.length) {
    chunks.push(mp3Data.slice(segmentStart));
  }

  return chunks.length > 0 ? concatBytes(...chunks) : new Uint8Array();
};

export const concatenateMp3Buffers = (
  mp3Parts: Uint8Array[],
): Uint8Array => {
  const sanitizedParts = mp3Parts
    .map((part) => stripAllId3Tags(part))
    .filter((part) => part.length > 0);

  return sanitizedParts.length > 0
    ? concatBytes(...sanitizedParts)
    : new Uint8Array();
};

export const concatenateMp3Blobs = async (
  mp3Parts: Blob[],
): Promise<Blob> => {
  const buffers = await Promise.all(
    mp3Parts.map(async (part) => new Uint8Array(await part.arrayBuffer())),
  );
  const combined = concatenateMp3Buffers(buffers);
  const blobBuffer = new ArrayBuffer(combined.byteLength);
  new Uint8Array(blobBuffer).set(combined);

  return new Blob([blobBuffer], {
    type: "audio/mpeg",
  });
};

export const addMp3Metadata = (
  mp3Data: Uint8Array,
  metadata: Mp3Metadata,
): Uint8Array => {
  const tag = buildMp3MetadataTag(metadata);
  if (!tag) return mp3Data;

  return concatBytes(tag, stripAllId3Tags(mp3Data));
};

export const addMp3MetadataToBlob = async (
  mp3Blob: Blob,
  metadata: Mp3Metadata,
): Promise<Blob> => {
  const tag = buildMp3MetadataTag(metadata);
  if (!tag) return mp3Blob;

  const mp3Data = stripAllId3Tags(new Uint8Array(await mp3Blob.arrayBuffer()));
  const tagBuffer = new ArrayBuffer(tag.byteLength);
  const mp3Buffer = new ArrayBuffer(mp3Data.byteLength);
  new Uint8Array(tagBuffer).set(tag);
  new Uint8Array(mp3Buffer).set(mp3Data);
  return new Blob([tagBuffer, mp3Buffer], {
    type: mp3Blob.type || "audio/mpeg",
  });
};
