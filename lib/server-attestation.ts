export type ServerAttestation = {
  issuedAt: number;
  expiresAt: number;
  nonce: string;
  signature: string;
};

export type ServerAttestationPayloadValue = string | number | boolean | null;

const ATTESTATION_VERSION = 1;
const DEFAULT_ATTESTATION_TTL_MS = 60_000;
const MAX_ATTESTATION_TTL_MS = 5 * 60_000;
const MAX_CLOCK_SKEW_MS = 30_000;
const encoder = new TextEncoder();

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const getCrypto = (): Crypto => {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error("Web Crypto is required for server attestations.");
  }
  return crypto;
};

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

const fromHex = (value: string): Uint8Array | null => {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
};

const buildMessage = ({
  scope,
  payload,
  issuedAt,
  expiresAt,
  nonce,
}: {
  scope: string;
  payload: readonly ServerAttestationPayloadValue[];
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}): Uint8Array =>
  encoder.encode(
    JSON.stringify([
      ATTESTATION_VERSION,
      scope,
      issuedAt,
      expiresAt,
      nonce,
      payload,
    ]),
  );

const importHmacKey = async (
  secret: string,
  usage: "sign" | "verify",
): Promise<CryptoKey> =>
  await getCrypto().subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );

const createNonce = (): string => {
  const crypto = getCrypto();
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
};

export const getServerAttestationSecret = (): string | undefined =>
  process.env.TTS_QUOTA_BYPASS_SECRET?.trim() || undefined;

export const requireServerAttestationSecret = (): string => {
  const secret = getServerAttestationSecret();
  if (!secret) {
    throw new Error(
      "TTS_QUOTA_BYPASS_SECRET must be configured in both Next.js and Convex for trusted server operations.",
    );
  }
  return secret;
};

export const createServerAttestation = async ({
  scope,
  payload,
  secret,
  now = Date.now(),
  ttlMs = DEFAULT_ATTESTATION_TTL_MS,
  nonce = createNonce(),
}: {
  scope: string;
  payload: readonly ServerAttestationPayloadValue[];
  secret: string;
  now?: number;
  ttlMs?: number;
  nonce?: string;
}): Promise<ServerAttestation> => {
  const issuedAt = now;
  const expiresAt = now + ttlMs;
  const message = buildMessage({
    scope,
    payload,
    issuedAt,
    expiresAt,
    nonce,
  });
  const key = await importHmacKey(secret, "sign");
  const signature = await getCrypto().subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(message),
  );

  return { issuedAt, expiresAt, nonce, signature: toHex(signature) };
};

export const verifyServerAttestation = async ({
  attestation,
  scope,
  payload,
  secret,
  now = Date.now(),
}: {
  attestation: ServerAttestation | undefined;
  scope: string;
  payload: readonly ServerAttestationPayloadValue[];
  secret: string | undefined;
  now?: number;
}): Promise<boolean> => {
  if (!attestation || !secret) return false;

  const { issuedAt, expiresAt, nonce, signature } = attestation;
  if (
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > MAX_ATTESTATION_TTL_MS ||
    issuedAt > now + MAX_CLOCK_SKEW_MS ||
    expiresAt <= now ||
    !nonce ||
    nonce.length > 200
  ) {
    return false;
  }

  const signatureBytes = fromHex(signature);
  if (!signatureBytes) return false;

  try {
    const key = await importHmacKey(secret, "verify");
    return await getCrypto().subtle.verify(
      "HMAC",
      key,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(
        buildMessage({ scope, payload, issuedAt, expiresAt, nonce }),
      ),
    );
  } catch {
    return false;
  }
};
