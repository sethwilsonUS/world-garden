import { v, type Infer } from "convex/values";
import {
  createServerAttestation,
  verifyServerAttestation,
  type ServerAttestation,
  type ServerAttestationPayloadValue,
} from "./server-attestation";

export const AI_COST_LEDGER_MODES = ["off", "observe"] as const;
export type AiCostLedgerMode = (typeof AI_COST_LEDGER_MODES)[number];

export const AI_COST_PROVIDERS = ["openai", "edge"] as const;
export type AiCostProvider = (typeof AI_COST_PROVIDERS)[number];

export const AI_COST_OPERATIONS = [
  "tts",
  "article_context_generation",
  "trending_brief_research",
  "trending_brief_writing",
] as const;
export type AiCostOperation = (typeof AI_COST_OPERATIONS)[number];

export const AI_COST_SOURCES = [
  "interactive_article",
  "article_audio_export",
  "personal_playlist",
  "featured_podcast",
  "trending_podcast",
  "picture_of_day",
  "featured_audio_warm",
  "article_context",
  "trending_brief",
  "background_generation",
  "unknown",
] as const;
export type AiCostSource = (typeof AI_COST_SOURCES)[number];

export const AI_COST_ATTEMPT_STATES = [
  "succeeded",
  "failed_before_dispatch",
  "failed_after_dispatch",
  "unknown_after_dispatch",
] as const;
export type AiCostAttemptState = (typeof AI_COST_ATTEMPT_STATES)[number];

export const AI_COST_FAILURE_CATEGORIES = [
  "configuration",
  "validation",
  "quota",
  "timeout",
  "network",
  "provider_http_4xx",
  "provider_http_5xx",
  "empty_response",
  "invalid_response",
  "aborted",
  "unknown",
] as const;
export type AiCostFailureCategory = (typeof AI_COST_FAILURE_CATEGORIES)[number];

export const AI_COST_DURATION_MEASUREMENTS = [
  "measured",
  "estimated",
  "unknown",
] as const;
export type AiCostDurationMeasurement =
  (typeof AI_COST_DURATION_MEASUREMENTS)[number];

export const AI_COST_SERVICE_TIERS = [
  "default",
  "auto",
  "flex",
  "priority",
  "scale",
  "unknown",
] as const;
export type AiCostServiceTier = (typeof AI_COST_SERVICE_TIERS)[number];

export const AI_COST_STATEMENT_SERVICE_SCOPES = [
  "all_direct_ai",
  "responses",
  "speech",
  "web_search",
] as const;
export type AiCostStatementServiceScope =
  (typeof AI_COST_STATEMENT_SERVICE_SCOPES)[number];

export const AI_COST_STATEMENT_SOURCES = [
  "provider_costs_api",
  "invoice_total",
  "manual_entry",
] as const;
export type AiCostStatementSource = (typeof AI_COST_STATEMENT_SOURCES)[number];

export const AI_COST_ALLOCATION_METHODS = [
  "unallocated",
  "estimated_cost_weight",
  "input_tokens",
  "input_characters",
  "web_search_calls",
] as const;
export type AiCostAllocationMethod =
  (typeof AI_COST_ALLOCATION_METHODS)[number];

export const AI_COST_GENERATION_USE_STATES = [
  "awaiting_observation",
  "observed_meaningful_use",
  "no_observed_meaningful_use",
  "external_consumption_unknown",
] as const;
export type AiCostGenerationUseState =
  (typeof AI_COST_GENERATION_USE_STATES)[number];

export const AI_COST_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
export const AI_COST_OBSERVATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
export const AI_COST_MAX_REPORT_RANGE_MS = 90 * 24 * 60 * 60 * 1_000;
// Exact reconciliation can select at most three service scopes for each of the
// two bounded providers. This deliberately generous $1B cap keeps even that
// six-statement total below Number.MAX_SAFE_INTEGER micros.
export const AI_COST_MAX_STATEMENT_AMOUNT_MICROS = 1_000_000_000_000_000;

