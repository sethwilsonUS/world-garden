import type { Id } from "../_generated/dataModel";
import {
  AI_COST_EVENT_RETENTION_MS,
  AI_COST_OBSERVATION_WINDOW_MS,
  AI_COST_OPERATIONS,
  AI_COST_PROVIDERS,
  AI_COST_SOURCES,
  assertValidAiCostProviderAttempt,
  getAiCostProviderAttemptAttestationPayload,
  getAiCostLedgerMode,
  type AiCostProviderAttempt,
  type AiCostDurationMeasurement,
  type AiCostOperation,
  type AiCostProvider,
  type AiCostSource,
} from "../../lib/ai-cost-ledger-contract";
import {
  estimateDirectAiCost,
  type AiCostEstimate,
} from "../../lib/ai-cost-pricing";

const OPAQUE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$/;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,119}$/;

type LedgerMutationCtx = { db: unknown };
type LedgerDisposition = "inserted" | "duplicate" | "disabled";

type LedgerIndexRange = {
  eq(field: string, value: unknown): LedgerIndexRange;
  gt(field: string, value: unknown): LedgerIndexRange;
  lte(field: string, value: unknown): LedgerIndexRange;
};

type LedgerQuery<T> = {
  withIndex(
    name: string,
    callback: (range: LedgerIndexRange) => LedgerIndexRange,
  ): {
    unique(): Promise<T | null>;
    collect(): Promise<T[]>;
    take(count: number): Promise<T[]>;
  };
};

type LedgerDb = {
  query(table: string): LedgerQuery<LedgerEventDocument>;
  insert(table: string, value: Record<string, unknown>): Promise<unknown>;
  patch(id: unknown, value: Record<string, unknown>): Promise<void>;
  delete(id: unknown): Promise<void>;
};

type LedgerEventDocument = {
  [key: string]: unknown;
  _id: unknown;
  eventKey: string;
  eventDay: number;
  event: Record<string, unknown> & { kind: string };
};

type LedgerRollupDocument = Record<string, unknown> & {
  _id: unknown;
  key: string;
};

type LedgerCoverageDocument = Record<string, unknown> & {
  _id: unknown;
  key: "observe-v1";
  epochKey?: string;
  epochVersion?: number;
  firstObservedAt: number | null;
  resetAt?: number;
};

type LedgerCoverageResetDocument = Record<string, unknown> & {
  _id: unknown;
  epochKey: string;
  epochVersion: number;
  resetAt: number;
};

export type AiCostGenerationCandidate = {
  _id: unknown;
  eventKey: string;
  eventDay: number;
  event: Record<string, unknown> & { kind: string };
};

export const selectGenerationForObservedUse = <
  T extends AiCostGenerationCandidate,
>(
  candidates: T[],
  progressStartedAt: number,
  observedAt = progressStartedAt,
): T | null =>
  candidates
    .filter(
      (candidate) =>
        candidate.event.kind === "generation_asset" &&
        typeof candidate.event.generatedAt === "number" &&
        candidate.event.generatedAt <= progressStartedAt &&
        (candidate.event.generationUseState === "awaiting_observation" ||
          candidate.event.generationUseState ===
            "external_consumption_unknown") &&
        typeof candidate.event.observationEndsAt === "number" &&
        observedAt < candidate.event.observationEndsAt,
    )
    .sort((left, right) => {
      const timeDifference =
        (right.event.generatedAt as number) -
        (left.event.generatedAt as number);
      return timeDifference || left.eventKey.localeCompare(right.eventKey);
    })[0] ?? null;

export type AiCostCacheDecisionInput = {
  eventKey: string;
  source: AiCostSource;
  provider: AiCostProvider;
  operation: AiCostOperation;
  requests: number;
  hits: number;
  misses: number;
  reusedAssetServes: number;
  avoidedGeneration: number;
  uniqueGeneratedAssets: number;
  concurrentGenerationRaces: number;
  cacheWriteFailures: number;
  idempotentRetryWrites: number;
  bytes: number;
  seconds: number;
  recordedAt?: number;
};

export type AiCostGenerationAssetInput = {
  eventKey: string;
  articleId?: Id<"articles">;
  sectionKey?: string;
  source: AiCostSource;
  provider: AiCostProvider;
  model: string | null;
  byteLength: number;
  durationMs: number;
  durationMeasurement: AiCostDurationMeasurement;
  externalConsumptionUnknown: boolean;
  generatedAt: number;
};

export type AiCostListeningContributionInput = {
  eventKey: string;
  articleId: Id<"articles">;
  sectionKeys: string[];
  newUniqueSeconds: number;
  meaningfulUse: boolean;
  progressStartedAt: number;
  observedAt: number;
};

export type AiCostPipelineOutcomeInput = {
  eventKey: string;
  source: AiCostSource;
  provider: AiCostProvider | null;
  operation: AiCostOperation | null;
  generatedSections: number;
  reusedSections: number;
  recordedAt?: number;
};

export type NormalizedCacheDecisionInput = Omit<
  AiCostCacheDecisionInput,
  "seconds" | "recordedAt"
> & {
  durationMs: number;
  recordedAt: number;
};

export type NormalizedListeningContributionInput =
  AiCostListeningContributionInput & {
    newUniqueHeardMs: number;
  };

const hasOnlyKeys = (
  value: object,
  allowedKeys: readonly string[],
): boolean => {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
};

const assertOpaqueKey = (value: string, field: string): void => {
  if (!OPAQUE_KEY_PATTERN.test(value)) {
    throw new Error(`${field} must be a bounded opaque identifier.`);
  }
};

const assertSafeCount = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
};

