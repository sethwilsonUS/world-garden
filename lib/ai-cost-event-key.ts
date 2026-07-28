import { requireServerAttestationSecret } from "./server-attestation";

const encoder = new TextEncoder();
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

export const deriveOpaqueAiCostEventKey = async ({
  namespace,
  identityParts,
  secret = requireServerAttestationSecret(),
}: {
  namespace: string;
  identityParts: readonly string[];
  secret?: string;
}): Promise<string> => {
  if (!NAMESPACE_PATTERN.test(namespace) || identityParts.length === 0) {
    throw new Error("AI cost event-key identity is invalid.");
  }
  const crypto = globalThis.crypto;
  if (!crypto?.subtle) {
    throw new Error("Web Crypto is required for opaque AI cost event keys.");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(
      encoder.encode(
        JSON.stringify(["ai-cost-event-key:v1", namespace, identityParts]),
      ),
    ),
  );
  return `opaque:${namespace}:${toHex(signature)}`;
};