export const aiCostProviderValidator = v.union(
  v.literal("openai"),
  v.literal("edge"),
);

export const aiCostOperationValidator = v.union(
  v.literal("tts"),
  v.literal("article_context_generation"),
  v.literal("trending_brief_research"),
  v.literal("trending_brief_writing"),
);

export const aiCostSourceValidator = v.union(
  v.literal("interactive_article"),
  v.literal("article_audio_export"),
  v.literal("personal_playlist"),
  v.literal("featured_podcast"),
  v.literal("trending_podcast"),
  v.literal("picture_of_day"),
  v.literal("featured_audio_warm"),
  v.literal("article_context"),
  v.literal("trending_brief"),
  v.literal("background_generation"),
  v.literal("unknown"),
);

export const aiCostAttemptStateValidator = v.union(
  v.literal("succeeded"),
  v.literal("failed_before_dispatch"),
  v.literal("failed_after_dispatch"),
  v.literal("unknown_after_dispatch"),
);

export const aiCostFailureCategoryValidator = v.union(
  v.literal("configuration"),
  v.literal("validation"),
  v.literal("quota"),
  v.literal("timeout"),
  v.literal("network"),
  v.literal("provider_http_4xx"),
  v.literal("provider_http_5xx"),
  v.literal("empty_response"),
  v.literal("invalid_response"),
  v.literal("aborted"),
  v.literal("unknown"),
);

export const aiCostDurationMeasurementValidator = v.union(
  v.literal("measured"),
  v.literal("estimated"),
  v.literal("unknown"),
);

export const aiCostServiceTierValidator = v.union(
  v.literal("default"),
  v.literal("auto"),
  v.literal("flex"),
  v.literal("priority"),
  v.literal("scale"),
  v.literal("unknown"),
);

export const aiCostGenerationUseStateValidator = v.union(
  v.literal("awaiting_observation"),
  v.literal("observed_meaningful_use"),
  v.literal("no_observed_meaningful_use"),
  v.literal("external_consumption_unknown"),
);

export const aiCostServerAttestationValidator = v.object({
  issuedAt: v.number(),
  expiresAt: v.number(),
  nonce: v.string(),
  signature: v.string(),
});

export const aiCostProviderAttemptValidator = v.object({
  eventKey: v.string(),
  correlationId: v.string(),
  lifecycleVersion: v.number(),
  operation: aiCostOperationValidator,
  source: aiCostSourceValidator,
  requestedProvider: aiCostProviderValidator,
  effectiveProvider: aiCostProviderValidator,
  model: v.union(v.string(), v.null()),
  serviceTier: v.union(aiCostServiceTierValidator, v.null()),
  profile: v.union(v.string(), v.null()),
  state: aiCostAttemptStateValidator,
  failureCategory: v.union(aiCostFailureCategoryValidator, v.null()),
  dispatchedAt: v.union(v.number(), v.null()),
  completedAt: v.union(v.number(), v.null()),
  inputCharacters: v.union(v.number(), v.null()),
  inputWords: v.union(v.number(), v.null()),
  inputTokens: v.union(v.number(), v.null()),
  cachedInputTokens: v.union(v.number(), v.null()),
  cacheWriteInputTokens: v.union(v.number(), v.null()),
  outputTokens: v.union(v.number(), v.null()),
  reasoningOutputTokens: v.union(v.number(), v.null()),
  audioInputTokens: v.union(v.number(), v.null()),
  audioOutputTokens: v.union(v.number(), v.null()),
  webSearchCalls: v.union(v.number(), v.null()),
  responseAudioBytes: v.union(v.number(), v.null()),
  audioDurationMs: v.union(v.number(), v.null()),
  durationMeasurement: aiCostDurationMeasurementValidator,
  isFallbackAttempt: v.boolean(),
});

export type AiCostProviderAttempt = Infer<
  typeof aiCostProviderAttemptValidator
