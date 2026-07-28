#!/usr/bin/env node

import { mkdir, open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_REPORT_DAYS = 90;
const DEFAULT_TERMINAL_LIMIT = 50;
const DEFAULT_EXPORT_LIMIT = 10_000;
const MAX_BREAKDOWN_LIMIT = 10_000;
const REPORT_TIMEOUT_MS = 60_000;
const CSV_HEADERS = [
  "breakdown",
  "key",
  "estimated_direct_ai_cost_micros",
  "reconciled_direct_ai_cost_micros",
];
const HELP_TEXT = `Curio Garden AI cost command

Usage:
  npm run analytics:costs -- --from YYYY-MM-DD --to YYYY-MM-DD
  npm run analytics:costs -- --from YYYY-MM-DD --to YYYY-MM-DD --limit 100
  npm run analytics:costs -- --from YYYY-MM-DD --to YYYY-MM-DD --csv
  npm run analytics:costs -- --from YYYY-MM-DD --to YYYY-MM-DD --csv --output <path>
  npm run analytics:costs -- --from YYYY-MM-DD --to YYYY-MM-DD --json

Options:
  --from <date>          First UTC day to include, in YYYY-MM-DD form.
  --to <date>            Exclusive UTC end day, in YYYY-MM-DD form.
  --csv                  Export cost totals and breakdowns as CSV.
  --output <path>        Write CSV to this new file. Existing files are preserved.
  --limit <count>        Maximum entries in each cost breakdown.
  --json                 Print machine-readable JSON instead of the terminal view.
  -h, --help             Show this help.

The date range is half-open [from, to) and is limited to 90 days.
The terminal view defaults to 50 entries per breakdown. CSV exports up to 10000
entries per breakdown to .reports/ai-costs/<timestamp>.csv by default. Headline
totals are never truncated and always refer to the complete requested period;
an unavailable total remains unavailable. Provider-reported reconciled spend
and locally estimated spend remain separately labeled.
Report requests time out after 60 seconds.
`;

const takeFlagValue = (args, index, flag, noun = "value") => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a ${noun}.`);
  }
  return value;
};

const assertUtcDate = (value, flag) => {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`${flag} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${flag} must be a real UTC date in YYYY-MM-DD form.`);
  }
};

export const parseArgs = (args) => {
  const options = {
    csv: false,
    from: undefined,
    help: false,
    json: false,
    limit: undefined,
    output: undefined,
    to: undefined,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--csv") {
      options.csv = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--from" || argument === "--to") {
      options[argument.slice(2)] = takeFlagValue(args, index, argument);
      index += 1;
    } else if (argument === "--output") {
      options.output = takeFlagValue(args, index, argument, "path");
      index += 1;
    } else if (argument === "--limit") {
      const value = args[index + 1];
      const limit = Number(value);
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAX_BREAKDOWN_LIMIT
      ) {
        throw new Error("--limit must be an integer from 1 to 10000.");
      }
      options.limit = limit;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (options.output && !options.csv) {
    throw new Error("--output requires --csv.");
  }
  if (options.csv && options.json) {
    throw new Error("--csv and --json cannot be used together.");
  }
  if (options.help) return options;

  if (!options.from || !options.to) {
    throw new Error("--from and --to are required.");
  }
  assertUtcDate(options.from, "--from");
  assertUtcDate(options.to, "--to");
  if (options.to <= options.from) {
    throw new Error("--to must be after --from.");
  }
  if (
    Date.parse(`${options.to}T00:00:00.000Z`) -
      Date.parse(`${options.from}T00:00:00.000Z`) >
    MAX_REPORT_DAYS * DAY_MS
  ) {
    throw new Error("AI cost reports are limited to 90 days.");
  }

  return options;
};

export const resolveReportUrl = ({ baseUrl, from, to }) => {
  const url = new URL("/api/analytics/costs", baseUrl);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  return url.toString();
};

const formatMicros = (value) =>
  Number.isSafeInteger(value)
    ? `$${(value / 1_000_000).toFixed(6)}`
    : "unavailable";

const formatRatio = (value) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : "unavailable";

const formatNumber = (value, digits = 0) =>
  typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : "unavailable";

const formatInlineLabel = (value) => {
  if (typeof value !== "string") return "unknown";
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "unknown";
};

const addStringList = (lines, heading, values) => {
  lines.push(`## ${heading}`, "");
  if (!Array.isArray(values) || values.length === 0) {
    lines.push("- None reported.", "");
    return;
  }
  for (const value of values) lines.push(`- ${value}`);
  lines.push("");
};

