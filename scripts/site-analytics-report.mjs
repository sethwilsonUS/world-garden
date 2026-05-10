#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_HOURS = 24;
const DEFAULT_LIMIT = 1000;
const DEFAULT_OUTPUT_DIR = ".reports/analytics";
const SENSITIVE_TEXT_KEYS = [
  "apiKey",
  "api_key",
  "auth",
  "authorization",
  "cookie",
  "device",
  "deviceId",
  "device_id",
  "key",
  "password",
  "secret",
  "session",
  "sessionId",
  "session_id",
  "token",
  "user",
  "userId",
  "user_id",
];
const SENSITIVE_TEXT_KEY_PATTERN = SENSITIVE_TEXT_KEYS.join("|");

const parseEnvValue = (rawValue) => {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

export const loadLocalEnvFile = async (cwd = process.cwd()) => {
  const envPath = path.join(cwd, ".env.local");
  let contents = "";
  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] == null) {
      process.env[key] = parseEnvValue(rawValue);
    }
  }

  return true;
};

const sortRecord = (record) =>
  Object.fromEntries(
    Object.entries(record).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );

const increment = (record, key, amount = 1) => {
  if (!key) return;
  record[key] = (record[key] ?? 0) + amount;
};

const topEntries = (record, limit = 10) =>
  Object.entries(sortRecord(record))
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));

const formatCount = (count, noun) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;

const formatDate = (date) => date.toISOString().replace("T", " ").replace(".000Z", " UTC");

export const redactPath = (rawPath) => {
  if (!rawPath || typeof rawPath !== "string") return "(unknown)";

  const trimmed = rawPath.trim();
  if (!trimmed) return "(unknown)";

  try {
    const url = new URL(trimmed, "https://curiogarden.local");
    return url.pathname || "/";
  } catch {
    const stripped = trimmed.split(/[?#]/, 1)[0];
    return stripped || "/";
  }
};

const isSensitiveTextKey = (key) => {
  const lower = String(key).toLowerCase();
  return SENSITIVE_TEXT_KEYS.some((sensitiveKey) =>
    lower.includes(sensitiveKey.toLowerCase()),
  );
};

const redactJsonValue = (value) => {
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      isSensitiveTextKey(key) ? "[redacted]" : redactJsonValue(child),
    ]),
  );
};

const redactJsonLikeText = (text) =>
  text
    .replace(
      new RegExp(
        `(["']?\\b(?:${SENSITIVE_TEXT_KEY_PATTERN})\\b["']?\\s*:\\s*)(["'])[^"']*\\2`,
        "gi",
      ),
      "$1$2[redacted]$2",
    )
    .replace(
      new RegExp(
        `(\\b(?:${SENSITIVE_TEXT_KEY_PATTERN})\\b\\s*:\\s*)(?!["'])([^,\\s}\\]]+)`,
        "gi",
      ),
      "$1[redacted]",
    );