>;

export const aiCostStatementInputValidator = v.object({
  statementKey: v.string(),
  provider: aiCostProviderValidator,
  serviceScope: v.union(
    v.literal("all_direct_ai"),
    v.literal("responses"),
    v.literal("speech"),
    v.literal("web_search"),
  ),
  periodStartDay: v.string(),
  periodEndDay: v.string(),
  amountMicros: v.number(),
  currency: v.literal("USD"),
  source: v.union(
    v.literal("provider_costs_api"),
    v.literal("invoice_total"),
    v.literal("manual_entry"),
  ),
  allocationMethod: v.union(
    v.literal("unallocated"),
    v.literal("estimated_cost_weight"),
    v.literal("input_tokens"),
    v.literal("input_characters"),
    v.literal("web_search_calls"),
  ),
});

export type AiCostStatementInput = Infer<typeof aiCostStatementInputValidator>;

type Environment = Record<string, string | undefined>;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const OPAQUE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,119}$/;
const PROVIDER_ATTEMPT_KEYS = new Set([
  "eventKey",
  "correlationId",
  "lifecycleVersion",
  "operation",
  "source",
  "requestedProvider",
  "effectiveProvider",
  "model",
  "serviceTier",
  "profile",
  "state",
  "failureCategory",
  "dispatchedAt",
  "completedAt",
  "inputCharacters",
  "inputWords",
  "inputTokens",
  "cachedInputTokens",
  "cacheWriteInputTokens",
  "outputTokens",
  "reasoningOutputTokens",
  "audioInputTokens",
  "audioOutputTokens",
  "webSearchCalls",
  "responseAudioBytes",
  "audioDurationMs",
  "durationMeasurement",
  "isFallbackAttempt",
]);

const isMember = <T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] => typeof value === "string" && values.includes(value);

const assertSafeNonNegativeIntegerOrNull = (
  value: number | null,
  field: string,
): void => {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${field} must be a non-negative safe integer or null.`);
  }
};

const parseUtcDay = (value: string, field: string): number => {
  if (!DAY_PATTERN.test(value)) {
    throw new Error(`${field} must use YYYY-MM-DD UTC format.`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${field} must be a real UTC calendar day.`);
  }
  return timestamp;
};

export const parseAiCostDay = (value: string, field = "day"): number =>
  parseUtcDay(value, field);

export const getAiCostLedgerMode = (
  environment: Environment = process.env,
): AiCostLedgerMode =>
  environment.AI_COST_LEDGER_MODE?.trim() === "observe" ? "observe" : "off";

