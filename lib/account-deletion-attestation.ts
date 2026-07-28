import { v } from "convex/values";
import {
  createServerAttestation,
  requireServerAttestationSecret,
  verifyServerAttestation,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "./server-attestation";

export const ACCOUNT_DELETION_LIST_PENDING_SCOPE =
  "account-deletion:list-pending-clerk";
export const ACCOUNT_DELETION_MARK_CLERK_SCOPE = "account-deletion:mark-clerk";
export const ACCOUNT_DELETION_RECONCILE_CLERK_SCOPE =
  "account-deletion:reconcile-clerk";
export const MAX_PENDING_CLERK_DELETION_LIMIT = 100;

export const accountDeletionAttestationValidator = v.object({
  issuedAt: v.number(),
  expiresAt: v.number(),
  nonce: v.string(),
  signature: v.string(),
});

export type AccountDeletionClerkOutcome = "deleted" | "retry";

export type ListPendingClerkDeletionsIdentity = {
  limit: number;
};

export type MarkClerkDeletionIdentity = {
  requestId: string;
  clerkUserId: string;
  outcome: AccountDeletionClerkOutcome;
};

export type ReconcileClerkDeletionIdentity = {
  clerkUserId: string;
  clerkUserExists: boolean;
};

type VerificationOptions = {
  attestation: ServerAttestation | undefined;
  secret?: string;
  now?: number;
};

const isBoundedIdentity = (value: string): boolean =>
  value.length > 0 && value.length <= 512 && value.trim() === value;

export const isValidPendingClerkDeletionLimit = (limit: number): boolean =>
  Number.isSafeInteger(limit) &&
  limit >= 1 &&
  limit <= MAX_PENDING_CLERK_DELETION_LIMIT;

export const buildListPendingClerkDeletionsAttestationPayload = ({
  limit,
}: ListPendingClerkDeletionsIdentity): readonly ServerAttestationPayloadValue[] => [
  limit,
];

export const buildMarkClerkDeletionAttestationPayload = ({
  requestId,
  clerkUserId,
  outcome,
}: MarkClerkDeletionIdentity): readonly ServerAttestationPayloadValue[] => [
  requestId,
  clerkUserId,
  outcome,
];

export const buildReconcileClerkDeletionAttestationPayload = ({
  clerkUserId,
  clerkUserExists,
}: ReconcileClerkDeletionIdentity): readonly ServerAttestationPayloadValue[] => [
  clerkUserId,
  clerkUserExists,
];

export const createListPendingClerkDeletionsAttestation = async (
  identity: ListPendingClerkDeletionsIdentity,
): Promise<ServerAttestation> => {
  if (!isValidPendingClerkDeletionLimit(identity.limit)) {
    throw new Error("Invalid pending Clerk deletion limit");
  }
  return await createServerAttestation({
    scope: ACCOUNT_DELETION_LIST_PENDING_SCOPE,
    payload: buildListPendingClerkDeletionsAttestationPayload(identity),
    secret: requireServerAttestationSecret(),
  });
};

export const createMarkClerkDeletionAttestation = async (
  identity: MarkClerkDeletionIdentity,
): Promise<ServerAttestation> => {
  if (
    !isBoundedIdentity(identity.requestId) ||
    !isBoundedIdentity(identity.clerkUserId)
  ) {
    throw new Error("Invalid Clerk deletion identity");
  }
  return await createServerAttestation({
    scope: ACCOUNT_DELETION_MARK_CLERK_SCOPE,
    payload: buildMarkClerkDeletionAttestationPayload(identity),
    secret: requireServerAttestationSecret(),
  });
};

export const createReconcileClerkDeletionAttestation = async (
  identity: ReconcileClerkDeletionIdentity,
): Promise<ServerAttestation> => {
  if (!isBoundedIdentity(identity.clerkUserId)) {
    throw new Error("Invalid Clerk deletion identity");
  }
  return await createServerAttestation({
    scope: ACCOUNT_DELETION_RECONCILE_CLERK_SCOPE,
    payload: buildReconcileClerkDeletionAttestationPayload(identity),
    secret: requireServerAttestationSecret(),
  });
};

const resolveVerificationSecret = (options: VerificationOptions) =>
  Object.prototype.hasOwnProperty.call(options, "secret")
    ? options.secret
    : process.env.TTS_QUOTA_BYPASS_SECRET?.trim() || undefined;

export const verifyListPendingClerkDeletionsAttestation = async (
  options: ListPendingClerkDeletionsIdentity & VerificationOptions,
): Promise<boolean> => {
  const identity = { limit: options.limit };
  return (
    isValidPendingClerkDeletionLimit(identity.limit) &&
    (await verifyServerAttestation({
      attestation: options.attestation,
      scope: ACCOUNT_DELETION_LIST_PENDING_SCOPE,
      payload: buildListPendingClerkDeletionsAttestationPayload(identity),
      secret: resolveVerificationSecret(options),
      ...(options.now === undefined ? {} : { now: options.now }),
    }))
  );
};

export const verifyMarkClerkDeletionAttestation = async (
  options: MarkClerkDeletionIdentity & VerificationOptions,
): Promise<boolean> => {
  const identity = {
    requestId: options.requestId,
    clerkUserId: options.clerkUserId,
    outcome: options.outcome,
  };
  return (
    isBoundedIdentity(identity.requestId) &&
    isBoundedIdentity(identity.clerkUserId) &&
    (await verifyServerAttestation({
      attestation: options.attestation,
      scope: ACCOUNT_DELETION_MARK_CLERK_SCOPE,
      payload: buildMarkClerkDeletionAttestationPayload(identity),
      secret: resolveVerificationSecret(options),
      ...(options.now === undefined ? {} : { now: options.now }),
    }))
  );
};

export const verifyReconcileClerkDeletionAttestation = async (
  options: ReconcileClerkDeletionIdentity & VerificationOptions,
): Promise<boolean> => {
  const identity = {
    clerkUserId: options.clerkUserId,
    clerkUserExists: options.clerkUserExists,
  };
  return (
    isBoundedIdentity(identity.clerkUserId) &&
    (await verifyServerAttestation({
      attestation: options.attestation,
      scope: ACCOUNT_DELETION_RECONCILE_CLERK_SCOPE,
      payload: buildReconcileClerkDeletionAttestationPayload(identity),
      secret: resolveVerificationSecret(options),
      ...(options.now === undefined ? {} : { now: options.now }),
    }))
  );
};