const redactSensitiveText = (rawText) => {
  if (!rawText || typeof rawText !== "string") return "No message provided.";

  let firstLine = rawText.split(/\r?\n/, 1)[0] ?? rawText;
  try {
    firstLine = JSON.stringify(redactJsonValue(JSON.parse(firstLine)));
  } catch {
    firstLine = redactJsonLikeText(firstLine);
  }

  return firstLine
    .replace(
      new RegExp(
        `\\b(${SENSITIVE_TEXT_KEY_PATTERN})=([^&\\s]+)`,
        "gi",
      ),
      "$1=[redacted]",
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .slice(0, 260)
    .trim();
};

export const parseVercelLogLines = (rawOutput) => {
  const logs = [];
  for (const rawLine of String(rawOutput ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || (!line.startsWith("{") && !line.startsWith("["))) continue;

    try {
      const parsed = JSON.parse(line);
      if (Array.isArray(parsed)) {
        logs.push(...parsed.filter((item) => item && typeof item === "object"));
      } else if (parsed && typeof parsed === "object") {
        logs.push(parsed);
      }
    } catch {
      // Vercel CLI status lines can land beside JSON in some shells. Ignore them.
    }
  }
  return logs;
};

export const buildLogRanges = (sinceMs, untilMs, chunkMs = HOUR_MS) => {
  const ranges = [];
  let cursor = sinceMs;
  while (cursor < untilMs) {
    const next = Math.min(cursor + chunkMs, untilMs);
    ranges.push({ since: new Date(cursor), until: new Date(next) });
    cursor = next;
  }
  return ranges;
};

const normalizeStatusCode = (log) => {
  const raw =
    log.statusCode ??
    log.status ??
    log.responseStatusCode ??
    log.proxy?.statusCode ??
    log.request?.statusCode;
  const status = Number(raw);
  return Number.isFinite(status) ? status : undefined;
};

const getRequestPath = (log) =>
  log.requestPath ??
  log.path ??
  log.url ??
  log.request?.path ??
  log.request?.url ??
  log.proxy?.path ??
  undefined;

const getCacheValue = (log) =>
  log.cache ??
  log.cacheStatus ??
  log.proxy?.cache ??
  log.proxy?.cacheStatus ??
  log.headers?.["x-vercel-cache"];

const getSourceValue = (log) =>
  log.source ?? log.type ?? log.proxy?.source ?? log.functionType ?? undefined;

const getDomainValue = (log) =>
  log.domain ?? log.host ?? log.request?.host ?? log.proxy?.host ?? undefined;

const getDeploymentValue = (log) =>
  log.deploymentId ?? log.deployment ?? log.deploymentUrl ?? log.projectId ?? undefined;

const statusGroup = (statusCode) => {
  if (!statusCode) return "unknown";
  if (statusCode >= 200 && statusCode < 300) return "2xx";
  if (statusCode >= 300 && statusCode < 400) return "3xx";
  if (statusCode >= 400 && statusCode < 500) return "4xx";
  if (statusCode >= 500 && statusCode < 600) return "5xx";
  return "other";
};

const parseObjectLiteralTelemetry = (message) => {
  const telemetry = {};
  for (const key of [
    "provider",
    "requestedProvider",
    "fallbackReason",
    "status",
    "quotaMode",
    "wordCount",
    "duration",
  ]) {
    const match = message.match(new RegExp(`${key}:\\s*['"]?([A-Za-z0-9_.+-]+)['"]?`));
    if (match) telemetry[key] = match[1];
  }
  const fallbackMatch = message.match(/fallback:\s*(true|false)/);
  const quotaMatch = message.match(/quotaExceeded:\s*(true|false)/);
  const statusCodeMatch = message.match(/statusCode:\s*(\d+)/);
  if (fallbackMatch) telemetry.fallback = fallbackMatch[1] === "true";
  if (quotaMatch) telemetry.quotaExceeded = quotaMatch[1] === "true";
  if (statusCodeMatch) telemetry.statusCode = Number(statusCodeMatch[1]);
  return Object.keys(telemetry).length > 0 ? telemetry : null;
};

const extractTtsTelemetry = (log) => {
  const message = String(log.message ?? log.text ?? "");
  if (!message.includes("[/api/tts] route")) return null;

  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      return JSON.parse(message.slice(jsonStart));
    } catch {
      return parseObjectLiteralTelemetry(message);
    }
  }

  if (log.provider || log.fallbackReason || log.quotaMode) {
    return log;
  }

  return parseObjectLiteralTelemetry(message);
};