export const assertValidAiCostProviderAttempt = (
  attempt: AiCostProviderAttempt,
): void => {
  if (Object.keys(attempt).some((key) => !PROVIDER_ATTEMPT_KEYS.has(key))) {
    throw new Error("Provider attempt contains an unsupported field.");
  }
  if (!OPAQUE_KEY_PATTERN.test(attempt.eventKey)) {
    throw new Error("eventKey must be a bounded opaque identifier.");
  }
  if (!OPAQUE_KEY_PATTERN.test(attempt.correlationId)) {
    throw new Error("correlationId must be a bounded opaque identifier.");
  }
  if (
    !Number.isSafeInteger(attempt.lifecycleVersion) ||
    attempt.lifecycleVersion < 0
  ) {
    throw new Error("lifecycleVersion must be a non-negative safe integer.");
  }
  if (
    attempt.lifecycleVersion === 0 &&
    attempt.state !== "unknown_after_dispatch"
  ) {
    throw new Error("lifecycle version zero must be unknown_after_dispatch.");
  }
  for (const [field, value] of [
    ["model", attempt.model],
    ["profile", attempt.profile],
  ] as const) {
    if (
      value !== null &&
      (value.startsWith("/") ||
        value.includes("://") ||
        !SAFE_IDENTIFIER_PATTERN.test(value))
    ) {
      throw new Error(
        `${field} must be a bounded provider identifier or null.`,
      );
    }
  }
  for (const [field, value] of [
    ["dispatchedAt", attempt.dispatchedAt],
    ["completedAt", attempt.completedAt],
    ["inputCharacters", attempt.inputCharacters],
    ["inputWords", attempt.inputWords],
    ["inputTokens", attempt.inputTokens],
    ["cachedInputTokens", attempt.cachedInputTokens],
    ["cacheWriteInputTokens", attempt.cacheWriteInputTokens],
    ["outputTokens", attempt.outputTokens],
    ["reasoningOutputTokens", attempt.reasoningOutputTokens],
    ["audioInputTokens", attempt.audioInputTokens],
    ["audioOutputTokens", attempt.audioOutputTokens],
    ["webSearchCalls", attempt.webSearchCalls],
    ["responseAudioBytes", attempt.responseAudioBytes],
    ["audioDurationMs", attempt.audioDurationMs],
  ] as const) {
    assertSafeNonNegativeIntegerOrNull(value, field);
  }
  if (
    attempt.state === "failed_before_dispatch" &&
    attempt.dispatchedAt !== null
  ) {
    throw new Error("failed_before_dispatch cannot have dispatchedAt.");
  }
  if (
    attempt.state !== "failed_before_dispatch" &&
    attempt.dispatchedAt === null
  ) {
    throw new Error("after-dispatch attempts require dispatchedAt.");
  }
  if (
    attempt.dispatchedAt !== null &&
    attempt.completedAt !== null &&
    attempt.completedAt < attempt.dispatchedAt
  ) {
    throw new Error("completedAt cannot precede dispatchedAt.");
  }
  if (attempt.state === "succeeded" && attempt.failureCategory !== null) {
    throw new Error("succeeded attempts cannot have a failure category.");
  }
  if (
    attempt.audioDurationMs === null &&
    attempt.durationMeasurement !== "unknown"
  ) {
    throw new Error("missing audio duration must use unknown measurement.");
  }
  if (
    attempt.audioDurationMs !== null &&
    attempt.durationMeasurement === "unknown"
  ) {
    throw new Error(
      "known audio duration requires measured or estimated quality.",
    );
  }
};

export const AI_COST_PROVIDER_ATTEMPT_ATTESTATION_SCOPE =
  "ai-cost-ledger:provider-attempt:v1";

export const getAiCostProviderAttemptAttestationPayload = (
  attempt: AiCostProviderAttempt,
): readonly ServerAttestationPayloadValue[] => [
  attempt.eventKey,
  attempt.correlationId,
  attempt.lifecycleVersion,
  attempt.operation,
  attempt.source,
  attempt.requestedProvider,
  attempt.effectiveProvider,
  attempt.model,
  attempt.serviceTier,
  attempt.profile,
  attempt.state,
  attempt.failureCategory,
  attempt.dispatchedAt,
  attempt.completedAt,
  attempt.inputCharacters,
  attempt.inputWords,
  attempt.inputTokens,
  attempt.cachedInputTokens,
  attempt.cacheWriteInputTokens,
  attempt.outputTokens,
  attempt.reasoningOutputTokens,
  attempt.audioInputTokens,
  attempt.audioOutputTokens,
  attempt.webSearchCalls,
  attempt.responseAudioBytes,
  attempt.audioDurationMs,
  attempt.durationMeasurement,
  attempt.isFallbackAttempt,
];

const requireSecret = (
  name: "TTS_QUOTA_BYPASS_SECRET" | "ANALYTICS_REPORT_SECRET",
  environment: Environment,
): string => {
  const secret = environment[name]?.trim();
  if (!secret) throw new Error(`${name} is not configured.`);
  return secret;
};

