import { v } from "convex/values";
import {
  createServerAttestation,
  verifyServerAttestation,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "./server-attestation";
import {
  AI_COST_MAX_REPORT_RANGE_MS,
  aiCostServerAttestationValidator,
  aiCostStatementInputValidator,
  parseAiCostDay,
  parseAiCostStatementInput,
  type AiCostStatementInput,
} from "./ai-cost-ledger-contract";

export type AiCostReportRange = {
  fromDay: string;
  toDay: string;
};

export type AiCostCoverageEpochReset = {
  epochKey: string;
};

export const aiCostReportRangeValidator = v.object({
  fromDay: v.string(),
  toDay: v.string(),
});

export const aiCostCoverageEpochResetValidator = v.object({
  epochKey: v.string(),
});

export const aiCostOwnerAttestationValidator = aiCostServerAttestationValidator;
export { aiCostStatementInputValidator };

export const AI_COST_REPORT_ATTESTATION_SCOPE =
  "ai-cost-ledger:owner-report:v1";
export const AI_COST_STATEMENT_ATTESTATION_SCOPE =
  "ai-cost-ledger:owner-statement:v1";
export const AI_COST_COVERAGE_RESET_ATTESTATION_SCOPE =
  "ai-cost-ledger:owner-coverage-reset:v1";

const OPAQUE_EPOCH_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;

export const parseAiCostCoverageReset = (
  value: unknown,
): AiCostCoverageEpochReset => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Coverage epoch reset must be an object.");
  }
  if (Object.keys(value).some((key) => key !== "epochKey")) {
    throw new Error("Coverage epoch reset contains an unsupported field.");
  }
  const epochKey = (value as { epochKey?: unknown }).epochKey;
  if (
    typeof epochKey !== "string" ||
    !OPAQUE_EPOCH_KEY_PATTERN.test(epochKey)
  ) {
    throw new Error("epochKey must be a bounded opaque identifier.");
  }
  return { epochKey };
};

export const assertValidAiCostReportRange = (
  range: AiCostReportRange,
): { from: number; to: number } => {
  const from = parseAiCostDay(range.fromDay, "fromDay");
  const to = parseAiCostDay(range.toDay, "toDay");
  if (to <= from) {
    throw new Error("toDay must be after fromDay for a half-open range.");
  }
  if (to - from > AI_COST_MAX_REPORT_RANGE_MS) {
    throw new Error("AI cost report ranges cannot exceed 90 days.");
  }
  return { from, to };
};

export const getAiCostReportAttestationPayload = (
  range: AiCostReportRange,
): readonly ServerAttestationPayloadValue[] => [range.fromDay, range.toDay];

export const getAiCostStatementAttestationPayload = (
  statement: AiCostStatementInput,
): readonly ServerAttestationPayloadValue[] => [
  statement.statementKey,
  statement.provider,
  statement.serviceScope,
  statement.periodStartDay,
  statement.periodEndDay,
  statement.amountMicros,
  statement.currency,
  statement.source,
  statement.allocationMethod,
];

export const getAiCostCoverageResetAttestationPayload = (
  reset: AiCostCoverageEpochReset,
): readonly ServerAttestationPayloadValue[] => [reset.epochKey];

type AttestationOptions = {
  secret?: string;
  now?: number;
  nonce?: string;
};

const getOwnerSecret = (explicitSecret?: string): string => {
  const secret = explicitSecret ?? process.env.ANALYTICS_REPORT_SECRET?.trim();
  if (!secret) throw new Error("ANALYTICS_REPORT_SECRET is not configured.");
  return secret;
};

export const createAiCostReportAttestation = async (
  range: AiCostReportRange,
  options: AttestationOptions = {},
): Promise<ServerAttestation> => {
  assertValidAiCostReportRange(range);
  return await createServerAttestation({
    scope: AI_COST_REPORT_ATTESTATION_SCOPE,
    payload: getAiCostReportAttestationPayload(range),
    secret: getOwnerSecret(options.secret),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  });
};

export const createAiCostStatementAttestation = async (
  value: AiCostStatementInput,
  options: AttestationOptions = {},
): Promise<ServerAttestation> => {
  const statement = parseAiCostStatementInput(value);
  return await createServerAttestation({
    scope: AI_COST_STATEMENT_ATTESTATION_SCOPE,
    payload: getAiCostStatementAttestationPayload(statement),
    secret: getOwnerSecret(options.secret),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  });
};

export const createAiCostCoverageResetAttestation = async (
  value: AiCostCoverageEpochReset,
  options: AttestationOptions = {},
): Promise<ServerAttestation> => {
  const reset = parseAiCostCoverageReset(value);
  return await createServerAttestation({
    scope: AI_COST_COVERAGE_RESET_ATTESTATION_SCOPE,
    payload: getAiCostCoverageResetAttestationPayload(reset),
    secret: getOwnerSecret(options.secret),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  });
};

export const verifyAiCostReportAttestation = async ({
  range,
  attestation,
  secret = process.env.ANALYTICS_REPORT_SECRET?.trim(),
  now,
}: {
  range: AiCostReportRange;
  attestation: ServerAttestation | undefined;
  secret?: string;
  now?: number;
}): Promise<boolean> => {
  try {
    assertValidAiCostReportRange(range);
  } catch {
    return false;
  }
  return await verifyServerAttestation({
    attestation,
    scope: AI_COST_REPORT_ATTESTATION_SCOPE,
    payload: getAiCostReportAttestationPayload(range),
    secret,
    ...(now === undefined ? {} : { now }),
  });
};

export const verifyAiCostStatementAttestation = async ({
  statement: value,
  attestation,
  secret = process.env.ANALYTICS_REPORT_SECRET?.trim(),
  now,
}: {
  statement: AiCostStatementInput;
  attestation: ServerAttestation | undefined;
  secret?: string;
  now?: number;
}): Promise<boolean> => {
  let statement: AiCostStatementInput;
  try {
    statement = parseAiCostStatementInput(value);
  } catch {
    return false;
  }
  return await verifyServerAttestation({
    attestation,
    scope: AI_COST_STATEMENT_ATTESTATION_SCOPE,
    payload: getAiCostStatementAttestationPayload(statement),
    secret,
    ...(now === undefined ? {} : { now }),
  });
};

export const verifyAiCostCoverageResetAttestation = async ({
  reset: value,
  attestation,
  secret = process.env.ANALYTICS_REPORT_SECRET?.trim(),
  now,
}: {
  reset: AiCostCoverageEpochReset;
  attestation: ServerAttestation | undefined;
  secret?: string;
  now?: number;
}): Promise<boolean> => {
  let reset: AiCostCoverageEpochReset;
  try {
    reset = parseAiCostCoverageReset(value);
  } catch {
    return false;
  }
  return await verifyServerAttestation({
    attestation,
    scope: AI_COST_COVERAGE_RESET_ATTESTATION_SCOPE,
    payload: getAiCostCoverageResetAttestationPayload(reset),
    secret,
    ...(now === undefined ? {} : { now }),
  });
};