export const summarizeLogs = (logs) => {
  const seen = new Set();
  const summary = {
    totalRequests: 0,
    successfulResponses: 0,
    errorResponses: 0,
    statusGroups: {},
    statusCodes: {},
    cacheBuckets: {},
    sourceBuckets: {},
    domainBuckets: {},
    deploymentBuckets: {},
    topRoutes: [],
    topApiRoutes: [],
    articleActivity: {
      totalRequests: 0,
      topArticles: [],
    },
    notableErrors: [],
    tts: {
      totalEvents: 0,
      providerMix: {},
      fallbackCount: 0,
      fallbackReasons: {},
      quotaExceededCount: 0,
      wordBuckets: {},
      durationBuckets: {},
      slowGenerations: 0,
      errors: 0,
    },
  };

  const routeCounts = {};
  const apiCounts = {};
  const articleCounts = {};

  for (const log of logs) {
    const dedupeKey = log.id ?? log.requestId ?? log.traceId ?? undefined;
    if (dedupeKey) {
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
    }

    const pathValue = redactPath(getRequestPath(log));
    const statusCode = normalizeStatusCode(log);
    const hasRequestShape = pathValue !== "(unknown)" || statusCode != null;

    if (hasRequestShape) {
      summary.totalRequests += 1;
      if (statusCode && statusCode < 400) summary.successfulResponses += 1;
      if (statusCode && statusCode >= 400) summary.errorResponses += 1;

      increment(summary.statusGroups, statusGroup(statusCode));
      if (statusCode) increment(summary.statusCodes, String(statusCode));
      increment(summary.cacheBuckets, String(getCacheValue(log) ?? "unknown"));
      increment(summary.sourceBuckets, String(getSourceValue(log) ?? "unknown"));
      increment(summary.domainBuckets, String(getDomainValue(log) ?? "unknown"));
      increment(summary.deploymentBuckets, String(getDeploymentValue(log) ?? "unknown"));

      increment(routeCounts, pathValue);
      if (pathValue.startsWith("/api/")) increment(apiCounts, pathValue);
      if (pathValue.startsWith("/article/")) {
        summary.articleActivity.totalRequests += 1;
        increment(articleCounts, pathValue);
      }
    }

    const message = String(log.message ?? log.text ?? "");
    if ((statusCode && statusCode >= 400) || /\berror\b/i.test(message)) {
      summary.notableErrors.push({
        path: pathValue,
        statusCode: statusCode ?? "unknown",
        message: redactSensitiveText(message || log.error || log.name),
      });
    }

    const tts = extractTtsTelemetry(log);
    if (tts) {
      summary.tts.totalEvents += 1;
      increment(summary.tts.providerMix, String(tts.provider ?? "unknown"));
      if (tts.fallback === true || tts.fallback === "true") {
        summary.tts.fallbackCount += 1;
        increment(summary.tts.fallbackReasons, String(tts.fallbackReason ?? "unknown"));
      }
      if (tts.quotaExceeded === true || tts.quotaExceeded === "true") {
        summary.tts.quotaExceededCount += 1;
      }
      increment(summary.tts.wordBuckets, String(tts.wordCount ?? "unknown"));
      increment(summary.tts.durationBuckets, String(tts.duration ?? "unknown"));
      if (String(tts.duration ?? "").includes("15s+")) summary.tts.slowGenerations += 1;
      if (tts.status === "error") summary.tts.errors += 1;
    }
  }

  summary.statusGroups = sortRecord(summary.statusGroups);
  summary.statusCodes = sortRecord(summary.statusCodes);
  summary.cacheBuckets = sortRecord(summary.cacheBuckets);
  summary.sourceBuckets = sortRecord(summary.sourceBuckets);
  summary.domainBuckets = sortRecord(summary.domainBuckets);
  summary.deploymentBuckets = sortRecord(summary.deploymentBuckets);
  summary.tts.providerMix = sortRecord(summary.tts.providerMix);
  summary.tts.fallbackReasons = sortRecord(summary.tts.fallbackReasons);
  summary.tts.wordBuckets = sortRecord(summary.tts.wordBuckets);
  summary.tts.durationBuckets = sortRecord(summary.tts.durationBuckets);
  summary.topRoutes = topEntries(routeCounts, 12).map(({ key, count }) => ({
    path: key,
    count,
  }));
  summary.topApiRoutes = topEntries(apiCounts, 12).map(({ key, count }) => ({
    path: key,
    count,
  }));
  summary.articleActivity.topArticles = topEntries(articleCounts, 10).map(
    ({ key, count }) => ({ path: key, count }),
  );
  summary.notableErrors = summary.notableErrors.slice(0, 12);

  return summary;
};

const renderList = (items, emptyText, labelKey = "path") => {
  if (!items.length) return [`- ${emptyText}`];
  return items.map((item) => `- ${item[labelKey]}: ${formatCount(item.count, "request")}`);
};

const renderCounter = (record, emptyText) => {
  const entries = topEntries(record, 12);
  if (!entries.length) return [`- ${emptyText}`];
  return entries.map(({ key, count }) => `- ${key}: ${count.toLocaleString()}`);
};

const summarizeDrainRollups = (rollups = []) => {
  const eventNames = {};
  const paths = {};
  let total = 0;
  let pageviews = 0;
  let customEvents = 0;

  for (const rollup of rollups) {
    const count = Number(rollup.count ?? 0);
    total += count;
    if (rollup.eventType === "pageview") pageviews += count;
    if (rollup.eventType === "custom") customEvents += count;
    increment(eventNames, rollup.eventName || rollup.eventType || "unknown", count);
    increment(paths, rollup.path || "(none)", count);
  }

  return {
    total,
    pageviews,
    customEvents,
    eventNames: topEntries(eventNames, 10),
    paths: topEntries(paths, 10),
  };
};

