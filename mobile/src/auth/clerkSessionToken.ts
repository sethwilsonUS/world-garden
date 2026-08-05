const MAX_CLERK_SESSION_TOKEN_LENGTH = 8_192;

const base64UrlValue = (characterCode: number): number => {
  if (characterCode >= 65 && characterCode <= 90) {
    return characterCode - 65;
  }

  if (characterCode >= 97 && characterCode <= 122) {
    return characterCode - 71;
  }

  if (characterCode >= 48 && characterCode <= 57) {
    return characterCode + 4;
  }

  if (characterCode === 45) {
    return 62;
  }

  if (characterCode === 95) {
    return 63;
  }

  return -1;
};

const decodeBase64Url = (segment: string): Uint8Array | null => {
  if (segment.length === 0 || segment.length % 4 === 1) {
    return null;
  }

  const sextets = new Uint8Array(segment.length);
  for (let index = 0; index < segment.length; index += 1) {
    const value = base64UrlValue(segment.charCodeAt(index));
    if (value < 0) {
      return null;
    }
    sextets[index] = value;
  }

  const remainder = sextets.length % 4;
  const finalSextet = sextets[sextets.length - 1];
  if (finalSextet === undefined) {
    return null;
  }
  if (
    (remainder === 2 && (finalSextet & 0b001111) !== 0) ||
    (remainder === 3 && (finalSextet & 0b000011) !== 0)
  ) {
    return null;
  }

  const decoded = new Uint8Array(Math.floor((segment.length * 6) / 8));
  let outputIndex = 0;
  let accumulator = 0;
  let availableBits = 0;

  for (const sextet of sextets) {
    accumulator = (accumulator << 6) | sextet;
    availableBits += 6;

    if (availableBits >= 8) {
      availableBits -= 8;
      decoded[outputIndex] = (accumulator >> availableBits) & 0xff;
      outputIndex += 1;
      accumulator &= (1 << availableBits) - 1;
    }
  }

  return decoded;
};

const decodeUtf8 = (bytes: Uint8Array): string | null => {
  let percentEncoded = "";
  for (const byte of bytes) {
    percentEncoded += `%${byte.toString(16).padStart(2, "0")}`;
  }

  try {
    return decodeURIComponent(percentEncoded);
  } catch (error: unknown) {
    void error;
    return null;
  }
};

const parseJsonObject = (bytes: Uint8Array): Record<string, unknown> | null => {
  const json = decodeUtf8(bytes);
  if (json === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(json);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (error: unknown) {
    void error;
    return null;
  }
};

/**
 * Checks only that a cached token belongs to the expected local Clerk identity.
 * The server remains responsible for signature verification and authorization.
 */
export const isClerkSessionTokenIdentityConsistent = (
  token: unknown,
  expectedUserId: unknown,
  expectedSessionId: unknown,
): boolean => {
  try {
    if (
      typeof token !== "string" ||
      token.length > MAX_CLERK_SESSION_TOKEN_LENGTH ||
      typeof expectedUserId !== "string" ||
      expectedUserId.length === 0 ||
      typeof expectedSessionId !== "string" ||
      expectedSessionId.length === 0
    ) {
      return false;
    }

    const segments = token.split(".");
    if (segments.length !== 3) {
      return false;
    }

    const [headerSegment, payloadSegment, signatureSegment] = segments;
    if (
      headerSegment === undefined ||
      headerSegment.length === 0 ||
      payloadSegment === undefined ||
      payloadSegment.length === 0 ||
      signatureSegment === undefined ||
      signatureSegment.length === 0
    ) {
      return false;
    }

    const headerBytes = decodeBase64Url(headerSegment);
    const payloadBytes = decodeBase64Url(payloadSegment);
    const signatureBytes = decodeBase64Url(signatureSegment);
    if (
      headerBytes === null ||
      payloadBytes === null ||
      signatureBytes === null ||
      parseJsonObject(headerBytes) === null
    ) {
      return false;
    }

    const payload = parseJsonObject(payloadBytes);
    return (
      payload !== null &&
      typeof payload.sub === "string" &&
      payload.sub === expectedUserId &&
      typeof payload.sid === "string" &&
      payload.sid === expectedSessionId
    );
  } catch (error: unknown) {
    void error;
    return false;
  }
};
