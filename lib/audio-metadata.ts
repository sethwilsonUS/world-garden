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

type ByteRange = {
  start: number;
  end: number;
};

type AddMp3MetadataToBlobOptions = {
  stripExistingId3Tags?: boolean;
};

type Mp3BlobStripMode = "all" | "leading" | "none";

type ConcatenateMp3BlobOptions = {
  stripId3Tags?: Mp3BlobStripMode;
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

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
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

const readLeadingId3TagSize = (
  header: Uint8Array,
  totalByteLength: number,
): number | null => {
  if (
    header.length < 10 ||
    header[0] !== 0x49 ||
    header[1] !== 0x44 ||
    header[2] !== 0x33
  ) {
    return null;
  }

  const sizeBytes = header.slice(6, 10);
  if (sizeBytes.some((byte) => byte > 0x7f)) {
    return null;
  }

  const totalTagSize = 10 + decodeSynchsafeSize(sizeBytes);
  return totalTagSize <= totalByteLength ? totalTagSize : null;
};

const getId3StrippedByteRanges = (mp3Data: Uint8Array): ByteRange[] => {
  const ranges: ByteRange[] = [];
  let cursor = 0;
  let segmentStart = 0;
  let foundTag = false;

  while (cursor < mp3Data.length) {
    const tagSize = readId3TagSizeAt(mp3Data, cursor);
    if (tagSize == null) {
      cursor += 1;
      continue;
    }

    foundTag = true;
    if (segmentStart < cursor) {
      ranges.push({ start: segmentStart, end: cursor });
    }

    cursor += tagSize;
    segmentStart = cursor;
  }

  if (!foundTag) {
    return mp3Data.length > 0
      ? [{ start: 0, end: mp3Data.length }]
      : [];
  }

  if (segmentStart < mp3Data.length) {
    ranges.push({ start: segmentStart, end: mp3Data.length });
  }

  return ranges;
};

const coversWholeBuffer = (
  ranges: ByteRange[],
  byteLength: number,
): boolean =>
  ranges.length === 1 &&
  ranges[0]?.start === 0 &&
  ranges[0]?.end === byteLength;

const stripAllId3TagsFromBlob = async (mp3Blob: Blob): Promise<Blob[]> => {
  const ranges = getId3StrippedByteRanges(
    new Uint8Array(await mp3Blob.arrayBuffer()),
  );

  if (coversWholeBuffer(ranges, mp3Blob.size)) {
    return [mp3Blob];
  }

  return ranges
    .filter((range) => range.end > range.start)
    .map((range) =>
      mp3Blob.slice(range.start, range.end, mp3Blob.type || "audio/mpeg"),
    );
};

const stripLeadingId3TagFromBlob = async (mp3Blob: Blob): Promise<Blob> => {
  const header = new Uint8Array(await mp3Blob.slice(0, 10).arrayBuffer());
  const leadingTagSize = readLeadingId3TagSize(header, mp3Blob.size);

  return leadingTagSize == null
    ? mp3Blob
    : mp3Blob.slice(leadingTagSize, mp3Blob.size, mp3Blob.type || "audio/mpeg");
};

const stripLeadingId3Tag = (mp3Data: Uint8Array): Uint8Array => {
  const leadingTagSize = readLeadingId3TagSize(
    mp3Data.slice(0, 10),
    mp3Data.length,
  );

  return leadingTagSize == null ? mp3Data : mp3Data.slice(leadingTagSize);
};

const stripId3TagsFromBlob = async (
  mp3Blob: Blob,
  mode: Mp3BlobStripMode,
): Promise<Blob[]> => {
  if (mode === "none") {
    return [mp3Blob];
  }

  if (mode === "leading") {
    const strippedBlob = await stripLeadingId3TagFromBlob(mp3Blob);
    return strippedBlob.size > 0 ? [strippedBlob] : [];
  }

  return await stripAllId3TagsFromBlob(mp3Blob);
};

export const stripAllId3Tags = (mp3Data: Uint8Array): Uint8Array => {
  const ranges = getId3StrippedByteRanges(mp3Data);
  if (coversWholeBuffer(ranges, mp3Data.length)) {
    return mp3Data;
  }

  const chunks = ranges.map((range) => mp3Data.slice(range.start, range.end));
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
  options?: ConcatenateMp3BlobOptions,
): Promise<Blob> => {
  const stripId3Tags = options?.stripId3Tags ?? "all";

  try {
    const sanitizedParts: Blob[] = [];
    for (const part of mp3Parts) {
      sanitizedParts.push(...(await stripId3TagsFromBlob(part, stripId3Tags)));
    }

    return new Blob(sanitizedParts, {
      type: "audio/mpeg",
    });
  } catch {
    const buffers = await Promise.all(
      mp3Parts.map(async (part) => new Uint8Array(await part.arrayBuffer())),
    );

    const sanitizedBuffers = buffers
      .map((buffer) => {
        if (stripId3Tags === "none") return buffer;
        if (stripId3Tags === "leading") return stripLeadingId3Tag(buffer);
        return stripAllId3Tags(buffer);
      })
      .filter((buffer) => buffer.length > 0);

    const combined = concatenateMp3Buffers(sanitizedBuffers);
    return new Blob([toArrayBuffer(combined)], {
      type: "audio/mpeg",
    });
  }
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
  options?: AddMp3MetadataToBlobOptions,
): Promise<Blob> => {
  const tag = buildMp3MetadataTag(metadata);
  if (!tag) return mp3Blob;
  const tagBuffer = new ArrayBuffer(tag.byteLength);
  new Uint8Array(tagBuffer).set(tag);

  const audioParts =
    options?.stripExistingId3Tags === false
      ? [mp3Blob]
      : await stripAllId3TagsFromBlob(mp3Blob);
  return new Blob([tagBuffer, ...audioParts], {
    type: mp3Blob.type || "audio/mpeg",
  });
};