export const renderAccessibleReport = ({
  generatedAt,
  since,
  until,
  environment,
  summary,
  drain,
}) => {
  const lines = [
    "# Curio Garden Analytics Report",
    "",
    `Generated: ${formatDate(generatedAt)}`,
    `Window: ${formatDate(since)} through ${formatDate(until)}`,
    `Environment: ${environment}`,
    "",
    "## Plain-English Summary",
    "",
    `- Vercel logs show ${formatCount(summary.totalRequests, "request")} in this window.`,
    `- Successful responses: ${summary.successfulResponses.toLocaleString()}. Error responses: ${summary.errorResponses.toLocaleString()}.`,
    `- Article routes saw ${formatCount(summary.articleActivity.totalRequests, "request")}.`,
  ];

  if (summary.tts.totalEvents > 0) {
    lines.push(
      `- TTS route telemetry appeared ${formatCount(summary.tts.totalEvents, "time")}; ${summary.tts.fallbackCount.toLocaleString()} used fallback audio.`,
    );
  } else {
    lines.push("- No TTS route telemetry was found in the sampled logs.");
  }

  lines.push("", "## Traffic Status", "");
  lines.push(...renderCounter(summary.statusGroups, "No status-code groups were available."));
  lines.push("", "## Top Routes", "");
  lines.push(...renderList(summary.topRoutes, "No route activity was available."));
  lines.push("", "## Top API Routes", "");
  lines.push(...renderList(summary.topApiRoutes, "No API route activity was available."));
  lines.push("", "## Article Route Activity", "");
  lines.push(...renderList(summary.articleActivity.topArticles, "No article routes appeared in the logs."));
  lines.push("", "## Cache And Source Signals", "");
  lines.push("- Cache buckets:");
  lines.push(...renderCounter(summary.cacheBuckets, "No cache data was available."));
  lines.push("- Source buckets:");
  lines.push(...renderCounter(summary.sourceBuckets, "No source data was available."));
  lines.push("", "## Deployment And Domain Coverage", "");
  lines.push("- Domains:");
  lines.push(...renderCounter(summary.domainBuckets, "No domain data was available."));
  lines.push("- Deployments or projects:");
  lines.push(...renderCounter(summary.deploymentBuckets, "No deployment data was available."));
  lines.push("", "## TTS Audio", "");
  lines.push(`- TTS telemetry events: ${summary.tts.totalEvents.toLocaleString()}.`);
  lines.push(`- Fallback count: ${summary.tts.fallbackCount.toLocaleString()}.`);
  lines.push(`- Quota fallback count: ${summary.tts.quotaExceededCount.toLocaleString()}.`);
  lines.push(`- Slow generation bucket count, 15 seconds or more: ${summary.tts.slowGenerations.toLocaleString()}.`);
  lines.push("- Provider mix:");
  lines.push(...renderCounter(summary.tts.providerMix, "No provider data was available."));
  lines.push("- Fallback reasons:");
  lines.push(...renderCounter(summary.tts.fallbackReasons, "No fallback reasons were recorded."));
  lines.push("- Word-count buckets:");
  lines.push(...renderCounter(summary.tts.wordBuckets, "No word-count buckets were recorded."));
  lines.push("- Duration buckets:");
  lines.push(...renderCounter(summary.tts.durationBuckets, "No duration buckets were recorded."));
  lines.push("", "## Notable Errors", "");
  if (summary.notableErrors.length === 0) {
    lines.push("- No notable errors appeared in the sampled logs.");
  } else {
    for (const error of summary.notableErrors) {
      lines.push(`- ${error.path}: status ${error.statusCode}; ${error.message}`);
    }
  }

  lines.push("", "## Data Availability", "");
  lines.push("- Vercel production logs were included through the Vercel CLI.");
  if (drain?.included) {
    const drainSummary = summarizeDrainRollups(drain.rollups);
    lines.push(
      `- Vercel Analytics Drain data was included with ${formatCount(drainSummary.total, "rolled-up event")}.`,
    );
    lines.push(`- Drain pageviews: ${drainSummary.pageviews.toLocaleString()}.`);
    lines.push(`- Drain custom events: ${drainSummary.customEvents.toLocaleString()}.`);
    lines.push("- Top drain events:");
    lines.push(
      ...drainSummary.eventNames.map(({ key, count }) => `- ${key}: ${count.toLocaleString()}`),
    );
    lines.push("- Top drain paths:");
    lines.push(
      ...drainSummary.paths.map(({ key, count }) => `- ${key}: ${count.toLocaleString()}`),
    );
  } else {
    lines.push(
      `- Vercel Analytics Drain data was not included. ${drain?.reason ?? "No drain data source was available."}`,
    );
  }

  lines.push(
    "",
    "## Privacy And Redaction",
    "",
    "- Query strings, token-like values, bearer tokens, and multi-line stack traces were removed from this report.",
    "- The report does not include raw session identifiers, device identifiers, API keys, user IDs, article text, or search terms.",
    "",
  );

  return lines.join("\n");
};