const addCostBreakdown = (
  lines,
  heading,
  values,
  { key, label, plural, limit },
) => {
  lines.push(`## ${heading}`, "");
  if (!Array.isArray(values) || values.length === 0) {
    lines.push("- None reported.", "");
    return;
  }

  const shown = values.slice(0, limit);
  for (const [index, value] of shown.entries()) {
    lines.push(
      `Entry ${index + 1} of ${shown.length}`,
      `- ${label}: ${formatInlineLabel(value?.[key])}`,
      `- Estimated direct AI spend: ${formatMicros(value?.estimated_direct_ai_cost_micros)}`,
      `- Reconciled direct AI spend: ${formatMicros(value?.reconciled_direct_ai_cost_micros)}`,
      "",
    );
  }
  if (values.length > shown.length) {
    lines.push(
      `More ${plural} entries are available. Increase --limit to view them.`,
      "",
    );
  }
};

export const formatHumanReport = (
  report,
  { limit = DEFAULT_TERMINAL_LIMIT } = {},
) => {
  const lines = [
    "# Curio Garden AI cost ledger",
    "",
    `UTC range: ${report.range?.from ?? "unknown"} to ${report.range?.to ?? "unknown"} (exclusive)`,
    "",
    "## Direct AI cost",
    "",
    `- Estimated direct AI spend: ${formatMicros(report.costs?.estimated_direct_ai_cost_micros)}`,
    `- Known estimated subtotal: ${formatMicros(report.costs?.estimated_direct_ai_cost_known_subtotal_micros)}`,
    `- Estimate quality: ${formatInlineLabel(report.costs?.estimated_direct_ai_cost_quality)}`,
    `- Estimate availability note: ${report.costs?.estimated_direct_ai_cost_reason ?? "No known estimate gap."}`,
    `- Reconciled direct AI spend: ${formatMicros(report.costs?.reconciled_direct_ai_cost_micros)}`,
    `- Reconciled quality: ${formatInlineLabel(report.costs?.reconciled_direct_ai_cost_quality)}`,
    `- Reconciled statement amount allocated to breakdowns: ${formatMicros(report.costs?.reconciled_allocated_micros)}`,
    `- Reconciled statement amount left unallocated: ${formatMicros(report.costs?.reconciled_unallocated_micros)}`,
    `- Estimate-to-actual variance: ${formatMicros(report.costs?.estimate_to_actual_variance_micros)}`,
    `- Variance availability note: ${report.costs?.estimate_to_actual_variance_reason ?? "No known variance gap."}`,
    `- Allocated infrastructure spend: ${formatMicros(report.costs?.allocated_infrastructure_cost_micros)}`,
    `- Infrastructure allocation note: ${report.costs?.allocated_infrastructure_cost_reason ?? "No explanation supplied."}`,
    `- Fully loaded spend: ${formatMicros(report.costs?.fully_loaded_cost_micros)}`,
    `- Fully loaded availability note: ${report.costs?.fully_loaded_cost_reason ?? "No explanation supplied."}`,
    `- Reconciliation coverage: ${formatRatio(report.costs?.reconciliation?.coverage_fraction)}`,
    `- Reconciliation quality: ${report.costs?.reconciliation?.quality ?? "unknown"}`,
    `- Reconciliation allocation quality: ${report.costs?.reconciliation?.allocation_quality ?? "unavailable"}`,
    `- Reconciliation allocation methods: ${Array.isArray(report.costs?.reconciliation?.allocation_methods) && report.costs.reconciliation.allocation_methods.length > 0 ? report.costs.reconciliation.allocation_methods.map(formatInlineLabel).join(", ") : "none"}`,
    `- Reconciliation note: ${report.costs?.reconciliation?.explanation ?? "No explanation supplied."}`,
    "",
  ];

  addCostBreakdown(lines, "Daily direct AI spend", report.costs?.daily, {
    key: "day",
    label: "Day",
    plural: "daily",
    limit,
  });
  addCostBreakdown(
    lines,
    "Direct AI spend by provider",
    report.costs?.by_provider,
    { key: "provider", label: "Provider", plural: "provider", limit },
  );
  addCostBreakdown(
    lines,
    "Direct AI spend by operation",
    report.costs?.by_operation,
    { key: "operation", label: "Operation", plural: "operation", limit },
  );

  lines.push(
    "## Provider attempts and fallback",
    "",
    `- Provider attempts: ${formatNumber(report.costs?.attempts?.total)}`,
    `- Successful attempts: ${formatNumber(report.costs?.attempts?.successful)}`,
    `- Failed before dispatch: ${formatNumber(report.costs?.attempts?.failed_before_dispatch)}`,
    `- Failed after dispatch: ${formatNumber(report.costs?.attempts?.failed_after_dispatch)}`,
    `- Unknown after dispatch: ${formatNumber(report.costs?.attempts?.unknown_after_dispatch)}`,
    `- Potentially billable attempts: ${formatNumber(report.costs?.attempts?.potentially_billable)}`,
    `- Fallback attempts: ${formatNumber(report.costs?.fallback?.attempts)}`,
    `- Successful fallback attempts: ${formatNumber(report.costs?.fallback?.succeeded)}`,
    "",
    "## Generation and cache",
    "",
    `- Unique generated audio hours: ${formatNumber((report.audio?.unique_generated_audio_seconds ?? NaN) / 3600, 2)}`,
    `- Generated response bytes: ${formatNumber(report.audio?.response_audio_bytes)}`,
    `- Cache request hit rate: ${formatRatio(report.cache?.cache_request_hit_rate)}`,
    `- Cache hits: ${formatNumber(report.cache?.cache_hits)}`,
    `- Cache misses: ${formatNumber(report.cache?.cache_misses)}`,
    `- Unique generated assets: ${formatNumber(report.cache?.unique_generated_assets)}`,
    `- Reused asset serves: ${formatNumber(report.cache?.reused_asset_serves)}`,
    `- Avoided generation: ${formatNumber(report.cache?.avoided_generation)}`,
    `- Reuse factor: ${formatNumber(report.cache?.reuse_factor, 2)}`,
    `- Concurrent generation races: ${formatNumber(report.cache?.concurrent_generation_races)}`,
    `- Cache write failures: ${formatNumber(report.cache?.cache_write_failures)}`,
    `- Pipeline generated sections: ${formatNumber(report.cache?.pipeline_generated_sections)}`,
    `- Pipeline reused sections: ${formatNumber(report.cache?.pipeline_reused_sections)}`,
    "",
    "## Observed useful listening",
    "",
    `- Signed-in unique heard seconds: ${formatNumber(report.listening?.signed_in_unique_heard_seconds)}`,
    `- Signed-in unique heard hours: ${formatNumber(report.listening?.signed_in_unique_heard_hours, 2)}`,
    `- Reconciled direct AI cost per observed useful hour: ${formatMicros(report.unit_costs?.reconciled_direct_ai_cost_per_observed_useful_hour)}`,
    `- Unit-cost coverage quality: ${report.unit_costs?.reconciled_direct_ai_cost_per_observed_useful_hour_coverage_quality ?? "unknown"}`,
    `- Direct unit-cost note: ${report.unit_costs?.reconciled_direct_ai_cost_per_observed_useful_hour_reason ?? report.unit_costs?.explanation ?? "Available for the reported evidence."}`,
    `- Fully loaded cost per observed useful hour: ${formatMicros(report.unit_costs?.fully_loaded_cost_per_observed_useful_hour)}`,
    `- Fully loaded unit-cost note: ${report.unit_costs?.fully_loaded_cost_per_observed_useful_hour_reason ?? report.unit_costs?.explanation ?? "No explanation supplied."}`,
    "",
    "## 30-day generation-use cohorts",
    "",
    `- Observed meaningful use: ${formatNumber(report.generation_use?.observed_meaningful_use)}`,
    `- No observed meaningful use: ${formatNumber(report.generation_use?.no_observed_meaningful_use)}`,
    `- Awaiting observation: ${formatNumber(report.generation_use?.awaiting_observation)}`,
    `- External consumption unknown: ${formatNumber(report.generation_use?.external_consumption_unknown)}`,
    `- Observed meaningful use rate: ${formatRatio(report.generation_use?.observed_meaningful_use_rate)}`,
    `- No observed meaningful use rate: ${formatRatio(report.generation_use?.no_observed_meaningful_use_rate)}`,
    `- Cohort rate note: ${report.generation_use?.rate_reason ?? "A mature observable cohort is available."}`,
    "",
    "## Coverage",
    "",
    `- Coverage starts at: ${report.coverage?.starts_at ?? "unknown"}`,
    `- First observed activity day in this range: ${report.coverage?.observed_activity_start_day ?? "none"}`,
    `- Temporal range coverage: ${report.coverage?.range_coverage ?? "unknown"}`,
    `- Instrumentation completeness: ${report.coverage?.instrumentation_completeness ?? "unknown"}`,
    `- Instrumentation note: ${report.coverage?.instrumentation_completeness_reason ?? "No explanation supplied."}`,
    `- Reconciliation allocation status: ${report.coverage?.reconciliation_status ?? "unknown"}`,
    "",
    "## Measurement quality",
    "",
    `- Known estimate attempts: ${formatNumber(report.coverage?.measurement_quality_counts?.estimated_cost_known_attempts)}`,
    `- Unknown estimate attempts: ${formatNumber(report.coverage?.measurement_quality_counts?.estimated_cost_unknown_attempts)}`,
    `- Provider-usage estimate attempts: ${formatNumber(report.coverage?.measurement_quality_counts?.derived_from_provider_usage_attempts)}`,
    `- Locally measured estimate attempts: ${formatNumber(report.coverage?.measurement_quality_counts?.locally_measured_estimate_attempts)}`,
    `- Provider-attempt accounting gap rows: ${formatNumber(report.coverage?.measurement_quality_counts?.provider_attempt_accounting_gap_rows)}`,
    `- Measured generation duration milliseconds: ${formatNumber(report.coverage?.measurement_quality_counts?.measured_generation_duration_ms)}`,
    `- Estimated generation duration milliseconds: ${formatNumber(report.coverage?.measurement_quality_counts?.estimated_generation_duration_ms)}`,
    "",
  );

  addStringList(
    lines,
    "Excluded populations",
    report.coverage?.excluded_populations,
  );
  addStringList(lines, "Known blind spots", report.coverage?.known_blind_spots);

  return lines.join("\n").trimEnd();
};