const assertSafeTimestamp = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe timestamp.`);
  }
};

const assertSource = (source: AiCostSource): void => {
  if (!(AI_COST_SOURCES as readonly string[]).includes(source)) {
    throw new Error("source is invalid.");
  }
};

const assertProvider = (provider: AiCostProvider): void => {
  if (!(AI_COST_PROVIDERS as readonly string[]).includes(provider)) {
    throw new Error("provider is invalid.");
  }
};

const assertOperation = (operation: AiCostOperation): void => {
  if (!(AI_COST_OPERATIONS as readonly string[]).includes(operation)) {
    throw new Error("operation is invalid.");
  }
};

export const normalizeCacheDecisionInput = (
  input: AiCostCacheDecisionInput,
): NormalizedCacheDecisionInput => {
  if (
    !hasOnlyKeys(input, [
      "eventKey",
      "source",
      "provider",
      "operation",
      "requests",
      "hits",
      "misses",
      "reusedAssetServes",
      "avoidedGeneration",
      "uniqueGeneratedAssets",
      "concurrentGenerationRaces",
      "cacheWriteFailures",
      "idempotentRetryWrites",
      "bytes",
      "seconds",
      "recordedAt",
    ])
  ) {
    throw new Error("Cache decision contains an unsupported field.");
  }
  assertOpaqueKey(input.eventKey, "eventKey");
  assertSource(input.source);
  assertProvider(input.provider);
  assertOperation(input.operation);
  for (const field of [
    "requests",
    "hits",
    "misses",
    "reusedAssetServes",
    "avoidedGeneration",
    "uniqueGeneratedAssets",
    "concurrentGenerationRaces",
    "cacheWriteFailures",
    "idempotentRetryWrites",
    "bytes",
  ] as const) {
    assertSafeCount(input[field], field);
  }
  if (
    input.hits + input.misses !== input.requests ||
    input.reusedAssetServes > input.hits ||
    input.avoidedGeneration > input.hits
  ) {
    throw new Error(
      "Authoritative cache decision counters are internally inconsistent.",
    );
  }
  if (!Number.isFinite(input.seconds) || input.seconds < 0) {
    throw new Error("seconds must be finite and non-negative.");
  }
  const durationMs = Math.round(input.seconds * 1_000);
  assertSafeCount(durationMs, "durationMs");
  const recordedAt = input.recordedAt ?? Date.now();
  assertSafeTimestamp(recordedAt, "recordedAt");

  return {
    eventKey: input.eventKey,
    source: input.source,
    provider: input.provider,
    operation: input.operation,
    requests: input.requests,
    hits: input.hits,
    misses: input.misses,
    reusedAssetServes: input.reusedAssetServes,
    avoidedGeneration: input.avoidedGeneration,
    uniqueGeneratedAssets: input.uniqueGeneratedAssets,
    concurrentGenerationRaces: input.concurrentGenerationRaces,
    cacheWriteFailures: input.cacheWriteFailures,
    idempotentRetryWrites: input.idempotentRetryWrites,
    bytes: input.bytes,
    durationMs,
    recordedAt,
  };
};

const normalizeGenerationAssetInput = (
  input: AiCostGenerationAssetInput,
): AiCostGenerationAssetInput => {
  if (
    !hasOnlyKeys(input, [
      "eventKey",
      "articleId",
      "sectionKey",
      "source",
      "provider",
      "model",
      "byteLength",
      "durationMs",
      "durationMeasurement",
      "externalConsumptionUnknown",
      "generatedAt",
    ])
  ) {
    throw new Error("Generation asset contains an unsupported field.");
  }
  assertOpaqueKey(input.eventKey, "eventKey");
  assertSource(input.source);
  assertProvider(input.provider);
  assertSafeCount(input.byteLength, "byteLength");
  assertSafeCount(input.durationMs, "durationMs");
  assertSafeTimestamp(input.generatedAt, "generatedAt");
  if (
    input.model !== null &&
    (!SAFE_IDENTIFIER_PATTERN.test(input.model) ||
      input.model.startsWith("/") ||
      input.model.includes("://"))
  ) {
    throw new Error("model must be a bounded provider identifier or null.");
  }
  if (
    input.sectionKey !== undefined &&
    (!SAFE_IDENTIFIER_PATTERN.test(input.sectionKey) ||
      input.sectionKey.startsWith("/") ||
      input.sectionKey.includes("://"))
  ) {
    throw new Error("sectionKey must be a bounded opaque identifier.");
  }
  if (
    !(["measured", "estimated", "unknown"] as const).includes(
      input.durationMeasurement,
    )
  ) {
    throw new Error("durationMeasurement is invalid.");
  }
  if (input.durationMs === 0 && input.durationMeasurement !== "unknown") {
    throw new Error("A missing duration must use unknown measurement.");
  }
  return input;
};

export const normalizeListeningContributionInput = (
  input: AiCostListeningContributionInput,
): NormalizedListeningContributionInput => {
  if (
    !hasOnlyKeys(input, [
      "eventKey",
      "articleId",
      "sectionKeys",
      "newUniqueSeconds",
      "meaningfulUse",
      "progressStartedAt",
      "observedAt",
    ])
  ) {
    throw new Error("Listening contribution contains an unsupported field.");
  }
  assertOpaqueKey(input.eventKey, "eventKey");
  assertSafeTimestamp(input.progressStartedAt, "progressStartedAt");
  assertSafeTimestamp(input.observedAt, "observedAt");
  if (input.progressStartedAt > input.observedAt) {
    throw new Error("progressStartedAt cannot be after observedAt.");
  }
  if (!Number.isFinite(input.newUniqueSeconds) || input.newUniqueSeconds < 0) {
    throw new Error("newUniqueSeconds must be finite and non-negative.");
  }
  if (input.sectionKeys.length > 250) {
    throw new Error("sectionKeys is too large.");
  }
  for (const sectionKey of input.sectionKeys) {
    if (
      !SAFE_IDENTIFIER_PATTERN.test(sectionKey) ||
      sectionKey.startsWith("/") ||
      sectionKey.includes("://")
    ) {
      throw new Error("sectionKeys must contain bounded opaque identifiers.");
    }
  }
  const newUniqueHeardMs = Math.round(input.newUniqueSeconds * 1_000);
  assertSafeCount(newUniqueHeardMs, "newUniqueHeardMs");
  return { ...input, newUniqueHeardMs };
};

const normalizePipelineOutcomeInput = (
  input: AiCostPipelineOutcomeInput,
): Required<AiCostPipelineOutcomeInput> => {
  if (
    !hasOnlyKeys(input, [
      "eventKey",
      "source",
      "provider",
      "operation",
      "generatedSections",
      "reusedSections",
      "recordedAt",
    ])
  ) {
    throw new Error("Pipeline outcome contains an unsupported field.");
  }
  assertOpaqueKey(input.eventKey, "eventKey");
  assertSource(input.source);
  if (input.provider !== null) assertProvider(input.provider);
  if (input.operation !== null) assertOperation(input.operation);
  assertSafeCount(input.generatedSections, "generatedSections");
  assertSafeCount(input.reusedSections, "reusedSections");
  const recordedAt = input.recordedAt ?? Date.now();
  assertSafeTimestamp(recordedAt, "recordedAt");
  return { ...input, recordedAt };
};

const getDb = (ctx: LedgerMutationCtx): LedgerDb => ctx.db as LedgerDb;

const utcDayStart = (timestamp: number): number => {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

const getExistingEvent = async (
  db: LedgerDb,
  eventKey: string,
): Promise<LedgerEventDocument | null> =>
  await db
    .query("aiCostLedgerEvents")
    .withIndex("by_eventKey", (query) => query.eq("eventKey", eventKey))
    .unique();

const getExistingDelivery = async (
  db: LedgerDb,
  eventKey: string,
): Promise<LedgerEventDocument | null> =>
  await db
    .query("aiCostLedgerDeliveries")
    .withIndex("by_eventKey", (query) => query.eq("eventKey", eventKey))
    .unique();

const AI_COST_COVERAGE_KEY = "observe-v1" as const;

const getExistingCoverage = async (
  db: LedgerDb,
): Promise<LedgerCoverageDocument | null> =>
  (await db
    .query("aiCostLedgerCoverage")
    .withIndex("by_key", (query) => query.eq("key", AI_COST_COVERAGE_KEY))
    .unique()) as unknown as LedgerCoverageDocument | null;

const getExistingCoverageReset = async (
  db: LedgerDb,
  epochKey: string,
): Promise<LedgerCoverageResetDocument | null> =>
  (await db
    .query("aiCostLedgerCoverageResets")
    .withIndex("by_epochKey", (query) => query.eq("epochKey", epochKey))
    .unique()) as unknown as LedgerCoverageResetDocument | null;

export const ensureAiCostLedgerCoverageForCtx = async (
  ctx: LedgerMutationCtx,
  now = Date.now(),
): Promise<number> => {
  assertSafeTimestamp(now, "coverageStartedAt");
  const db = getDb(ctx);
  const existing = await getExistingCoverage(db);
  if (existing && existing.firstObservedAt !== null) {
    return existing.firstObservedAt;
  }
  if (existing) {
    await db.patch(existing._id, { firstObservedAt: now, updatedAt: now });
    return now;
  }
  await db.insert("aiCostLedgerCoverage", {
    key: AI_COST_COVERAGE_KEY,
    epochKey: "implicit.initial-observe-v1",
    epochVersion: 1,
    firstObservedAt: now,
    resetAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return now;
};

export const readAiCostLedgerCoverageStartedAtForCtx = async (
  ctx: LedgerMutationCtx,
): Promise<number | null> => {
  const coverage = await getExistingCoverage(getDb(ctx));
  return coverage?.firstObservedAt ?? null;
};

export const resetAiCostLedgerCoverageForCtx = async (
  ctx: LedgerMutationCtx,
  { epochKey, now = Date.now() }: { epochKey: string; now?: number },
): Promise<{
  reset: boolean;
  disposition: "inserted" | "updated" | "duplicate";
  epochVersion: number;
}> => {
  if (getAiCostLedgerMode() !== "off") {
    throw new Error(
      "AI cost coverage can only be reset while the ledger mode is off.",
    );
  }
  assertOpaqueKey(epochKey, "epochKey");
  assertSafeTimestamp(now, "resetAt");
  const db = getDb(ctx);
  const existingReset = await getExistingCoverageReset(db, epochKey);
  if (existingReset) {
    assertSafeCount(existingReset.epochVersion, "epochVersion");
    return {
      reset: false,
      disposition: "duplicate",
      epochVersion: existingReset.epochVersion,
    };
  }
  const existing = await getExistingCoverage(db);
  const currentEpochVersion =
    existing &&
    Number.isSafeInteger(existing.epochVersion) &&
    (existing.epochVersion ?? 0) >= 1
      ? (existing.epochVersion as number)
      : 1;
  if (existing?.epochKey === epochKey) {
    await db.insert("aiCostLedgerCoverageResets", {
      epochKey,
      epochVersion: currentEpochVersion,
      resetAt: typeof existing.resetAt === "number" ? existing.resetAt : now,
      createdAt: now,
    });
    return {
      reset: false,
      disposition: "duplicate",
      epochVersion: currentEpochVersion,
    };
  }
  if (!existing) {
    await db.insert("aiCostLedgerCoverage", {
      key: AI_COST_COVERAGE_KEY,
      epochKey,
      epochVersion: 1,
      firstObservedAt: null,
      resetAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert("aiCostLedgerCoverageResets", {
      epochKey,
      epochVersion: 1,
      resetAt: now,
      createdAt: now,
    });
    return { reset: true, disposition: "inserted", epochVersion: 1 };
  }
  const epochVersion = currentEpochVersion + 1;
  assertSafeCount(epochVersion, "epochVersion");
  await db.patch(existing._id, {
    epochKey,
    epochVersion,
    firstObservedAt: null,
    resetAt: now,
    updatedAt: now,
  });
  await db.insert("aiCostLedgerCoverageResets", {
    epochKey,
    epochVersion,
    resetAt: now,
    createdAt: now,
  });
  return { reset: true, disposition: "updated", epochVersion };
};

const EMPTY_ROLLUP_COUNTERS = {
  providerAttempts: 0,
  successfulAttempts: 0,
  failedBeforeDispatchAttempts: 0,
  failedAfterDispatchAttempts: 0,
  ambiguousAfterDispatchAttempts: 0,
  potentiallyBillableAttempts: 0,
  fallbackAttempts: 0,
  fallbackSucceededAttempts: 0,
  inputCharacters: 0,
  inputWords: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteInputTokens: 0,
  outputTokens: 0,
  webSearchCalls: 0,
  providerResponseAudioBytes: 0,
  providerAudioDurationMeasuredMs: 0,
  providerAudioDurationEstimatedMs: 0,
  estimatedDirectAiCostMicros: 0,
  estimatedCostKnownAttempts: 0,
  estimatedCostProviderUsageAttempts: 0,
  estimatedCostLocalEstimateAttempts: 0,
  estimatedCostUnknownAttempts: 0,
  cacheRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  reusedAssetServes: 0,
  avoidedGeneration: 0,
  uniqueGeneratedAssets: 0,
  concurrentGenerationRaces: 0,
  cacheWriteFailures: 0,
  idempotentRetryWrites: 0,
  cacheServedBytes: 0,
  cacheServedDurationMs: 0,
  uniqueGeneratedBytes: 0,
  uniqueGeneratedDurationMeasuredMs: 0,
  uniqueGeneratedDurationEstimatedMs: 0,
  pipelineGeneratedSections: 0,
  pipelineReusedSections: 0,
  signedInUniqueHeardMs: 0,
  generationAwaitingObservation: 0,
  generationObservedMeaningfulUse: 0,
  generationNoObservedMeaningfulUse: 0,
  generationExternalConsumptionUnknown: 0,
} as const;

type RollupCounter = keyof typeof EMPTY_ROLLUP_COUNTERS;
type RollupDelta = Partial<Record<RollupCounter, number>>;

export type ProviderAttemptWriteDisposition =
  | "inserted"
  | "updated"
  | "duplicate"
  | "stale"
  | "disabled";

const isAllowedResearchUsageEnrichment = (
  existing: AiCostProviderAttempt,
  incoming: AiCostProviderAttempt,
): boolean => {
  if (
    existing.state !== "succeeded" ||
    incoming.state !== "succeeded" ||
    existing.operation !== "trending_brief_research" ||
    existing.webSearchCalls !== null ||
    incoming.webSearchCalls === null ||
    !Number.isSafeInteger(incoming.webSearchCalls) ||
    incoming.webSearchCalls < 0
  ) {
    return false;
  }
  const existingImmutable = {
    ...existing,
    lifecycleVersion: 0,
    webSearchCalls: null,
  };
  const incomingImmutable = {
    ...incoming,
    lifecycleVersion: 0,
    webSearchCalls: null,
  };
  return (
    JSON.stringify(existingImmutable) === JSON.stringify(incomingImmutable)
  );
};

const nullableMeasurementIsMonotonic = (
  existing: number | null,
  incoming: number | null,
): boolean => existing === null || existing === incoming;

const modelIdentityIsCompatible = (
  existing: string | null,
  incoming: string | null,
): boolean =>
  existing === incoming ||
  (existing === "gpt-5.6-luna" && incoming === "gpt-5.6-luna-2026-07-01");

const isMonotonicUnknownAttemptUpdate = (
  existing: AiCostProviderAttempt,
  incoming: AiCostProviderAttempt,
): boolean => {
  if (
    existing.state !== "unknown_after_dispatch" ||
    existing.eventKey !== incoming.eventKey ||
    existing.correlationId !== incoming.correlationId ||
    existing.operation !== incoming.operation ||
    existing.source !== incoming.source ||
    existing.requestedProvider !== incoming.requestedProvider ||
    existing.effectiveProvider !== incoming.effectiveProvider ||
    !modelIdentityIsCompatible(existing.model, incoming.model) ||
    existing.profile !== incoming.profile ||
    existing.dispatchedAt !== incoming.dispatchedAt ||
    existing.inputCharacters !== incoming.inputCharacters ||
    existing.inputWords !== incoming.inputWords ||
    existing.isFallbackAttempt !== incoming.isFallbackAttempt ||
    (existing.serviceTier !== null &&
      existing.serviceTier !== incoming.serviceTier) ||
    !nullableMeasurementIsMonotonic(
      existing.completedAt,
      incoming.completedAt,
    ) ||
    !nullableMeasurementIsMonotonic(
      existing.inputTokens,
      incoming.inputTokens,
    ) ||
    !nullableMeasurementIsMonotonic(
      existing.cachedInputTokens,
      incoming.cachedInputTokens,
    ) ||
    !nullableMeasurementIsMonotonic(
      existing.cacheWriteInputTokens,
      incoming.cacheWriteInputTokens,
    ) ||
    !nullableMeasurementIsMonotonic(
      existing.outputTokens,
      incoming.outputTokens,
    ) ||
    !nullableMeasurementIsMonotonic(
      existing.reasoningOutputTokens,
      incoming.reasoningOutputTokens,
    ) ||
    !nullableMeasurementIsMonotonic(
      existing.audioInputTokens,
      incoming.audioInputTokens,
    ) ||
    !nullableMeasurementIsMonotonic(
      existing.audioOutputTokens,
      incoming.audioOutputTokens,
    ) ||
    !nullableMeasurementIsMonotonic(
      existing.webSearchCalls,
      incoming.webSearchCalls,
    ) ||
    !nullableMeasurementIsMonotonic(
      existing.responseAudioBytes,
      incoming.responseAudioBytes,
    ) ||
    !nullableMeasurementIsMonotonic(
      existing.audioDurationMs,
      incoming.audioDurationMs,
    ) ||
    (existing.durationMeasurement !== "unknown" &&
      existing.durationMeasurement !== incoming.durationMeasurement)
  ) {
    return false;
  }
  if (
    existing.failureCategory !== null &&
    existing.failureCategory !== "unknown" &&
    existing.failureCategory !== incoming.failureCategory
  ) {
    return false;
  }
  return true;
};

export const resolveProviderAttemptWrite = (
  existing: AiCostProviderAttempt | null,
  incoming: AiCostProviderAttempt,
): Exclude<ProviderAttemptWriteDisposition, "disabled"> => {
  if (!existing) return "inserted";
  if (incoming.lifecycleVersion < existing.lifecycleVersion) return "stale";
  const identical =
    JSON.stringify(getAiCostProviderAttemptAttestationPayload(existing)) ===
    JSON.stringify(getAiCostProviderAttemptAttestationPayload(incoming));
  if (incoming.lifecycleVersion === existing.lifecycleVersion) {
    return identical ? "duplicate" : "stale";
  }
  if (existing.state !== "unknown_after_dispatch") {
    return isAllowedResearchUsageEnrichment(existing, incoming)
      ? "updated"
      : "stale";
  }
  return isMonotonicUnknownAttemptUpdate(existing, incoming)
    ? "updated"
    : "stale";
};

export const getProviderAttemptRollupContribution = (
  attempt: AiCostProviderAttempt,
  estimate: AiCostEstimate,
): RollupDelta => ({
  providerAttempts: 1,
  successfulAttempts: attempt.state === "succeeded" ? 1 : 0,
  failedBeforeDispatchAttempts:
    attempt.state === "failed_before_dispatch" ? 1 : 0,
  failedAfterDispatchAttempts:
    attempt.state === "failed_after_dispatch" ? 1 : 0,
  ambiguousAfterDispatchAttempts:
    attempt.state === "unknown_after_dispatch" ? 1 : 0,
  potentiallyBillableAttempts: attempt.dispatchedAt === null ? 0 : 1,
  fallbackAttempts: attempt.isFallbackAttempt ? 1 : 0,
  fallbackSucceededAttempts:
    attempt.isFallbackAttempt && attempt.state === "succeeded" ? 1 : 0,
  inputCharacters: attempt.inputCharacters ?? 0,
  inputWords: attempt.inputWords ?? 0,
  inputTokens: attempt.inputTokens ?? 0,
  cachedInputTokens: attempt.cachedInputTokens ?? 0,
  cacheWriteInputTokens: attempt.cacheWriteInputTokens ?? 0,
  outputTokens: attempt.outputTokens ?? 0,
  webSearchCalls: attempt.webSearchCalls ?? 0,
  providerResponseAudioBytes: attempt.responseAudioBytes ?? 0,
  providerAudioDurationMeasuredMs:
    attempt.durationMeasurement === "measured"
      ? (attempt.audioDurationMs ?? 0)
      : 0,
  providerAudioDurationEstimatedMs:
    attempt.durationMeasurement === "estimated"
      ? (attempt.audioDurationMs ?? 0)
      : 0,
  estimatedDirectAiCostMicros: estimate.amountMicros ?? 0,
  estimatedCostKnownAttempts: estimate.amountMicros === null ? 0 : 1,
  estimatedCostProviderUsageAttempts:
    estimate.quality === "derived_from_provider_usage" ? 1 : 0,
  estimatedCostLocalEstimateAttempts:
    estimate.quality === "locally_measured_estimate" ? 1 : 0,
  estimatedCostUnknownAttempts: estimate.amountMicros === null ? 1 : 0,
});

const addRollupDelta = async (
  db: LedgerDb,
  dimensions: {
    bucketStart: number;
    source: AiCostSource;
    provider: AiCostProvider | null;
    operation: AiCostOperation | null;
  },
  delta: RollupDelta,
  now: number,
): Promise<void> => {
  const key = [
    dimensions.bucketStart,
    dimensions.source,
    dimensions.provider ?? "none",
    dimensions.operation ?? "none",
  ].join(":");
  const existing = (await db
    .query("aiCostDailyRollups")
    .withIndex("by_key", (query) => query.eq("key", key))
    .unique()) as LedgerRollupDocument | null;

  if (!existing) {
    await db.insert("aiCostDailyRollups", {
      key,
      ...dimensions,
      ...EMPTY_ROLLUP_COUNTERS,
      ...delta,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  const patch: Record<string, number> = { updatedAt: now };
  for (const [field, amount] of Object.entries(delta)) {
    if (amount === undefined || amount === 0) continue;
    const previous = existing[field];
    if (typeof previous !== "number") {
      throw new Error(`Rollup counter ${field} is invalid.`);
    }
    patch[field] = previous + amount;
  }
  await db.patch(existing._id, patch);
};

const insertIdempotentEvent = async (
  db: LedgerDb,
  eventKey: string,
  eventTimestamp: number,
  event: Record<string, unknown>,
  now: number,
  observationEndsAt: number | null = null,
): Promise<boolean> => {
  if (await getExistingDelivery(db, eventKey)) return false;
  const eventKind = event.kind;
  if (
    eventKind !== "provider_attempt" &&
    eventKind !== "cache_decision" &&
    eventKind !== "generation_asset" &&
    eventKind !== "listening_contribution" &&
    eventKind !== "pipeline_outcome"
  ) {
    throw new Error("Ledger event kind is invalid.");
  }
  await db.insert("aiCostLedgerDeliveries", {
    eventKey,
    eventKind,
    latestLifecycleVersion: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert("aiCostLedgerEvents", {
    eventKey,
    eventDay: utcDayStart(eventTimestamp),
    observationEndsAt,
    expiresAt: now + AI_COST_EVENT_RETENTION_MS,
    event,
    createdAt: now,
    updatedAt: now,
  });
  return true;
};

export const getProviderAttemptFromEvent = (
  event: LedgerEventDocument["event"],
  eventKey: string,
): AiCostProviderAttempt | null => {
  if (event.kind !== "provider_attempt") return null;
  const storedOnlyKeys = new Set([
    "kind",
    "estimatedDirectAiCostMicros",
    "estimatedCostCurrency",
    "estimatedCostPricingVersion",
    "estimatedCostEffectiveFrom",
    "estimatedCostQuality",
    "estimatedCostReason",
  ]);
  const attempt = Object.fromEntries(
    Object.entries(event).filter(([key]) => !storedOnlyKeys.has(key)),
  );
  try {
    const reconstructed = { eventKey, ...attempt } as AiCostProviderAttempt;
    assertValidAiCostProviderAttempt(reconstructed);
    return reconstructed;
  } catch {
    return null;
  }
};

const getStoredEstimate = (
  event: LedgerEventDocument["event"],
): AiCostEstimate => ({
  amountMicros:
    typeof event.estimatedDirectAiCostMicros === "number"
      ? event.estimatedDirectAiCostMicros
      : null,
  currency: "USD",
  quality:
    event.estimatedCostQuality === "derived_from_provider_usage" ||
    event.estimatedCostQuality === "locally_measured_estimate"
      ? event.estimatedCostQuality
      : "unknown",
  pricingVersion:
    typeof event.estimatedCostPricingVersion === "string"
      ? event.estimatedCostPricingVersion
      : null,
  effectiveFrom:
    typeof event.estimatedCostEffectiveFrom === "string"
      ? event.estimatedCostEffectiveFrom
      : null,
  reason: (event.estimatedCostReason ?? null) as AiCostEstimate["reason"],
});

export const toProviderAttemptEvent = (
  attempt: AiCostProviderAttempt,
  estimate: AiCostEstimate,
): Record<string, unknown> => {
  const storedAttempt: Record<string, unknown> = { ...attempt };
  delete storedAttempt.eventKey;
  return {
    kind: "provider_attempt",
    ...storedAttempt,
    estimatedDirectAiCostMicros: estimate.amountMicros,
    estimatedCostCurrency: estimate.currency,
    estimatedCostPricingVersion: estimate.pricingVersion,
    estimatedCostEffectiveFrom: estimate.effectiveFrom,
    estimatedCostQuality: estimate.quality,
    estimatedCostReason: estimate.reason,
  };
};

const negateRollupDelta = (delta: RollupDelta): RollupDelta =>
  Object.fromEntries(
    Object.entries(delta).map(([field, amount]) => [field, -(amount ?? 0)]),
  ) as RollupDelta;

export const recordProviderAttemptForCtx = async (
  ctx: LedgerMutationCtx,
  attempt: AiCostProviderAttempt,
): Promise<{
  recorded: boolean;
  disposition: ProviderAttemptWriteDisposition;
}> => {
  if (getAiCostLedgerMode() !== "observe") {
    return { recorded: false, disposition: "disabled" };
  }
  assertValidAiCostProviderAttempt(attempt);
  const db = getDb(ctx);
  const now = Date.now();
  const existingDocument = await getExistingEvent(db, attempt.eventKey);
  let existingDelivery = await getExistingDelivery(db, attempt.eventKey);
  if (!existingDocument && existingDelivery) {
    return { recorded: false, disposition: "duplicate" };
  }
  const existingAttempt = existingDocument
    ? getProviderAttemptFromEvent(
        existingDocument.event,
        existingDocument.eventKey,
      )
    : null;
  if (existingDocument && !existingDelivery) {
    const deliveryId = await db.insert("aiCostLedgerDeliveries", {
      eventKey: attempt.eventKey,
      eventKind: "provider_attempt",
      latestLifecycleVersion: existingAttempt?.lifecycleVersion ?? null,
      createdAt: now,
      updatedAt: now,
    });
    existingDelivery = {
      _id: deliveryId,
      eventKey: attempt.eventKey,
      eventDay: existingDocument.eventDay,
      event: { kind: "provider_attempt" },
    };
  }
  const disposition = resolveProviderAttemptWrite(existingAttempt, attempt);
  if (disposition === "duplicate" || disposition === "stale") {
    return { recorded: false, disposition };
  }

  const eventTimestamp = attempt.dispatchedAt ?? attempt.completedAt ?? now;
  const eventDay = utcDayStart(eventTimestamp);
  const estimate = estimateDirectAiCost(attempt);
  const contribution = getProviderAttemptRollupContribution(attempt, estimate);
  const dimensions = {
    bucketStart: eventDay,
    source: attempt.source,
    provider: attempt.effectiveProvider,
    operation: attempt.operation,
  } as const;

  if (disposition === "inserted") {
    await ensureAiCostLedgerCoverageForCtx(ctx, now);
    await db.insert("aiCostLedgerDeliveries", {
      eventKey: attempt.eventKey,
      eventKind: "provider_attempt",
      latestLifecycleVersion: attempt.lifecycleVersion,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert("aiCostLedgerEvents", {
      eventKey: attempt.eventKey,
      eventDay,
      observationEndsAt: null,
      expiresAt: now + AI_COST_EVENT_RETENTION_MS,
      event: toProviderAttemptEvent(attempt, estimate),
      createdAt: now,
      updatedAt: now,
    });
    await addRollupDelta(db, dimensions, contribution, now);
    return { recorded: true, disposition };
  }

  if (!existingDocument || !existingAttempt) {
    return { recorded: false, disposition: "stale" };
  }
  const oldEstimate = getStoredEstimate(existingDocument.event);
  const oldContribution = getProviderAttemptRollupContribution(
    existingAttempt,
    oldEstimate,
  );
  await ensureAiCostLedgerCoverageForCtx(ctx, now);
  await db.patch(existingDocument._id, {
    eventDay,
    event: toProviderAttemptEvent(attempt, estimate),
    updatedAt: now,
  });
  if (existingDelivery) {
    await db.patch(existingDelivery._id, {
      latestLifecycleVersion: attempt.lifecycleVersion,
      updatedAt: now,
    });
  } else {
    await db.insert("aiCostLedgerDeliveries", {
      eventKey: attempt.eventKey,
      eventKind: "provider_attempt",
      latestLifecycleVersion: attempt.lifecycleVersion,
      createdAt: now,
      updatedAt: now,
    });
  }
  await addRollupDelta(
    db,
    {
      bucketStart: existingDocument.eventDay,
      source: existingAttempt.source,
      provider: existingAttempt.effectiveProvider,
      operation: existingAttempt.operation,
    },
    negateRollupDelta(oldContribution),
    now,
  );
  await addRollupDelta(db, dimensions, contribution, now);
  return { recorded: true, disposition };
};

export const recordCacheDecisionForCtx = async (
  ctx: LedgerMutationCtx,
  input: AiCostCacheDecisionInput,
): Promise<{ created: boolean; disposition: LedgerDisposition }> => {
  if (getAiCostLedgerMode() !== "observe") {
    return { created: false, disposition: "disabled" };
  }
  const normalized = normalizeCacheDecisionInput(input);
  const { eventKey, ...storedDecision } = normalized;
  const db = getDb(ctx);
  const now = Date.now();
  const created = await insertIdempotentEvent(
    db,
    eventKey,
    normalized.recordedAt,
    { kind: "cache_decision", ...storedDecision },
    now,
  );
  if (!created) return { created: false, disposition: "duplicate" };

  await ensureAiCostLedgerCoverageForCtx(ctx, now);
  await addRollupDelta(
    db,
    {
      bucketStart: utcDayStart(normalized.recordedAt),
      source: normalized.source,
      provider: normalized.provider,
      operation: normalized.operation,
    },
    {
      cacheRequests: normalized.requests,
      cacheHits: normalized.hits,
      cacheMisses: normalized.misses,
      reusedAssetServes: normalized.reusedAssetServes,
      avoidedGeneration: normalized.avoidedGeneration,
      uniqueGeneratedAssets: normalized.uniqueGeneratedAssets,
      concurrentGenerationRaces: normalized.concurrentGenerationRaces,
      cacheWriteFailures: normalized.cacheWriteFailures,
      idempotentRetryWrites: normalized.idempotentRetryWrites,
      cacheServedBytes: normalized.bytes,
      cacheServedDurationMs: normalized.durationMs,
    },
    now,
  );
  return { created: true, disposition: "inserted" };
};

export const recordGenerationAssetForCtx = async (
  ctx: LedgerMutationCtx,
  rawInput: AiCostGenerationAssetInput,
): Promise<{ created: boolean; disposition: LedgerDisposition }> => {
  if (getAiCostLedgerMode() !== "observe") {
    return { created: false, disposition: "disabled" };
  }
  const input = normalizeGenerationAssetInput(rawInput);
  const db = getDb(ctx);
  const now = Date.now();
  const generationUseState = input.externalConsumptionUnknown
    ? "external_consumption_unknown"
    : "awaiting_observation";
  const created = await insertIdempotentEvent(
    db,
    input.eventKey,
    input.generatedAt,
    {
      kind: "generation_asset",
      ...(input.articleId === undefined ? {} : { articleId: input.articleId }),
      ...(input.sectionKey === undefined
        ? {}
        : { sectionKey: input.sectionKey }),
      source: input.source,
      provider: input.provider,
      model: input.model,
      byteLength: input.byteLength,
      durationMs: input.durationMs,
      durationMeasurement: input.durationMeasurement,
      generatedAt: input.generatedAt,
      observationEndsAt: input.generatedAt + AI_COST_OBSERVATION_WINDOW_MS,
      generationUseState,
    },
    now,
    input.generatedAt + AI_COST_OBSERVATION_WINDOW_MS,
  );
  if (!created) return { created: false, disposition: "duplicate" };

  await ensureAiCostLedgerCoverageForCtx(ctx, now);
  await addRollupDelta(
    db,
    {
      bucketStart: utcDayStart(input.generatedAt),
      source: input.source,
      provider: input.provider,
      operation: "tts",
    },
    {
      uniqueGeneratedBytes: input.byteLength,
      ...(input.durationMeasurement === "measured"
        ? { uniqueGeneratedDurationMeasuredMs: input.durationMs }
        : input.durationMeasurement === "estimated"
          ? { uniqueGeneratedDurationEstimatedMs: input.durationMs }
          : {}),
      ...(generationUseState === "external_consumption_unknown"
        ? { generationExternalConsumptionUnknown: 1 }
        : { generationAwaitingObservation: 1 }),
    },
    now,
  );
  return { created: true, disposition: "inserted" };
};

const clearGenerationAssetLinkage = async (
  db: LedgerDb,
  generation: LedgerEventDocument,
): Promise<LedgerEventDocument["event"]> => {
  if (generation.event.kind !== "generation_asset") return generation.event;

  const privacyReducedEvent = { ...generation.event };
  const articleId = privacyReducedEvent.articleId;
  const sectionKey = privacyReducedEvent.sectionKey;
  delete privacyReducedEvent.articleId;
  delete privacyReducedEvent.sectionKey;

  if (typeof articleId !== "string" || typeof sectionKey !== "string") {
    return privacyReducedEvent;
  }
  const sectionRows = await db
    .query("sectionAudio")
    .withIndex("by_article_section", (query) =>
      query.eq("articleId", articleId).eq("sectionKey", sectionKey),
    )
    .collect();
  for (const row of sectionRows) {
    if (row.ledgerAssetKey === generation.eventKey) {
      await db.patch(row._id, { ledgerAssetKey: undefined });
    }
  }
  return privacyReducedEvent;
};

const markGenerationObservedForSection = async (
  db: LedgerDb,
  articleId: Id<"articles">,
  sectionKey: string,
  progressStartedAt: number,
  observedAt: number,
  now: number,
): Promise<void> => {
  const sectionRows = await db
    .query("sectionAudio")
    .withIndex("by_article_section", (query) =>
      query.eq("articleId", articleId).eq("sectionKey", sectionKey),
    )
    .collect();
  const assetKeys = new Set(
    sectionRows.flatMap((row) => {
      const key = row.ledgerAssetKey;
      return typeof key === "string" ? [key] : [];
    }),
  );

  const generations = (
    await Promise.all(
      [...assetKeys].map(
        async (assetKey) => await getExistingEvent(db, assetKey),
      ),
    )
  ).filter((generation) => generation !== null);
  const generation = selectGenerationForObservedUse(
    generations,
    progressStartedAt,
    observedAt,
  );
  if (generation) {
    const source = generation.event.source;
    const provider = generation.event.provider;
    if (
      !(AI_COST_SOURCES as readonly unknown[]).includes(source) ||
      !(AI_COST_PROVIDERS as readonly unknown[]).includes(provider)
    ) {
      return;
    }
    const privacyReducedEvent = await clearGenerationAssetLinkage(
      db,
      generation,
    );
    await db.patch(generation._id, {
      observationEndsAt: null,
      event: {
        ...privacyReducedEvent,
        generationUseState: "observed_meaningful_use",
      },
      updatedAt: now,
    });
    await addRollupDelta(
      db,
      {
        bucketStart: generation.eventDay,
        source: source as AiCostSource,
        provider: provider as AiCostProvider,
        operation: "tts",
      },
      {
        ...(generation.event.generationUseState === "awaiting_observation"
          ? { generationAwaitingObservation: -1 }
          : { generationExternalConsumptionUnknown: -1 }),
        generationObservedMeaningfulUse: 1,
      },
      now,
    );
  }
};

export const recordListeningContributionForCtx = async (
  ctx: LedgerMutationCtx,
  rawInput: AiCostListeningContributionInput,
): Promise<{ created: boolean; disposition: LedgerDisposition }> => {
  if (getAiCostLedgerMode() !== "observe") {
    return { created: false, disposition: "disabled" };
  }
  const input = normalizeListeningContributionInput(rawInput);
  const db = getDb(ctx);
  const now = Date.now();
  const created = await insertIdempotentEvent(
    db,
    input.eventKey,
    input.observedAt,
    {
      kind: "listening_contribution",
      newUniqueHeardMs: input.newUniqueHeardMs,
      meaningfulUse: input.meaningfulUse,
      observedAt: input.observedAt,
    },
    now,
  );
  if (!created) return { created: false, disposition: "duplicate" };

  await ensureAiCostLedgerCoverageForCtx(ctx, now);
  await addRollupDelta(
    db,
    {
      bucketStart: utcDayStart(input.observedAt),
      source: "interactive_article",
      provider: null,
      operation: null,
    },
    { signedInUniqueHeardMs: input.newUniqueHeardMs },
    now,
  );

  if (input.meaningfulUse) {
    for (const sectionKey of new Set(input.sectionKeys)) {
      await markGenerationObservedForSection(
        db,
        input.articleId,
        sectionKey,
        input.progressStartedAt,
        input.observedAt,
        now,
      );
    }
  }
  return { created: true, disposition: "inserted" };
};

export const recordPipelineOutcomeForCtx = async (
  ctx: LedgerMutationCtx,
  rawInput: AiCostPipelineOutcomeInput,
): Promise<{ created: boolean; disposition: LedgerDisposition }> => {
  if (getAiCostLedgerMode() !== "observe") {
    return { created: false, disposition: "disabled" };
  }
  const input = normalizePipelineOutcomeInput(rawInput);
  const { eventKey, ...storedOutcome } = input;
  const db = getDb(ctx);
  const now = Date.now();
  const created = await insertIdempotentEvent(
    db,
    eventKey,
    input.recordedAt,
    { kind: "pipeline_outcome", ...storedOutcome },
    now,
  );
  if (!created) return { created: false, disposition: "duplicate" };
  await ensureAiCostLedgerCoverageForCtx(ctx, now);
  await addRollupDelta(
    db,
    {
      bucketStart: utcDayStart(input.recordedAt),
      source: input.source,
      provider: input.provider,
      operation: input.operation,
    },
    {
      pipelineGeneratedSections: input.generatedSections,
      pipelineReusedSections: input.reusedSections,
    },
    now,
  );
  return { created: true, disposition: "inserted" };
};

export const getGenerationMaturation = (
  event: Record<string, unknown>,
  now: number,
): {
  generationUseState: "no_observed_meaningful_use";
  rollupDelta: RollupDelta;
} | null => {
  if (
    event.kind !== "generation_asset" ||
    event.generationUseState !== "awaiting_observation" ||
    typeof event.observationEndsAt !== "number" ||
    event.observationEndsAt > now
  ) {
    return null;
  }
  return {
    generationUseState: "no_observed_meaningful_use",
    rollupDelta: {
      generationAwaitingObservation: -1,
      generationNoObservedMeaningfulUse: 1,
    },
  };
};

const assertMaintenanceLimit = (limit: number): void => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("AI cost ledger maintenance limit must be from 1 to 500.");
  }
};

export const finalizeGenerationUseCohortsForCtx = async (
  ctx: LedgerMutationCtx,
  { now = Date.now(), limit = 500 }: { now?: number; limit?: number } = {},
): Promise<{ processed: number; finalized: number; hasMore: boolean }> => {
  assertSafeTimestamp(now, "now");
  assertMaintenanceLimit(limit);
  const db = getDb(ctx);
  const rows = await db
    .query("aiCostLedgerEvents")
    .withIndex("by_observationEndsAt", (query) =>
      query.gt("observationEndsAt", 0).lte("observationEndsAt", now),
    )
    .take(limit);
  let finalized = 0;
  for (const row of rows) {
    const maturation = getGenerationMaturation(row.event, now);
    const privacyReducedEvent = await clearGenerationAssetLinkage(db, row);
    if (!maturation) {
      await db.patch(row._id, {
        observationEndsAt: null,
        event: privacyReducedEvent,
        updatedAt: now,
      });
      continue;
    }
    const source = row.event.source;
    const provider = row.event.provider;
    if (
      !(AI_COST_SOURCES as readonly unknown[]).includes(source) ||
      !(AI_COST_PROVIDERS as readonly unknown[]).includes(provider)
    ) {
      throw new Error("Generation event dimensions are invalid.");
    }
    await db.patch(row._id, {
      observationEndsAt: null,
      event: {
        ...privacyReducedEvent,
        generationUseState: maturation.generationUseState,
      },
      updatedAt: now,
    });
    await addRollupDelta(
      db,
      {
        bucketStart: row.eventDay,
        source: source as AiCostSource,
        provider: provider as AiCostProvider,
        operation: "tts",
      },
      maturation.rollupDelta,
      now,
    );
    finalized += 1;
  }
  return { processed: rows.length, finalized, hasMore: rows.length === limit };
};

export const cleanupExpiredAiCostLedgerEventsForCtx = async (
  ctx: LedgerMutationCtx,
  { now = Date.now(), limit = 500 }: { now?: number; limit?: number } = {},
): Promise<{ deleted: number; hasMore: boolean }> => {
  assertSafeTimestamp(now, "now");
  assertMaintenanceLimit(limit);
  const db = getDb(ctx);
  const rows = await db
    .query("aiCostLedgerEvents")
    .withIndex("by_expiresAt", (query) => query.lte("expiresAt", now))
    .take(limit);
  for (const row of rows) {
    await clearGenerationAssetLinkage(db, row);
    const maturation = getGenerationMaturation(row.event, now);
    if (maturation) {
      const source = row.event.source;
      const provider = row.event.provider;
      if (
        !(AI_COST_SOURCES as readonly unknown[]).includes(source) ||
        !(AI_COST_PROVIDERS as readonly unknown[]).includes(provider)
      ) {
        throw new Error("Generation event dimensions are invalid.");
      }
      await addRollupDelta(
        db,
        {
          bucketStart: row.eventDay,
          source: source as AiCostSource,
          provider: provider as AiCostProvider,
          operation: "tts",
        },
        maturation.rollupDelta,
        now,
      );
    }
    await db.delete(row._id);
  }
  return { deleted: rows.length, hasMore: rows.length === limit };
};