const parseFlagValue = (argv, index) => {
  const current = argv[index];
  const equalsIndex = current.indexOf("=");
  if (equalsIndex >= 0) return { value: current.slice(equalsIndex + 1), consumed: 0 };
  const next = argv[index + 1];
  if (next == null || next.startsWith("-")) {
    throw new Error(`${current} requires a value.`);
  }
  return { value: next, consumed: 1 };
};

const parseRelativeTime = (value, now) => {
  const match = String(value).match(/^(\d+)(m|h|d)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "m" ? 60 * 1000 : unit === "h" ? HOUR_MS : 24 * HOUR_MS;
  return new Date(now.getTime() - amount * multiplier);
};

export const parseArgs = (argv, now = new Date()) => {
  const options = {
    hours: DEFAULT_HOURS,
    environment: "production",
    json: false,
    includeDrain: true,
    output: undefined,
    project: process.env.VERCEL_PROJECT ?? process.env.VERCEL_PROJECT_ID,
    since: undefined,
    until: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--no-drain") {
      options.includeDrain = false;
      continue;
    }
    if (arg.startsWith("--hours")) {
      const { value, consumed } = parseFlagValue(argv, index);
      options.hours = Number(value);
      index += consumed;
      continue;
    }
    if (arg.startsWith("--environment")) {
      const { value, consumed } = parseFlagValue(argv, index);
      options.environment = value;
      index += consumed;
      continue;
    }
    if (arg.startsWith("--output")) {
      const { value, consumed } = parseFlagValue(argv, index);
      options.output = value;
      index += consumed;
      continue;
    }
    if (arg.startsWith("--project")) {
      const { value, consumed } = parseFlagValue(argv, index);
      options.project = value;
      index += consumed;
      continue;
    }
    if (arg.startsWith("--since")) {
      const { value, consumed } = parseFlagValue(argv, index);
      options.since = value;
      index += consumed;
      continue;
    }
    if (arg.startsWith("--until")) {
      const { value, consumed } = parseFlagValue(argv, index);
      options.until = value;
      index += consumed;
      continue;
    }
  }

  const until =
    options.until && options.until !== "now"
      ? parseRelativeTime(options.until, now) ?? new Date(options.until)
      : now;
  const since =
    options.since != null
      ? parseRelativeTime(options.since, until) ?? new Date(options.since)
      : new Date(until.getTime() - options.hours * HOUR_MS);

  if (!Number.isFinite(options.hours) || options.hours <= 0) {
    throw new Error("--hours must be a positive number.");
  }
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime()) || since >= until) {
    throw new Error("Provide a valid report window where --since is before --until.");
  }

  return { ...options, since, until };
};

const cleanRuntimePath = () =>
  String(process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(
      (entry) =>
        entry && !entry.includes("codex-primary-runtime/dependencies/node/bin"),
    )
    .join(path.delimiter);

const cleanNpxEnvironment = () => {
  const env = { ...process.env, PATH: cleanRuntimePath() };
  delete env.NODE;
  delete env.npm_execpath;
  delete env.npm_node_execpath;
  delete env.npm_config_prefix;
  return env;
};

const resolveVercelCommand = async () => {
  if (process.env.VERCEL_ANALYTICS_CLI) {
    const command = process.env.VERCEL_ANALYTICS_CLI.split(/\s+/).filter(
      Boolean,
    );
    return {
      command,
      env: command[0] === "npx" ? cleanNpxEnvironment() : process.env,
    };
  }

  const candidates = [
    { command: ["vercel"], env: process.env },
    {
      command: ["npx", "--yes", "vercel@latest"],
      env: cleanNpxEnvironment(),
    },
  ];
  for (const candidate of candidates) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate.command[0], [
        ...candidate.command.slice(1),
        "logs",
        "--help",
      ], {
        env: candidate.env,
      });
      const help = `${stdout}\n${stderr}`;
      if (help.includes("--json") && help.includes("--environment")) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    "Could not find a Vercel CLI with `logs --json --environment`. Install a current Vercel CLI or set VERCEL_ANALYTICS_CLI.",
  );
};

