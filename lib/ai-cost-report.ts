import type {
  AiCostAllocationMethod,
  AiCostOperation,
  AiCostProvider,
  AiCostSource,
  AiCostStatementInput,
  AiCostStatementServiceScope,
} from "./ai-cost-ledger-contract";

const DAY_MS = 24 * 60 * 60 * 1_000;

export type AiCostDailyRollupInput = {
  key: string;
  bucketStart: number;
  source: AiCostSource;
  provider: AiCostProvider | null;
  operation: AiCostOperation | null;
  providerAttempts: number;
  successfulAttempts: number;
  failedBeforeDispatchAttempts: number;
  failedAfterDispatchAttempts: number;
  ambiguousAfterDispatchAttempts: number;
  potentiallyBillableAttempts: number;
  fallbackAttempts: number;
  fallbackSucceededAttempts: number;
  inputCharacters: number;
  inputWords: number;
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
  webSearchCalls: number;
  providerResponseAudioBytes: number;
  providerAudioDurationMeasuredMs: number;
  providerAudioDurationEstimatedMs: number;
  estimatedDirectAiCostMicros: number;
  estimatedCostKnownAttempts: number;
  estimatedCostProviderUsageAttempts: number;
  estimatedCostLocalEstimateAttempts: number;
  estimatedCostUnknownAttempts: number;
  cacheRequests: number;
  cacheHits: number;
  cacheMisses: number;
  reusedAssetServes: number;
  avoidedGeneration: number;
  uniqueGeneratedAssets: number;
  concurrentGenerationRaces: number;
  cacheWriteFailures: number;
  idempotentRetryWrites: number;
  cacheServedBytes: number;
  cacheServedDurationMs: number;
  uniqueGeneratedBytes: number;
  uniqueGeneratedDurationMeasuredMs: number;
  uniqueGeneratedDurationEstimatedMs: number;
  pipelineGeneratedSections: number;
  pipelineReusedSections: number;
  signedInUniqueHeardMs: number;
  generationAwaitingObservation: number;
  generationObservedMeaningfulUse: number;
  generationNoObservedMeaningfulUse: number;
  generationExternalConsumptionUnknown: number;
};

export type AiCostStatementRecord = AiCostStatementInput & {
  periodStart: number;
  periodEnd: number;
};

export type LargestRemainderAllocation = {
  allocations: Record<string, number>;
  unallocatedMicros: number;
};