const quoteCsv = (value) => {
  let text = value == null ? "" : String(value);
  if (
    typeof value === "string" &&
    /^(?:[\u0000-\u001f\u007f-\u009f]|[\s\u0000-\u001f\u007f-\u009f]*[=+\-@|])/.test(
      text,
    )
  ) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const buildCostCsvRows = (report, limit) => {
  const costs = report?.costs ?? {};
  const rows = [
    {
      breakdown: "total",
      key: "all",
      estimated: costs.estimated_direct_ai_cost_micros,
      reconciled: costs.reconciled_direct_ai_cost_micros,
    },
  ];
  const addRows = (breakdown, values, key) => {
    if (!Array.isArray(values)) return;
    for (const value of values.slice(0, limit)) {
      rows.push({
        breakdown,
        key: value?.[key],
        estimated: value?.estimated_direct_ai_cost_micros,
        reconciled: value?.reconciled_direct_ai_cost_micros,
      });
    }
  };
  addRows("day", costs.daily, "day");
  addRows("provider", costs.by_provider, "provider");
  addRows("operation", costs.by_operation, "operation");
  return rows;
};

export const serializeAiCostReportCsv = (
  report,
  { limit = DEFAULT_EXPORT_LIMIT } = {},
) => {
  const rows = buildCostCsvRows(report, limit).map((row) =>
    [row.breakdown, row.key, row.estimated, row.reconciled]
      .map(quoteCsv)
      .join(","),
  );
  return `${[CSV_HEADERS.join(","), ...rows].join("\r\n")}\r\n`;
};

const limitReportBreakdowns = (report, limit) => ({
  ...report,
  costs: {
    ...report?.costs,
    daily: Array.isArray(report?.costs?.daily)
      ? report.costs.daily.slice(0, limit)
      : report?.costs?.daily,
    by_provider: Array.isArray(report?.costs?.by_provider)
      ? report.costs.by_provider.slice(0, limit)
      : report?.costs?.by_provider,
    by_operation: Array.isArray(report?.costs?.by_operation)
      ? report.costs.by_operation.slice(0, limit)
      : report?.costs?.by_operation,
  },
});

const parseEnvLine = (line) => {
  const match = line.match(
    /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/,
  );
  if (!match) return null;
  let value = match[2];
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return [match[1], value];
};

export const loadLocalEnvFile = async (root = process.cwd()) => {
  let source;
  try {
    source = await readFile(path.join(root, ".env.local"), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }

  for (const line of source.split(/\r?\n/)) {
    const entry = parseEnvLine(line);
    if (!entry) continue;
    const [name, value] = entry;
    if (process.env[name] === undefined) process.env[name] = value;
  }
  return true;
};

export const fetchCostReport = async ({
  from,
  to,
  baseUrl = process.env.NEXT_PUBLIC_SITE_URL,
  secret = process.env.ANALYTICS_REPORT_SECRET,
  fetchImpl = fetch,
  timeoutMs = REPORT_TIMEOUT_MS,
}) => {
  if (!baseUrl?.trim()) throw new Error("NEXT_PUBLIC_SITE_URL is required.");
  if (!secret?.trim()) throw new Error("ANALYTICS_REPORT_SECRET is required.");

  const signal = AbortSignal.timeout(timeoutMs);
  let response;
  try {
    response = await fetchImpl(resolveReportUrl({ baseUrl, from, to }), {
      headers: { Authorization: `Bearer ${secret.trim()}` },
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Cost report request timed out after ${timeoutMs} ms.`, {
        cause: error,
      });
    }
    throw error;
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(
      detail
        ? `Cost report failed with ${response.status}: ${detail}`
        : `Cost report failed with ${response.status}.`,
    );
  }
  return await response.json();
};

const defaultExportPath = (cwd, now) => {
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  return path.join(cwd, ".reports", "ai-costs", `ai-costs-${timestamp}.csv`);
};

const openNewPrivateExport = async (outputPath, { mkdirImpl, openFile }) => {
  await mkdirImpl(path.dirname(outputPath), { recursive: true });
  try {
    return await openFile(outputPath, "wx", 0o600);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      throw new Error(
        `Refusing to overwrite existing AI cost export: ${outputPath}`,
      );
    }
    throw error;
  }
};

export const main = async (
  args = process.argv.slice(2),
  cwd = process.cwd(),
  {
    fetchReport = fetchCostReport,
    loadEnv = loadLocalEnvFile,
    mkdirImpl = mkdir,
    now = new Date(),
    openFile = open,
    removeFile = rm,
    writeStdout = (text) => process.stdout.write(text),
  } = {},
) => {
  const options = parseArgs(args);
  if (options.help) {
    writeStdout(HELP_TEXT);
    return;
  }

  let exportHandle;
  let exportPath;
  let removePartialExport = false;

  try {
    if (options.csv) {
      exportPath = options.output
        ? path.resolve(cwd, options.output)
        : defaultExportPath(cwd, now);
      exportHandle = await openNewPrivateExport(exportPath, {
        mkdirImpl,
        openFile,
      });
      removePartialExport = true;
    }

    await loadEnv(cwd);
    const report = await fetchReport(options);

    if (options.csv) {
      const limit = options.limit ?? DEFAULT_EXPORT_LIMIT;
      const rows = buildCostCsvRows(report, limit);
      await exportHandle.writeFile(
        serializeAiCostReportCsv(report, { limit }),
        "utf8",
      );
      removePartialExport = false;
      await exportHandle.close();
      exportHandle = undefined;
      writeStdout(
        `Exported ${rows.length} AI cost ${rows.length === 1 ? "row" : "rows"} to ${exportPath}.\n`,
      );
      return;
    }

    if (options.json) {
      const output = options.limit
        ? limitReportBreakdowns(report, options.limit)
        : report;
      writeStdout(`${JSON.stringify(output, null, 2)}\n`);
      return;
    }

    writeStdout(
      `${formatHumanReport(report, {
        limit: options.limit ?? DEFAULT_TERMINAL_LIMIT,
      })}\n`,
    );
  } catch (error) {
    let cleanupError;
    if (exportHandle) {
      try {
        await exportHandle.close();
      } catch (closeError) {
        cleanupError = closeError;
      }
    }
    if (removePartialExport && exportPath) {
      try {
        await removeFile(exportPath, { force: true });
      } catch (removeError) {
        cleanupError ??= removeError;
      }
    }
    if (cleanupError) {
      throw new Error(
        `Could not remove partial AI cost export: ${exportPath ?? "unknown path"}`,
        { cause: error },
      );
    }
    throw error;
  }
};

export const runCli = async ({ args = process.argv.slice(2) } = {}) =>
  await main(args);

export const isDirectInvocation = (moduleUrl, entryPath) =>
  Boolean(entryPath) &&
  pathToFileURL(path.resolve(entryPath)).href === moduleUrl;

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(
      `AI cost report failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
}