export const createAiCostProviderAttemptAttestation = async (
  attempt: AiCostProviderAttempt,
  options: {
    secret?: string;
    now?: number;
    nonce?: string;
  } = {},
): Promise<ServerAttestation> => {
  assertValidAiCostProviderAttempt(attempt);
  const secret =
    options.secret ?? requireSecret("TTS_QUOTA_BYPASS_SECRET", process.env);
  return await createServerAttestation({
    scope: AI_COST_PROVIDER_ATTEMPT_ATTESTATION_SCOPE,
    payload: getAiCostProviderAttemptAttestationPayload(attempt),
    secret,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.nonce === undefined ? {} : { nonce: options.nonce }),
  });
};

export const verifyAiCostProviderAttemptAttestation = async ({
  attempt,
  attestation,
  secret = process.env.TTS_QUOTA_BYPASS_SECRET?.trim(),
  now,
}: {
  attempt: AiCostProviderAttempt;
  attestation: ServerAttestation | undefined;
  secret?: string;
  now?: number;
}): Promise<boolean> => {
  try {
    assertValidAiCostProviderAttempt(attempt);
  } catch {
    return false;
  }
  return await verifyServerAttestation({
    attestation,
    scope: AI_COST_PROVIDER_ATTEMPT_ATTESTATION_SCOPE,
    payload: getAiCostProviderAttemptAttestationPayload(attempt),
    secret,
    ...(now === undefined ? {} : { now }),
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseAiCostStatementInput = (
  value: unknown,
): AiCostStatementInput => {
  if (!isRecord(value)) throw new Error("Statement must be an object.");
  const allowedKeys = new Set([
    "statementKey",
    "provider",
    "serviceScope",
    "periodStartDay",
    "periodEndDay",
    "amountMicros",
    "currency",
    "source",
    "allocationMethod",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Statement contains an unsupported field.");
  }

  const statement = value as Partial<AiCostStatementInput>;
  if (
    typeof statement.statementKey !== "string" ||
    !OPAQUE_KEY_PATTERN.test(statement.statementKey)
  ) {
    throw new Error("statementKey must be a bounded opaque identifier.");
  }
  if (!isMember(AI_COST_PROVIDERS, statement.provider)) {
    throw new Error("provider is invalid.");
  }
  if (!isMember(AI_COST_STATEMENT_SERVICE_SCOPES, statement.serviceScope)) {
    throw new Error("serviceScope is invalid.");
  }
  if (
    typeof statement.periodStartDay !== "string" ||
    typeof statement.periodEndDay !== "string"
  ) {
    throw new Error("Statement period days are required.");
  }
  const periodStart = parseUtcDay(statement.periodStartDay, "periodStartDay");
  const periodEnd = parseUtcDay(statement.periodEndDay, "periodEndDay");
  if (periodEnd <= periodStart) {
    throw new Error("periodEndDay must be after periodStartDay.");
  }
  if (periodEnd - periodStart > 366 * 24 * 60 * 60 * 1_000) {
    throw new Error("Statement periods cannot exceed 366 days.");
  }
  if (
    !Number.isSafeInteger(statement.amountMicros) ||
    (statement.amountMicros ?? -1) < 0
  ) {
    throw new Error("amountMicros must be a non-negative safe integer.");
  }
  if (
    (statement.amountMicros ?? AI_COST_MAX_STATEMENT_AMOUNT_MICROS + 1) >
    AI_COST_MAX_STATEMENT_AMOUNT_MICROS
  ) {
    throw new Error(
      `amountMicros exceeds the v1 maximum of ${AI_COST_MAX_STATEMENT_AMOUNT_MICROS}.`,
    );
  }
  if (statement.currency !== "USD") {
    throw new Error("Only USD statements are supported in v1.");
  }
  if (!isMember(AI_COST_STATEMENT_SOURCES, statement.source)) {
    throw new Error("source is invalid.");
  }
  if (!isMember(AI_COST_ALLOCATION_METHODS, statement.allocationMethod)) {
    throw new Error("allocationMethod is invalid.");
  }
  return statement as AiCostStatementInput;
};