export const allocateMicrosByLargestRemainder = (
  totalMicros: number,
  entries: Array<{ key: string; weight: number }>,
): LargestRemainderAllocation => {
  if (!Number.isSafeInteger(totalMicros) || totalMicros < 0) {
    throw new Error("Allocation total must be a non-negative safe integer.");
  }
  const weights = new Map<string, number>();
  for (const { key, weight } of entries) {
    if (!key || !Number.isSafeInteger(weight) || weight < 0) {
      throw new Error(
        "Allocation weights must be keyed non-negative integers.",
      );
    }
    const nextWeight = (weights.get(key) ?? 0) + weight;
    if (!Number.isSafeInteger(nextWeight)) {
      throw new Error("Combined allocation weight exceeds safe integers.");
    }
    weights.set(key, nextWeight);
  }
  const sortedKeys = [...weights.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  const allocations = Object.fromEntries(
    sortedKeys.map((key) => [key, 0]),
  ) as Record<string, number>;
  const positive = sortedKeys.filter((key) => (weights.get(key) ?? 0) > 0);
  if (positive.length === 0 || totalMicros === 0) {
    return {
      allocations,
      unallocatedMicros: positive.length === 0 ? totalMicros : 0,
    };
  }

  const totalWeight = positive.reduce(
    (sum, key) => sum + BigInt(weights.get(key) ?? 0),
    BigInt(0),
  );
  const total = BigInt(totalMicros);
  const remainders: Array<{ key: string; remainder: bigint }> = [];
  let allocated = BigInt(0);
  for (const key of positive) {
    const weighted = total * BigInt(weights.get(key) ?? 0);
    const floor = weighted / totalWeight;
    allocations[key] = Number(floor);
    allocated += floor;
    remainders.push({ key, remainder: weighted % totalWeight });
  }
  remainders.sort((left, right) => {
    if (left.remainder === right.remainder) {
      return left.key.localeCompare(right.key);
    }
    return left.remainder > right.remainder ? -1 : 1;
  });
  const remainderCount = Number(total - allocated);
  for (let index = 0; index < remainderCount; index += 1) {
    allocations[remainders[index].key] += 1;
  }
  return { allocations, unallocatedMicros: 0 };
};

const sum = (values: number[]): number =>
  values.reduce((total, value) => total + value, 0);

const addSafeIntegers = (
  left: number,
  right: number,
  label: string,
): number => {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw new Error(`${label} must contain only safe integers.`);
  }
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${label} exceeds the safe integer range.`);
  }
  return result;
};

const sumSafeIntegers = (values: number[], label: string): number =>
  values.reduce((total, value) => addSafeIntegers(total, value, label), 0);

const sumField = <K extends keyof AiCostDailyRollupInput>(
  rows: AiCostDailyRollupInput[],
  field: K,
): number =>
  sum(
    rows.map((row) => {
      const value = row[field];
      return typeof value === "number" ? value : 0;
    }),
  );

const sumSafeIntegerField = <K extends keyof AiCostDailyRollupInput>(
  rows: AiCostDailyRollupInput[],
  field: K,
  label: string,
): number =>
  sumSafeIntegers(
    rows.map((row) => {
      const value = row[field];
      return typeof value === "number" ? value : 0;
    }),
    label,
  );

const dayString = (timestamp: number): string =>
  new Date(timestamp).toISOString().slice(0, 10);

const nullableRatio = (
  numerator: number,
  denominator: number,
): number | null => (denominator === 0 ? null : numerator / denominator);

const rowHasDirectCostEvidence = (row: AiCostDailyRollupInput): boolean =>
  row.potentiallyBillableAttempts > 0 ||
  row.estimatedDirectAiCostMicros > 0 ||
  row.estimatedCostUnknownAttempts > 0 ||
  row.providerResponseAudioBytes > 0 ||
  row.uniqueGeneratedAssets > 0 ||
  row.uniqueGeneratedBytes > 0 ||
  row.pipelineGeneratedSections > 0;

const rowHasProviderAttemptAccountingGap = (
  row: AiCostDailyRollupInput,
): boolean =>
  row.estimatedCostKnownAttempts + row.estimatedCostUnknownAttempts !==
  row.providerAttempts;

const estimatedCostIsComplete = (rows: AiCostDailyRollupInput[]): boolean =>
  sumField(rows, "estimatedCostUnknownAttempts") === 0 &&
  !rows.some(rowHasProviderAttemptAccountingGap);

const scopeIncludesRow = (
  scope: AiCostStatementServiceScope,
  row: AiCostDailyRollupInput,
): boolean => {
  if (scope === "all_direct_ai") return row.operation !== null;
  if (scope === "speech") return row.operation === "tts";
  if (scope === "responses") {
    return row.operation !== null && row.operation !== "tts";
  }
  return row.operation === "trending_brief_research";
};

const statementWeight = (
  method: AiCostAllocationMethod,
  row: AiCostDailyRollupInput,
): number => {
  if (method === "estimated_cost_weight") {
    return row.estimatedDirectAiCostMicros;
  }
  if (method === "input_tokens") return row.inputTokens;
  if (method === "input_characters") return row.inputCharacters;
  if (method === "web_search_calls") return row.webSearchCalls;
  return 0;
};

const allocationEvidenceIsCompatible = (
  statement: AiCostStatementRecord,
  rows: AiCostDailyRollupInput[],
): boolean => {
  if (statement.allocationMethod === "unallocated") return false;
  if (rows.some(rowHasProviderAttemptAccountingGap)) return false;
  if (statement.allocationMethod === "web_search_calls") {
    return statement.serviceScope === "web_search";
  }
  if (statement.serviceScope === "web_search") {
    return false;
  }
  if (
    statement.serviceScope === "responses" &&
    statement.allocationMethod === "estimated_cost_weight" &&
    rows.some((row) => row.webSearchCalls > 0)
  ) {
    return false;
  }
  const hasSpeech = rows.some(
    (row) => row.operation === "tts" && rowHasDirectCostEvidence(row),
  );
  if (hasSpeech && statement.allocationMethod === "input_tokens") return false;
  if (
    statement.allocationMethod === "estimated_cost_weight" &&
    rows.some((row) => row.estimatedCostUnknownAttempts > 0)
  ) {
    return false;
  }
  return true;
};

const addToMap = <K extends string>(
  map: Map<K, number>,
  key: K,
  amount: number,
) => {
  map.set(
    key,
    addSafeIntegers(map.get(key) ?? 0, amount, "Reconciled cost aggregate"),
  );
};

const roundMicrosPerObservedHour = (
  amountMicros: number,
  heardMs: number,
): number | null => {
  const denominator = BigInt(heardMs);
  const numerator = BigInt(amountMicros) * BigInt(3_600_000);
  const rounded = (numerator + denominator / BigInt(2)) / denominator;
  return rounded > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(rounded);
};

type ReconciliationSelection = {
  complete: boolean;
  selected: AiCostStatementRecord[];
  explanation: string;
  conflictCount: number;
};

const selectExactReconciliation = ({
  from,
  to,
  rollups,
  statements,
}: {
  from: number;
  to: number;
  rollups: AiCostDailyRollupInput[];
  statements: AiCostStatementRecord[];
}): ReconciliationSelection => {
  const exact = statements.filter(
    (statement) => statement.periodStart === from && statement.periodEnd === to,
  );
  const nonExactOverlaps = statements.filter(
    (statement) => statement.periodStart !== from || statement.periodEnd !== to,
  );
  if (nonExactOverlaps.length > 0) {
    return {
      complete: false,
      selected: [],
      explanation:
        "A partially overlapping provider statement makes this range ambiguous; statements must exactly match the requested UTC period.",
      conflictCount: nonExactOverlaps.length,
    };
  }
  const providers = new Set<AiCostProvider>(
    rollups.flatMap((row) =>
      row.provider && rowHasDirectCostEvidence(row) ? [row.provider] : [],
    ),
  );
  for (const statement of exact) providers.add(statement.provider);
  if (providers.size === 0) {
    return {
      complete: false,
      selected: [],
      explanation:
        "No exact-period provider statement is available for this range.",
      conflictCount: 0,
    };
  }

  const selected: AiCostStatementRecord[] = [];
  let conflictCount = 0;
  for (const provider of providers) {
    const providerRows = rollups.filter((row) => row.provider === provider);
    const providerStatements = exact.filter(
      (statement) => statement.provider === provider,
    );
    const allDirect = providerStatements.filter(
      (statement) => statement.serviceScope === "all_direct_ai",
    );
    const scoped = providerStatements.filter(
      (statement) => statement.serviceScope !== "all_direct_ai",
    );
    if (allDirect.length === 1 && scoped.length === 0) {
      selected.push(allDirect[0]);
      continue;
    }
    if (allDirect.length > 0) {
      conflictCount += Math.max(1, allDirect.length + scoped.length - 1);
      continue;
    }

    const requiredScopes = new Set<AiCostStatementServiceScope>();
    if (
      providerRows.some(
        (row) => row.operation === "tts" && rowHasDirectCostEvidence(row),
      )
    ) {
      requiredScopes.add("speech");
    }
    if (
      providerRows.some(
        (row) =>
          row.operation !== null &&
          row.operation !== "tts" &&
          rowHasDirectCostEvidence(row),
      )
    ) {
      requiredScopes.add("responses");
    }
    if (providerRows.some((row) => row.webSearchCalls > 0)) {
      requiredScopes.add("web_search");
    }
    const byScope = new Map<
      AiCostStatementServiceScope,
      AiCostStatementRecord[]
    >();
    for (const statement of scoped) {
      const entries = byScope.get(statement.serviceScope) ?? [];
      entries.push(statement);
      byScope.set(statement.serviceScope, entries);
    }
    const duplicateScopes = [...byScope.values()].filter(
      (entries) => entries.length > 1,
    );
    const missingRequired = [...requiredScopes].filter(
      (scope) => (byScope.get(scope)?.length ?? 0) !== 1,
    );
    const extraScopes = [...byScope.keys()].filter(
      (scope) => !requiredScopes.has(scope),
    );
    if (
      duplicateScopes.length > 0 ||
      missingRequired.length > 0 ||
      extraScopes.length > 0 ||
      requiredScopes.size === 0
    ) {
      conflictCount +=
        duplicateScopes.length +
        missingRequired.length +
        extraScopes.length +
        (requiredScopes.size === 0 ? 1 : 0);
      continue;
    }
    selected.push(
      ...[...requiredScopes].map((scope) => byScope.get(scope)![0]),
    );
  }

  const complete =
    conflictCount === 0 &&
    providers.size > 0 &&
    selected.length > 0 &&
    providers.size ===
      new Set(selected.map((statement) => statement.provider)).size;
  return {
    complete,
    selected: complete ? selected : [],
    explanation: complete
      ? "Disjoint provider billing-component statements exactly cover the requested UTC range and active service scopes."
      : "Provider statements do not exactly and unambiguously cover the requested UTC range and active service scopes.",
    conflictCount,
  };
};

export const buildAiCostReport = ({
  fromDay,
  toDay,
  coverageStartedAt = null,
  rollups: allRollups,
  statements: allStatements,
}: {
  fromDay: string;
  toDay: string;
  coverageStartedAt?: number | null;
  rollups: AiCostDailyRollupInput[];
  statements: AiCostStatementRecord[];
}) => {
  const from = Date.parse(`${fromDay}T00:00:00.000Z`);
  const to = Date.parse(`${toDay}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
    throw new Error("Report range must be a non-empty half-open UTC range.");
  }
  if (
    coverageStartedAt !== null &&
    (!Number.isSafeInteger(coverageStartedAt) || coverageStartedAt < 0)
  ) {
    throw new Error("Coverage start must be a non-negative integer timestamp.");
  }
  const coverageMarkerPrecedesRange =
    coverageStartedAt !== null && coverageStartedAt <= from;
  const rollups = allRollups.filter(
    (row) => row.bucketStart >= from && row.bucketStart < to,
  );
  const overlappingStatements = allStatements.filter(
    (statement) => statement.periodStart < to && statement.periodEnd > from,
  );
  const containedStatements = overlappingStatements.filter(
    (statement) => statement.periodStart >= from && statement.periodEnd <= to,
  );
  const reconciliation = selectExactReconciliation({
    from,
    to,
    rollups,
    statements: overlappingStatements,
  });
  const statements = reconciliation.selected;

  const allocationsByRollup = new Map<string, number>();
  const reconciledByProvider = new Map<AiCostProvider, number>();
  let reconciledAllocatedMicros = 0;
  let reconciledUnallocatedMicros = 0;
  for (const statement of statements) {
    addToMap(reconciledByProvider, statement.provider, statement.amountMicros);
    if (
      !coverageMarkerPrecedesRange ||
      statement.allocationMethod === "unallocated"
    ) {
      reconciledUnallocatedMicros = addSafeIntegers(
        reconciledUnallocatedMicros,
        statement.amountMicros,
        "Reconciled unallocated cost",
      );
      continue;
    }
    const eligibleRows = rollups.filter(
      (row) =>
        row.provider === statement.provider &&
        row.bucketStart >= statement.periodStart &&
        row.bucketStart < statement.periodEnd &&
        scopeIncludesRow(statement.serviceScope, row),
    );
    if (!allocationEvidenceIsCompatible(statement, eligibleRows)) {
      reconciledUnallocatedMicros = addSafeIntegers(
        reconciledUnallocatedMicros,
        statement.amountMicros,
        "Reconciled unallocated cost",
      );
      continue;
    }
    const allocation = allocateMicrosByLargestRemainder(
      statement.amountMicros,
      eligibleRows.map((row) => ({
        key: row.key,
        weight: statementWeight(statement.allocationMethod, row),
      })),
    );
    reconciledUnallocatedMicros = addSafeIntegers(
      reconciledUnallocatedMicros,
      allocation.unallocatedMicros,
      "Reconciled unallocated cost",
    );
    reconciledAllocatedMicros = addSafeIntegers(
      reconciledAllocatedMicros,
      statement.amountMicros - allocation.unallocatedMicros,
      "Reconciled allocated cost",
    );
    for (const [key, amount] of Object.entries(allocation.allocations)) {
      addToMap(allocationsByRollup, key, amount);
    }
  }

  const estimatedDirectAiCostKnownSubtotalMicros = sumSafeIntegerField(
    rollups,
    "estimatedDirectAiCostMicros",
    "Estimated direct AI cost",
  );
  const estimatedCostUnknownAttempts = sumField(
    rollups,
    "estimatedCostUnknownAttempts",
  );
  const estimatedCostProviderUsageAttempts = sumField(
    rollups,
    "estimatedCostProviderUsageAttempts",
  );
  const estimatedCostLocalEstimateAttempts = sumField(
    rollups,
    "estimatedCostLocalEstimateAttempts",
  );
  const providerAttemptAccountingGapRows = rollups.filter(
    rowHasProviderAttemptAccountingGap,
  ).length;
  const estimatedDirectAiCostMicros =
    coverageMarkerPrecedesRange && estimatedCostIsComplete(rollups)
      ? estimatedDirectAiCostKnownSubtotalMicros
      : null;
  const estimatedDirectAiCostReason = !coverageMarkerPrecedesRange
    ? "The immutable coverage marker does not precede the requested UTC range."
    : estimatedCostUnknownAttempts > 0
      ? "At least one provider attempt lacks enough usage evidence for an estimate."
      : providerAttemptAccountingGapRows > 0
        ? "Provider-attempt accounting and estimate-quality counts do not agree."
        : null;
  const reconciledDirectAiCostMicros =
    statements.length === 0
      ? null
      : sumSafeIntegers(
          statements.map((statement) => statement.amountMicros),
          "Reconciled direct AI cost",
        );
  const reconciliationBreakdownsComplete =
    statements.length > 0 &&
    coverageMarkerPrecedesRange &&
    providerAttemptAccountingGapRows === 0 &&
    reconciledUnallocatedMicros === 0;
  const reconciledByDay = new Map<string, number>();
  const reconciledByOperation = new Map<string, number>();
  for (const row of rollups) {
    const allocation = allocationsByRollup.get(row.key);
    if (allocation === undefined) continue;
    addToMap(reconciledByDay, dayString(row.bucketStart), allocation);
    if (row.operation) {
      addToMap(reconciledByOperation, row.operation, allocation);
    }
  }

  const daily = [];
  for (let day = from; day < to; day += DAY_MS) {
    const label = dayString(day);
    const rows = rollups.filter((row) => row.bucketStart === day);
    const dayCoverageComplete =
      coverageStartedAt !== null && coverageStartedAt <= day;
    daily.push({
      day: label,
      estimated_direct_ai_cost_micros:
        dayCoverageComplete && estimatedCostIsComplete(rows)
          ? sumSafeIntegerField(
              rows,
              "estimatedDirectAiCostMicros",
              "Daily estimated direct AI cost",
            )
          : null,
      reconciled_direct_ai_cost_micros: reconciliationBreakdownsComplete
        ? (reconciledByDay.get(label) ?? 0)
        : null,
    });
  }

  const providerNames = new Set<AiCostProvider>(
    rollups.flatMap((row) => (row.provider ? [row.provider] : [])),
  );
  for (const provider of reconciledByProvider.keys())
    providerNames.add(provider);
  const byProvider = [...providerNames].sort().map((provider) => ({
    provider,
    estimated_direct_ai_cost_micros: (() => {
      const rows = rollups.filter((row) => row.provider === provider);
      return coverageMarkerPrecedesRange && estimatedCostIsComplete(rows)
        ? sumSafeIntegerField(
            rows,
            "estimatedDirectAiCostMicros",
            "Provider estimated direct AI cost",
          )
        : null;
    })(),
    reconciled_direct_ai_cost_micros:
      reconciledByProvider.get(provider) ?? null,
  }));

  const operationNames = new Set(
    rollups.flatMap((row) => (row.operation ? [row.operation] : [])),
  );
  const byOperation = [...operationNames].sort().map((operation) => ({
    operation,
    estimated_direct_ai_cost_micros: (() => {
      const rows = rollups.filter((row) => row.operation === operation);
      return coverageMarkerPrecedesRange && estimatedCostIsComplete(rows)
        ? sumSafeIntegerField(
            rows,
            "estimatedDirectAiCostMicros",
            "Operation estimated direct AI cost",
          )
        : null;
    })(),
    reconciled_direct_ai_cost_micros: reconciliationBreakdownsComplete
      ? (reconciledByOperation.get(operation) ?? 0)
      : null,
  }));

  const signedInUniqueHeardMs = sumField(rollups, "signedInUniqueHeardMs");
  const directUnitCost =
    reconciledDirectAiCostMicros === null ||
    !coverageMarkerPrecedesRange ||
    providerAttemptAccountingGapRows > 0 ||
    signedInUniqueHeardMs === 0
      ? null
      : roundMicrosPerObservedHour(
          reconciledDirectAiCostMicros,
          signedInUniqueHeardMs,
        );
  const cacheHits = sumField(rollups, "cacheHits");
  const cacheMisses = sumField(rollups, "cacheMisses");
  const uniqueGeneratedAssets = sumField(rollups, "uniqueGeneratedAssets");
  const reusedAssetServes = sumField(rollups, "reusedAssetServes");
  const measuredGenerationMs = sumField(
    rollups,
    "uniqueGeneratedDurationMeasuredMs",
  );
  const estimatedGenerationMs = sumField(
    rollups,
    "uniqueGeneratedDurationEstimatedMs",
  );
  const observedMeaningful = sumField(
    rollups,
    "generationObservedMeaningfulUse",
  );
  const noObservedMeaningful = sumField(
    rollups,
    "generationNoObservedMeaningfulUse",
  );
  const matureObservableCohort = observedMeaningful + noObservedMeaningful;
  const observedActivityStartDay =
    rollups.length === 0
      ? null
      : dayString(Math.min(...rollups.map((row) => row.bucketStart)));
  const unitCostCoverageQuality =
    coverageStartedAt === null
      ? "unknown"
      : !coverageMarkerPrecedesRange
        ? "partial_from_marker"
        : providerAttemptAccountingGapRows > 0
          ? "known_instrumentation_gaps"
          : "marker_precedes_range_no_known_gaps";

  return {
    range: {
      from: fromDay,
      to: toDay,
      timezone: "UTC",
      semantics: "[from,to)",
    },
    costs: {
      currency: "USD",
      estimated_direct_ai_cost_micros: estimatedDirectAiCostMicros,
      estimated_direct_ai_cost_known_subtotal_micros:
        estimatedDirectAiCostKnownSubtotalMicros,
      estimated_direct_ai_cost_reason: estimatedDirectAiCostReason,
      estimated_direct_ai_cost_quality:
        estimatedDirectAiCostMicros === null
          ? "unknown"
          : estimatedCostProviderUsageAttempts > 0
            ? "derived_from_provider_usage"
            : estimatedCostLocalEstimateAttempts > 0
              ? "locally_measured_estimate"
              : "unknown",
      reconciled_direct_ai_cost_micros: reconciledDirectAiCostMicros,
      reconciled_direct_ai_cost_quality:
        reconciledDirectAiCostMicros === null ? "unknown" : "provider_reported",
      reconciled_allocated_micros: reconciliation.complete
        ? reconciledAllocatedMicros
        : null,
      reconciled_unallocated_micros: reconciliation.complete
        ? reconciledUnallocatedMicros
        : null,
      allocated_infrastructure_cost_micros: null,
      allocated_infrastructure_cost_reason:
        "No explicit infrastructure allocation is configured.",
      fully_loaded_cost_micros: null,
      fully_loaded_cost_reason:
        "Fully loaded cost requires an explicit infrastructure allocation.",
      estimate_to_actual_variance_micros:
        reconciledDirectAiCostMicros === null ||
        estimatedDirectAiCostMicros === null
          ? null
          : reconciledDirectAiCostMicros - estimatedDirectAiCostMicros,
      estimate_to_actual_variance_reason:
        reconciledDirectAiCostMicros === null
          ? reconciliation.explanation
          : estimatedDirectAiCostMicros === null
            ? estimatedDirectAiCostReason
            : null,
      reconciliation: {
        quality: reconciliation.complete ? "provider_reported" : "unknown",
        coverage_fraction: reconciliation.complete ? 1 : null,
        explanation: reconciliation.explanation,
        exact_statement_count: statements.length,
        conflicting_statement_count: reconciliation.conflictCount,
        allocation_quality:
          reconciledAllocatedMicros > 0 ? "locally_allocated" : null,
        allocation_methods: [
          ...new Set(statements.map((statement) => statement.allocationMethod)),
        ].sort(),
      },
      attempts: {
        total: sumField(rollups, "providerAttempts"),
        successful: sumField(rollups, "successfulAttempts"),
        failed_before_dispatch: sumField(
          rollups,
          "failedBeforeDispatchAttempts",
        ),
        failed_after_dispatch: sumField(rollups, "failedAfterDispatchAttempts"),
        unknown_after_dispatch: sumField(
          rollups,
          "ambiguousAfterDispatchAttempts",
        ),
        potentially_billable: sumField(rollups, "potentiallyBillableAttempts"),
      },
      fallback: {
        attempts: sumField(rollups, "fallbackAttempts"),
        succeeded: sumField(rollups, "fallbackSucceededAttempts"),
      },
      daily,
      by_provider: byProvider,
      by_operation: byOperation,
    },
    audio: {
      unique_generated_audio_seconds:
        (measuredGenerationMs + estimatedGenerationMs) / 1_000,
      unique_generated_audio_hours:
        (measuredGenerationMs + estimatedGenerationMs) / 3_600_000,
      unique_generated_bytes: sumField(rollups, "uniqueGeneratedBytes"),
      response_audio_bytes: sumField(rollups, "providerResponseAudioBytes"),
      duration_measurement: {
        measured_ms: measuredGenerationMs,
        estimated_ms: estimatedGenerationMs,
      },
    },
    cache: {
      requests: sumField(rollups, "cacheRequests"),
      cache_hits: cacheHits,
      cache_misses: cacheMisses,
      cache_request_hit_rate: nullableRatio(cacheHits, cacheHits + cacheMisses),
      cache_request_hit_rate_reason:
        cacheHits + cacheMisses === 0
          ? "No cache decisions were observed."
          : null,
      unique_generated_assets: uniqueGeneratedAssets,
      reused_asset_serves: reusedAssetServes,
      avoided_generation: sumField(rollups, "avoidedGeneration"),
      reuse_factor: nullableRatio(reusedAssetServes, uniqueGeneratedAssets),
      reuse_factor_reason:
        uniqueGeneratedAssets === 0
          ? "No uniquely generated assets were observed."
          : null,
      concurrent_generation_races: sumField(
        rollups,
        "concurrentGenerationRaces",
      ),
      cache_write_failures: sumField(rollups, "cacheWriteFailures"),
      idempotent_retry_writes: sumField(rollups, "idempotentRetryWrites"),
      served_bytes: sumField(rollups, "cacheServedBytes"),
      served_audio_seconds: sumField(rollups, "cacheServedDurationMs") / 1_000,
      pipeline_generated_sections: sumField(
        rollups,
        "pipelineGeneratedSections",
      ),
      pipeline_reused_sections: sumField(rollups, "pipelineReusedSections"),
    },
    listening: {
      signed_in_unique_heard_seconds: signedInUniqueHeardMs / 1_000,
      signed_in_unique_heard_hours: signedInUniqueHeardMs / 3_600_000,
      excluded_populations: [
        "guest listening",
        "external podcast clients",
        "direct media downloads and offline playback",
      ],
    },
    unit_costs: {
      reconciled_direct_ai_cost_per_observed_useful_hour: directUnitCost,
      reconciled_direct_ai_cost_per_observed_useful_hour_coverage_quality:
        unitCostCoverageQuality,
      reconciled_direct_ai_cost_per_observed_useful_hour_reason:
        reconciledDirectAiCostMicros === null
          ? reconciliation.explanation
          : !coverageMarkerPrecedesRange
            ? "The immutable coverage marker must precede the requested UTC range."
            : providerAttemptAccountingGapRows > 0
              ? "Provider-attempt and estimate-quality counts do not agree."
              : signedInUniqueHeardMs === 0
                ? "The signed-in unique heard seconds denominator is zero."
                : null,
      fully_loaded_cost_per_observed_useful_hour: null,
      fully_loaded_cost_per_observed_useful_hour_reason:
        "No explicit infrastructure allocation is configured.",
      explanation:
        reconciledDirectAiCostMicros === null
          ? reconciliation.explanation
          : !coverageMarkerPrecedesRange
            ? "Reconciled unit cost is unavailable because the immutable coverage marker does not precede the requested range."
            : providerAttemptAccountingGapRows > 0
              ? "Reconciled unit cost is unavailable because provider-attempt and estimate-quality counts do not agree."
              : signedInUniqueHeardMs === 0
                ? "The signed-in unique heard seconds denominator is zero."
                : "Fully loaded unit cost is unavailable because no infrastructure allocation is configured.",
    },
    generation_use: {
      observation_window_days: 30,
      attribution_quality: "aggregate_article_section_inference",
      observed_meaningful_use: observedMeaningful,
      no_observed_meaningful_use: noObservedMeaningful,
      awaiting_observation: sumField(rollups, "generationAwaitingObservation"),
      external_consumption_unknown: sumField(
        rollups,
        "generationExternalConsumptionUnknown",
      ),
      observed_meaningful_use_rate: nullableRatio(
        observedMeaningful,
        matureObservableCohort,
      ),
      no_observed_meaningful_use_rate: nullableRatio(
        noObservedMeaningful,
        matureObservableCohort,
      ),
      rate_reason:
        matureObservableCohort === 0
          ? "No observable generation cohort has completed 30 days."
          : null,
    },
    coverage: {
      starts_at:
        coverageStartedAt === null
          ? null
          : new Date(coverageStartedAt).toISOString(),
      observed_activity_start_day: observedActivityStartDay,
      requested_end_day: toDay,
      range_coverage: coverageMarkerPrecedesRange
        ? "marker_precedes_requested_range"
        : coverageStartedAt === null
          ? "unknown"
          : "partial_from_marker",
      instrumentation_completeness:
        providerAttemptAccountingGapRows > 0
          ? "known_gaps"
          : coverageStartedAt === null
            ? "unknown"
            : "no_known_gaps",
      instrumentation_completeness_reason:
        providerAttemptAccountingGapRows > 0
          ? "At least one rollup's provider-attempt and estimate-quality counts do not agree."
          : coverageStartedAt === null
            ? "No immutable observe-mode coverage marker is available for this report."
            : "No rollup inconsistency was detected; best-effort delivery still cannot prove that every event was recorded.",
      fully_contained_statement_count: containedStatements.length,
      partially_overlapping_statement_count:
        overlappingStatements.length - containedStatements.length,
      reconciliation_status: reconciliation.complete
        ? !coverageMarkerPrecedesRange
          ? "provider_reported_but_marker_follows_range_start"
          : providerAttemptAccountingGapRows > 0
            ? "provider_reported_with_instrumentation_gaps"
            : reconciledUnallocatedMicros === 0
              ? "provider_reported_and_fully_allocated"
              : "provider_reported_with_unallocated_amount"
        : overlappingStatements.length === 0
          ? "no_overlapping_statement"
          : reconciliation.conflictCount > 0
            ? "ambiguous_or_conflicting_statements"
            : "no_exact_statement",
      measurement_quality_counts: {
        estimated_cost_known_attempts: sumField(
          rollups,
          "estimatedCostKnownAttempts",
        ),
        estimated_cost_unknown_attempts: sumField(
          rollups,
          "estimatedCostUnknownAttempts",
        ),
        derived_from_provider_usage_attempts:
          estimatedCostProviderUsageAttempts,
        locally_measured_estimate_attempts: estimatedCostLocalEstimateAttempts,
        provider_attempt_accounting_gap_rows: providerAttemptAccountingGapRows,
        measured_generation_duration_ms: measuredGenerationMs,
        estimated_generation_duration_ms: estimatedGenerationMs,
      },
      known_blind_spots: [
        "Signed-out listening is not observed.",
        "External podcast, download, and offline consumption is not observed.",
        "Binary speech responses do not provide token usage, so their estimated direct cost is unknown.",
        "No-known-gaps status detects rollup inconsistencies but cannot prove every best-effort event was delivered.",
        "A statement that only partially overlaps the requested range is not prorated or called reconciled.",
        "Generation-use attribution selects one conservative article/section cache variant because listening progress does not carry an exact revision/profile asset key.",
      ],
      excluded_populations: [
        "Guest listening",
        "External podcast clients",
        "Direct media downloads and offline playback",
      ],
    },
  };
};
