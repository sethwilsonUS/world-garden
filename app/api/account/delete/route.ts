import {
  auth,
  clerkClient,
  reverificationErrorResponse,
} from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  createMarkClerkDeletionAttestation,
  type AccountDeletionClerkOutcome,
} from "@/lib/account-deletion-attestation";
import { getServerAttestationSecret } from "@/lib/server-attestation";

const PRIVATE_NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store",
  Pragma: "no-cache",
  Expires: "0",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;
const MAX_REQUEST_BYTES = 256;
const CONFIRMATION_ERROR = 'Type "DELETE" exactly to confirm account deletion.';
const UNAVAILABLE_ERROR = "Account deletion is temporarily unavailable.";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

const jsonResponse = (body: unknown, status: number) =>
  NextResponse.json(body, { status, headers: PRIVATE_NO_STORE_HEADERS });

const hasAllowedOrigin = (request: NextRequest): boolean => {
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const origin = request.headers.get("origin");
  if (!origin) return fetchSite === "same-origin";

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
};

const readRequestTextWithLimit = async (request: Request): Promise<string> => {
  const declaredLength = request.headers.get("content-length")?.trim();
  if (
    declaredLength &&
    /^\d+$/u.test(declaredLength) &&
    Number(declaredLength) > MAX_REQUEST_BYTES
  ) {
    throw new Error("Account deletion request is too large");
  }

  if (!request.body) throw new Error("Account deletion body is required");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Account deletion request is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (byteLength === 0) {
    throw new Error("Account deletion body is required");
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};

const hasExactConfirmation = async (request: Request): Promise<boolean> => {
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readRequestTextWithLimit(request));
  } catch {
    return false;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }

  const body = parsed as Record<string, unknown>;
  return (
    Object.keys(body).length === 1 &&
    Object.hasOwn(body, "confirmation") &&
    body.confirmation === "DELETE"
  );
};

const withPrivateHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(PRIVATE_NO_STORE_HEADERS)) {
    headers.set(name, value);
  }
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const isClerkNotFoundError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "status" in error &&
  error.status === 404;

const safeErrorKind = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return typeof error;
  if ("status" in error && typeof error.status === "number") {
    return `status-${error.status}`;
  }
  return error instanceof Error ? error.name : "object";
};

const markDeletionOutcome = async ({
  requestId,
  clerkUserId,
  outcome,
}: {
  requestId: Id<"accountDeletionRequests">;
  clerkUserId: string;
  outcome: AccountDeletionClerkOutcome;
}) => {
  const attestation = await createMarkClerkDeletionAttestation({
    requestId,
    clerkUserId,
    outcome,
  });
  await fetchMutation(api.accountDeletion.markClerkDeletion, {
    requestId,
    clerkUserId,
    outcome,
    attestation,
  });
};

export const POST = async (request: NextRequest) => {
  if (!hasAllowedOrigin(request)) {
    return jsonResponse({ error: "Request not allowed" }, 403);
  }

  if (!(await hasExactConfirmation(request))) {
    return jsonResponse({ error: CONFIRMATION_ERROR }, 400);
  }

  let session: Awaited<ReturnType<typeof auth>>;
  try {
    session = await auth();
  } catch (error) {
    console.error(
      "[/api/account/delete] Clerk authentication failed",
      safeErrorKind(error),
    );
    return jsonResponse({ error: UNAVAILABLE_ERROR }, 503);
  }
  if (!session.isAuthenticated || !session.userId) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  let hasStrictReverification = false;
  try {
    hasStrictReverification = session.has({ reverification: "strict" });
  } catch (error) {
    console.error(
      "[/api/account/delete] Reverification check failed",
      safeErrorKind(error),
    );
    return jsonResponse({ error: UNAVAILABLE_ERROR }, 503);
  }
  if (!hasStrictReverification) {
    return withPrivateHeaders(reverificationErrorResponse("strict"));
  }

  const clerkUserId = session.userId;
  let convexToken: string | null;
  try {
    convexToken = await session.getToken({ template: "convex" });
  } catch (error) {
    console.error(
      "[/api/account/delete] Convex authentication failed",
      safeErrorKind(error),
    );
    return jsonResponse({ error: UNAVAILABLE_ERROR }, 503);
  }
  if (!convexToken) {
    return jsonResponse({ error: UNAVAILABLE_ERROR }, 503);
  }
  if (!getServerAttestationSecret()) {
    console.error("[/api/account/delete] Server attestation is not configured");
    return jsonResponse({ error: UNAVAILABLE_ERROR }, 503);
  }

  let requestId: Id<"accountDeletionRequests">;
  try {
    const initiation = await fetchMutation(
      api.accountDeletion.initiateAccountDeletion,
      { clerkUserId },
      { token: convexToken },
    );
    if (!initiation.requestId) {
      throw new Error("Account deletion initiation returned no request ID");
    }
    requestId = initiation.requestId;
  } catch (error) {
    console.error(
      "[/api/account/delete] Durable initiation failed",
      safeErrorKind(error),
    );
    return jsonResponse(
      { error: UNAVAILABLE_ERROR, outcome: "uncertain" },
      503,
    );
  }

  let clerkDeletionConfirmed = false;
  try {
    const client = await clerkClient();
    await client.users.deleteUser(clerkUserId);
    clerkDeletionConfirmed = true;
  } catch (error) {
    if (isClerkNotFoundError(error)) {
      clerkDeletionConfirmed = true;
    } else {
      console.error(
        "[/api/account/delete] Clerk deletion remains pending",
        safeErrorKind(error),
      );
    }
  }

  const outcome: AccountDeletionClerkOutcome = clerkDeletionConfirmed
    ? "deleted"
    : "retry";
  try {
    await markDeletionOutcome({
      requestId,
      clerkUserId,
      outcome,
    });
  } catch (error) {
    console.error(
      "[/api/account/delete] Deletion outcome persistence failed",
      safeErrorKind(error),
    );
  }

  return clerkDeletionConfirmed
    ? jsonResponse({ status: "deleted" }, 200)
    : jsonResponse({ status: "pending" }, 202);
};
