export const PRODUCT_FEEDBACK_KINDS = [
  "accessibility",
  "product",
  "technical",
  "other",
] as const;

export type ProductFeedbackKind = (typeof PRODUCT_FEEDBACK_KINDS)[number];

export type ProductFeedbackInput = {
  kind: ProductFeedbackKind;
  message: string;
  environment?: string;
  contactEmail?: string;
  researchOptIn: boolean;
  articleTitle?: string;
  articleSlug?: string;
  articleRevisionId?: string;
};

type Environment = Record<string, string | undefined>;

export const MAX_PRODUCT_FEEDBACK_MESSAGE_BYTES = 4_000;
export const MAX_PRODUCT_FEEDBACK_ENVIRONMENT_BYTES = 1_000;
export const MAX_PRODUCT_FEEDBACK_CONTACT_EMAIL_BYTES = 254;
export const MAX_PRODUCT_FEEDBACK_ARTICLE_TITLE_BYTES = 512;
export const MAX_PRODUCT_FEEDBACK_ARTICLE_SLUG_BYTES = 768;
export const MAX_PRODUCT_FEEDBACK_ARTICLE_REVISION_ID_DIGITS = 20;
const ALLOWED_FIELDS = new Set([
  "kind",
  "message",
  "environment",
  "contactEmail",
  "researchOptIn",
  "articleTitle",
  "articleSlug",
  "articleRevisionId",
]);
const encoder = new TextEncoder();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const utf8Length = (value: string): number => encoder.encode(value).byteLength;

const normalizeLineEndings = (value: string): string =>
  value.replace(/\r\n?/g, "\n").trim();

const hasUnsupportedControls = (value: string): boolean =>
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value);

const normalizeRequiredText = (
  value: unknown,
  label: string,
  maxBytes: number,
): string => {
  if (typeof value !== "string") {
    throw new Error(`${label} is required`);
  }
  const normalized = normalizeLineEndings(value);
  if (!normalized) throw new Error(`${label} is required`);
  if (hasUnsupportedControls(normalized)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  if (utf8Length(normalized) > maxBytes) {
    throw new Error(`${label} is too long`);
  }
  return normalized;
};

const normalizeOptionalText = (
  value: unknown,
  label: string,
  maxBytes: number,
): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${label} is invalid`);
  const normalized = normalizeLineEndings(value);
  if (!normalized) return undefined;
  if (hasUnsupportedControls(normalized)) {
    throw new Error(`${label} contains unsupported characters`);
  }
  if (utf8Length(normalized) > maxBytes) {
    throw new Error(`${label} is too long`);
  }
  return normalized;
};

const normalizeContactEmail = (value: unknown): string | undefined => {
  const email = normalizeOptionalText(
    value,
    "Contact email",
    MAX_PRODUCT_FEEDBACK_CONTACT_EMAIL_BYTES,
  );
  if (!email) return undefined;
  if (
    !/^[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(email) ||
    email.includes("..")
  ) {
    throw new Error("Contact email is invalid");
  }
  return email;
};

const normalizeArticleText = (
  value: unknown,
  label: string,
  maxBytes: number,
): string | undefined => {
  const normalized = normalizeOptionalText(value, label, maxBytes);
  if (normalized && /[\n\t\u2028\u2029]/u.test(normalized)) {
    throw new Error(`${label} must be a single line`);
  }
  return normalized;
};

const normalizeArticleRevisionId = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new Error("Article revision ID is invalid");
  }
  const revisionId = value.trim();
  if (!revisionId) return undefined;
  if (
    !/^\d+$/u.test(revisionId) ||
    revisionId.length > MAX_PRODUCT_FEEDBACK_ARTICLE_REVISION_ID_DIGITS
  ) {
    throw new Error("Article revision ID is invalid");
  }
  return revisionId;
};

export const normalizeProductFeedbackInput = (
  value: unknown,
): ProductFeedbackInput => {
  if (!isRecord(value)) throw new Error("Feedback must be a JSON object");

  const unexpectedField = Object.keys(value).find(
    (field) => !ALLOWED_FIELDS.has(field),
  );
  if (unexpectedField) throw new Error("Unexpected feedback field");

  if (
    typeof value.kind !== "string" ||
    !PRODUCT_FEEDBACK_KINDS.includes(value.kind as ProductFeedbackKind)
  ) {
    throw new Error("Feedback kind is invalid");
  }
  if (typeof value.researchOptIn !== "boolean") {
    throw new Error("Research choice is invalid");
  }

  const contactEmail = normalizeContactEmail(value.contactEmail);
  if (value.researchOptIn && !contactEmail) {
    throw new Error("Contact email is required for research volunteers");
  }
  const normalizedEnvironment = normalizeOptionalText(
    value.environment,
    "Environment",
    MAX_PRODUCT_FEEDBACK_ENVIRONMENT_BYTES,
  );
  const articleTitle = normalizeArticleText(
    value.articleTitle,
    "Article title",
    MAX_PRODUCT_FEEDBACK_ARTICLE_TITLE_BYTES,
  );
  const articleSlug = normalizeArticleText(
    value.articleSlug,
    "Article slug",
    MAX_PRODUCT_FEEDBACK_ARTICLE_SLUG_BYTES,
  );
  const articleRevisionId = normalizeArticleRevisionId(value.articleRevisionId);
  if (!articleTitle || !articleSlug) {
    if (articleTitle || articleSlug || articleRevisionId) {
      throw new Error("Article title and slug are required together");
    }
  }

  return {
    kind: value.kind as ProductFeedbackKind,
    message: normalizeRequiredText(
      value.message,
      "Message",
      MAX_PRODUCT_FEEDBACK_MESSAGE_BYTES,
    ),
    ...(normalizedEnvironment ? { environment: normalizedEnvironment } : {}),
    ...(contactEmail ? { contactEmail } : {}),
    researchOptIn: value.researchOptIn,
    ...(articleTitle && articleSlug
      ? {
          articleTitle,
          articleSlug,
          ...(articleRevisionId ? { articleRevisionId } : {}),
        }
      : {}),
  };
};

export const getProductFeedbackWriteSecret = (
  environment: Environment = process.env,
): string | null => environment.PRODUCT_FEEDBACK_WRITE_SECRET?.trim() || null;

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

export const buildProductFeedbackRateLimitKey = async (
  ipAddress: string | null,
  secret: string,
): Promise<string> => {
  if (!secret.trim()) throw new Error("Feedback rate-limit secret is missing");
  const clientAddress = ipAddress?.trim();
  if (!clientAddress) {
    throw new Error("Feedback rate-limit client address is missing");
  }
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(encoder.encode(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(encoder.encode(clientAddress)),
  );
  return `route-quota:product-feedback:${toHex(digest)}`;
};

const constantTimeEqual = (left: string, right: string): boolean => {
  let mismatch = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |=
      (index < left.length ? left.charCodeAt(index) : 0) ^
      (index < right.length ? right.charCodeAt(index) : 0);
  }
  return mismatch === 0;
};

export const assertProductFeedbackWriteAuthorized = (
  providedSecret: string,
  environment: Environment = process.env,
): void => {
  const expectedSecret = getProductFeedbackWriteSecret(environment);
  if (!expectedSecret) {
    throw new Error(
      "PRODUCT_FEEDBACK_WRITE_SECRET is not configured in Convex",
    );
  }
  if (!constantTimeEqual(providedSecret, expectedSecret)) {
    throw new Error("Unauthorized");
  }
};