const runVercelLogs = async ({
  commandSpec,
  range,
  environment,
  project,
  cwd,
}) => {
  const { command, env } = commandSpec;
  const args = [
    ...command.slice(1),
    "logs",
    "--environment",
    environment,
    "--since",
    range.since.toISOString(),
    "--until",
    range.until.toISOString(),
    "--json",
    "--limit",
    String(DEFAULT_LIMIT),
    "--no-branch",
    "--cwd",
    cwd,
  ];
  if (project) {
    args.push("--project", project);
  }

  const { stdout, stderr } = await execFileAsync(command[0], args, {
    maxBuffer: 24 * 1024 * 1024,
    env,
  });

  return `${stdout}\n${stderr}`;
};

export const warnIfLogLimitReached = (parsedLogs, range, warn = console.warn) => {
  if (parsedLogs.length < DEFAULT_LIMIT) return false;

  warn(
    `[analytics:site] Vercel logs hit the ${DEFAULT_LIMIT} entry limit for ${range.since.toISOString()} to ${range.until.toISOString()}; this report may be incomplete. Re-run with a narrower --since/--until window if you need full fidelity.`,
  );
  return true;
};

const fetchAllLogs = async ({ since, until, environment, project, cwd }) => {
  const command = await resolveVercelCommand();
  const ranges = buildLogRanges(since.getTime(), until.getTime());
  const logs = [];

  for (const [index, range] of ranges.entries()) {
    console.error(
      `Fetching Vercel logs chunk ${index + 1}/${ranges.length}: ${range.since.toISOString()} to ${range.until.toISOString()}`,
    );
    const output = await runVercelLogs({
      commandSpec: command,
      range,
      environment,
      project,
      cwd,
    });
    const parsed = parseVercelLogLines(output);
    warnIfLogLimitReached(parsed, range);
    logs.push(...parsed);
  }

  return logs;
};

export const fetchDrainData = async ({ since, until, includeDrain }) => {
  if (!includeDrain) {
    return { included: false, reason: "Skipped because --no-drain was provided." };
  }

  const secret = process.env.ANALYTICS_REPORT_SECRET?.trim();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!secret || !siteUrl) {
    return {
      included: false,
      reason:
        "Set ANALYTICS_REPORT_SECRET and NEXT_PUBLIC_SITE_URL to include future Analytics Drain rollups.",
    };
  }

  try {
    const url = new URL("/api/analytics/report-data", siteUrl);
    url.searchParams.set("since", String(since.getTime()));
    url.searchParams.set("until", String(until.getTime()));

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    if (!response.ok) {
      return {
        included: false,
        reason: `Report data endpoint returned HTTP ${response.status}.`,
      };
    }
    const body = await response.json();
    return {
      included: true,
      rollups: Array.isArray(body.rollups) ? body.rollups : [],
    };
  } catch (error) {
    return {
      included: false,
      reason: error instanceof Error ? error.message : "Report data request failed.",
    };
  }
};

const defaultOutputPath = (generatedAt, json) => {
  const safeTimestamp = generatedAt.toISOString().replace(/[:.]/g, "-");
  return path.join(DEFAULT_OUTPUT_DIR, `${safeTimestamp}.${json ? "json" : "md"}`);
};

const saveReport = async (outputPath, contents) => {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, contents, "utf8");
};

export const buildReportPayload = async (options, cwd = process.cwd()) => {
  const generatedAt = new Date();
  const logs = await fetchAllLogs({
    since: options.since,
    until: options.until,
    environment: options.environment,
    project: options.project,
    cwd,
  });
  const summary = summarizeLogs(logs);
  const drain = await fetchDrainData({
    since: options.since,
    until: options.until,
    includeDrain: options.includeDrain,
  });

  return {
    generatedAt,
    since: options.since,
    until: options.until,
    environment: options.environment,
    logCount: logs.length,
    summary,
    drain,
  };
};

export const main = async (argv = process.argv.slice(2), cwd = process.cwd()) => {
  await loadLocalEnvFile(cwd);
  const options = parseArgs(argv);
  const payload = await buildReportPayload(options, cwd);
  const outputPath = options.output ?? defaultOutputPath(payload.generatedAt, options.json);

  if (options.json) {
    const json = JSON.stringify(payload, null, 2);
    await saveReport(outputPath, `${json}\n`);
    console.log(json);
  } else {
    const markdown = renderAccessibleReport(payload);
    await saveReport(outputPath, markdown);
    console.log(markdown);
  }

  console.error(`Saved analytics report to ${outputPath}`);
  return { outputPath, payload };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
