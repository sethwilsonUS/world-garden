#!/usr/bin/env node

import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);
const DEFAULT_LIMIT = 50;
const MAX_EXPORT_ITEMS = 10_000;
const CONVEX_TIMEOUT_MS = 60_000;
const PRODUCTION_DEPLOYMENT = "seth-wilson:world-garden:prod";
const CONVEX_FUNCTION = "productFeedback:listProductFeedbackForOwner";
const ALLOWED_CHILD_ENV_KEYS = new Set([
  "ALL_PROXY",
  "COMSPEC",
  "FORCE_COLOR",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "LOGNAME",
  "NODE_EXTRA_CA_CERTS",
  "NO_COLOR",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "TZ",
  "USER",
  "USERPROFILE",
  "WINDIR",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);
const CSV_HEADERS = [
  "feedback_id",
  "created_at_utc",
  "updated_at_utc",
  "status",
  "kind",
  "message",
  "environment",
  "research_opt_in",
  "article_title",
  "article_slug",
  "article_revision_id",
  "contact_available",
  "contact_email",
  "contact_expires_at_utc",
];
const HELP_TEXT = `Curio Garden feedback command

Usage:
  npm run report:feedback
  npm run report:feedback -- --status all --limit 100
  npm run report:feedback -- --csv
  npm run report:feedback -- --csv --output <path> --include-contact

Options:
  --csv                 Export CSV instead of printing feedback.
  --output <path>       Write CSV to this new file. Existing files are preserved.
  --include-contact     Include active contact email in CSV. Requires --output.
  --status <status>     open, reviewing, resolved, dismissed, or all.
  --limit <count>       Maximum number of feedback items.
  --help, -h            Show this help.

Results are newest first. The terminal view defaults to 50 open items.
CSV exports up to 10000 items to .reports/feedback/<timestamp>.csv by default.
The dedicated contact email field is hidden unless explicitly included. All
feedback can contain volunteered personal information, so handle it carefully.
Contact exports are outside Curio Garden's automatic 180-day contact cleanup.
Compatibility alias: npm run feedback.
`;

function isoDate(value) {
  return new Date(value).toISOString();
}

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function quoteCsv(value) {
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
}

export function serializeFeedbackCsv(
  items,
  { includeContact = false, now = new Date() } = {},
) {
  const rows = items.map((item) => {
    const contactAvailable =
      item.contactAvailable === true &&
      typeof item.contactExpiresAt === "number" &&
      item.contactExpiresAt > now.getTime();
    const values = [
      item.id ?? item._id,
      isoDate(item.createdAt ?? item._creationTime),
      isoDate(item.updatedAt ?? item.createdAt ?? item._creationTime),
      item.status,
      item.kind,
      item.message,
      item.environment,
      contactAvailable && item.researchOptIn,
      item.articleTitle,
      item.articleSlug,
      item.articleRevisionId,
      contactAvailable,
      includeContact && contactAvailable ? item.contactEmail : undefined,
      contactAvailable && typeof item.contactExpiresAt === "number"
        ? isoDate(item.contactExpiresAt)
        : undefined,
    ];
    return values.map(quoteCsv).join(",");
  });

  return `${[CSV_HEADERS.join(","), ...rows].join("\r\n")}\r\n`;
}

function parseArgs(args) {
  const options = {
    csv: false,
    help: false,
    includeContact: false,
    limit: undefined,
    output: undefined,
    status: undefined,
    statusProvided: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--csv") {
      options.csv = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--include-contact") {
      options.includeContact = true;
    } else if (argument === "--output") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--output requires a path.");
      }
      options.output = value;
      index += 1;
    } else if (argument === "--status") {
      const value = args[index + 1];
      if (
        !["open", "reviewing", "resolved", "dismissed", "all"].includes(value)
      ) {
        throw new Error(
          "--status must be open, reviewing, resolved, dismissed, or all.",
        );
      }
      options.status = value;
      options.statusProvided = true;
      index += 1;
    } else if (argument === "--limit") {
      const value = args[index + 1];
      const limit = Number(value);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
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
  if (options.includeContact && (!options.csv || !options.output)) {
    throw new Error(
      "--include-contact requires --csv and an explicit --output path.",
    );
  }

  return options;
}

function formatArticle(item) {
  if (!item.articleTitle && !item.articleSlug && !item.articleRevisionId) {
    return "none";
  }

  const title = item.articleTitle ?? item.articleSlug ?? "Untitled article";
  const details = [
    item.articleSlug && item.articleSlug !== title
      ? `slug ${item.articleSlug}`
      : undefined,
    item.articleRevisionId ? `revision ${item.articleRevisionId}` : undefined,
  ].filter(Boolean);

  return details.length > 0 ? `${title} (${details.join(", ")})` : title;
}

function formatContact(item, now) {
  const expiresAt = item.contactExpiresAt;
  const isAvailable =
    item.contactAvailable === true &&
    typeof expiresAt === "number" &&
    expiresAt > now.getTime();

  return isAvailable
    ? `available but hidden (expires ${isoDate(expiresAt)})`
    : "not available";
}

function indentUntrustedText(value) {
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "    ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

export function formatTerminalReport(
  items,
  { hasMore = false, now = new Date(), status } = {},
) {
  const lines = [
    "Curio Garden feedback",
    "Deployment: production",
    `Showing: ${items.length} ${pluralize(items.length, "feedback item")}`,
  ];

  if (items.length === 0) {
    lines.push(
      "",
      status ? `No ${status} feedback found.` : "No feedback found.",
    );
  }

  for (const [index, item] of items.entries()) {
    lines.push(
      "",
      `Feedback ${index + 1} of ${items.length}`,
      `Created: ${isoDate(item.createdAt ?? item._creationTime)}`,
      `Status: ${item.status}`,
      `Kind: ${item.kind}`,
      `Article: ${formatArticle(item)}`,
      `Research invitation: ${item.researchOptIn ? "yes" : "no"}`,
      `Contact: ${formatContact(item, now)}`,
    );

    if (item.environment) {
      lines.push(
        "Environment begins:",
        indentUntrustedText(item.environment),
        "Environment ends.",
      );
    }

    lines.push(
      "Message begins:",
      indentUntrustedText(item.message),
      "Message ends.",
    );
  }

  if (hasMore) {
    lines.push("", "More feedback is available. Increase --limit to view it.");
  }

  return `${lines.join("\n")}\n`;
}

function buildChildEnvironment(processEnv) {
  return Object.fromEntries(
    Object.entries(processEnv).filter(
      ([key, value]) => value != null && ALLOWED_CHILD_ENV_KEYS.has(key),
    ),
  );
}

function validateConvexPage(value) {
  if (
    !value ||
    typeof value !== "object" ||
    !Array.isArray(value.page) ||
    typeof value.isDone !== "boolean" ||
    typeof value.continueCursor !== "string" ||
    !Number.isFinite(value.snapshotBefore)
  ) {
    throw new Error("Convex returned an unexpected feedback response.");
  }
  return value;
}

function convexReadError(error) {
  if (error?.killed === true || error?.code === "ETIMEDOUT") {
    return new Error(
      "Timed out while reading production feedback from Convex. Check the network connection and try again.",
    );
  }
  const diagnostic =
    `${error?.message ?? ""}\n${error?.stderr ?? ""}`.toLowerCase();
  if (
    diagnostic.includes("could not find function") ||
    (diagnostic.includes("function") && diagnostic.includes("not deployed"))
  ) {
    return new Error(
      "The production feedback reader is not deployed yet. Deploy the current main branch and try again.",
    );
  }
  if (
    diagnostic.includes("fetch failed") ||
    diagnostic.includes("enotfound") ||
    diagnostic.includes("network")
  ) {
    return new Error(
      "Unable to reach Convex while reading production feedback. Check the network connection and try again.",
    );
  }
  if (
    diagnostic.includes("cannot find module") ||
    diagnostic.includes("unable to read your package.json")
  ) {
    return new Error(
      "The local Convex CLI is unavailable. Run `npm install` and try again.",
    );
  }
  return new Error(
    "Unable to read production feedback. Confirm that `npx convex login` is connected to the Curio Garden project.",
  );
}

async function createIsolatedConvexWorkspace() {
  const isolatedCwd = await mkdtemp(
    path.join(os.tmpdir(), "curio-feedback-cli-"),
  );

  try {
    await writeFile(
      path.join(isolatedCwd, "package.json"),
      `${JSON.stringify({ private: true, dependencies: { convex: "*" } })}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
    return isolatedCwd;
  } catch (error) {
    try {
      await rm(isolatedCwd, { recursive: true, force: true });
    } catch {
      // Preserve the workspace initialization error.
    }
    throw error;
  }
}

export async function runConvexFeedbackPage(
  pageOptions,
  {
    cwd = process.cwd(),
    execFile = execFileAsync,
    isolatedCwd: sharedIsolatedCwd,
    processEnv = process.env,
  } = {},
) {
  const ownsWorkspace = sharedIsolatedCwd === undefined;
  const isolatedCwd =
    sharedIsolatedCwd ?? (await createIsolatedConvexWorkspace());
  const convexCliPath = path.join(
    cwd,
    "node_modules",
    "convex",
    "bin",
    "main.js",
  );
  const queryArgs = {
    paginationOpts: {
      cursor: pageOptions.cursor,
      numItems: pageOptions.limit,
    },
    ...(pageOptions.status ? { status: pageOptions.status } : {}),
    snapshotBefore: pageOptions.snapshotBefore,
    includeContact: pageOptions.includeContact,
    reportRunId: pageOptions.reportRunId,
  };

  try {
    let result;
    try {
      result = await execFile(
        process.execPath,
        [
          convexCliPath,
          "run",
          CONVEX_FUNCTION,
          JSON.stringify(queryArgs),
          "--deployment",
          PRODUCTION_DEPLOYMENT,
          "--typecheck",
          "disable",
          "--codegen",
          "disable",
        ],
        {
          cwd: isolatedCwd,
          encoding: "utf8",
          env: buildChildEnvironment(processEnv),
          maxBuffer: 10 * 1024 * 1024,
          timeout: CONVEX_TIMEOUT_MS,
          killSignal: "SIGKILL",
        },
      );
    } catch (error) {
      throw convexReadError(error);
    }

    try {
      return validateConvexPage(JSON.parse(result.stdout));
    } catch (error) {
      if (
        error?.message === "Convex returned an unexpected feedback response."
      ) {
        throw error;
      }
      throw new Error("Convex returned invalid JSON for the feedback query.");
    }
  } finally {
    if (ownsWorkspace) {
      await rm(isolatedCwd, { recursive: true, force: true });
    }
  }
}

export async function main(
  args = process.argv.slice(2),
  cwd = process.cwd(),
  dependencies = {},
) {
  const options = parseArgs(args);
  let isolatedCwd;
  const runConvexPage =
    dependencies.runConvexPage ??
    ((pageOptions) =>
      runConvexFeedbackPage(pageOptions, {
        cwd,
        execFile: dependencies.execFile,
        isolatedCwd,
        processEnv: dependencies.processEnv,
      }));
  const writeStdout =
    dependencies.writeStdout ?? ((text) => process.stdout.write(text));
  const writeStderr =
    dependencies.writeStderr ?? ((text) => process.stderr.write(text));
  const openFile = dependencies.openFile ?? open;
  const removeFile = dependencies.removeFile ?? rm;
  const createWorkspace =
    dependencies.createWorkspace ?? createIsolatedConvexWorkspace;
  const removeWorkspace = dependencies.removeWorkspace ?? rm;
  const getNow = dependencies.getNow ?? (() => dependencies.now ?? new Date());
  const now = getNow();
  const reportRunId = dependencies.reportRunId ?? randomUUID();
  if (options.help) {
    writeStdout(HELP_TEXT);
    return;
  }
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const outputPath = options.csv
    ? path.resolve(
        cwd,
        options.output ??
          path.join(".reports", "feedback", `feedback-${timestamp}.csv`),
      )
    : undefined;
  let outputFile;
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    try {
      outputFile = await openFile(outputPath, "wx", 0o600);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw new Error(
          `Refusing to overwrite existing feedback export: ${outputPath}`,
        );
      }
      throw error;
    }
  }
  const feedback = [];
  const maximumItems =
    options.limit ?? (options.csv ? MAX_EXPORT_ITEMS : DEFAULT_LIMIT);
  const status = options.statusProvided
    ? options.status === "all"
      ? undefined
      : options.status
    : options.csv
      ? undefined
      : "open";
  let cursor = null;
  let isDone = false;
  let snapshotBefore;
  const seenCursors = new Set();
  let operationError;
  let workspaceCleanupError;

  try {
    if (!dependencies.runConvexPage) {
      isolatedCwd = await createWorkspace();
    }
    while (!isDone && feedback.length < maximumItems) {
      const result = await runConvexPage({
        cursor,
        limit: Math.min(100, maximumItems - feedback.length),
        reportRunId,
        status,
        snapshotBefore,
        includeContact: options.csv && options.includeContact,
      });
      if (snapshotBefore === undefined) {
        snapshotBefore =
          typeof result.snapshotBefore === "number"
            ? result.snapshotBefore
            : now.getTime();
      } else if (
        typeof result.snapshotBefore === "number" &&
        result.snapshotBefore !== snapshotBefore
      ) {
        throw new Error(
          "Convex changed the feedback snapshot while paginating.",
        );
      }
      feedback.push(...result.page.slice(0, maximumItems - feedback.length));
      isDone = result.isDone;
      if (!isDone && seenCursors.has(result.continueCursor)) {
        throw new Error("Convex repeated a feedback pagination cursor.");
      }
      if (!isDone) seenCursors.add(result.continueCursor);
      cursor = result.continueCursor;
    }

    if (outputFile) {
      await outputFile.writeFile(
        serializeFeedbackCsv(feedback, {
          includeContact: options.includeContact,
          now: getNow(),
        }),
        "utf8",
      );
      await outputFile.sync();
      await outputFile.close();
      outputFile = undefined;
    }
  } catch (error) {
    operationError = error;
    if (outputFile) {
      try {
        await outputFile.close();
      } catch {
        // Continue to removal even when flushing or closing the handle failed.
      }
    }
    if (outputPath) {
      try {
        await removeFile(outputPath, { force: true });
      } catch {
        operationError = new Error(
          `Feedback export failed and a partial file may remain at: ${outputPath}`,
          { cause: error },
        );
      }
    }
  } finally {
    if (isolatedCwd) {
      try {
        await removeWorkspace(isolatedCwd, { recursive: true, force: true });
      } catch (error) {
        workspaceCleanupError = error;
      }
    }
  }

  if (operationError && workspaceCleanupError) {
    throw new AggregateError(
      [operationError, workspaceCleanupError],
      `${operationError.message} Temporary Convex workspace cleanup also failed; the temporary directory may remain at: ${isolatedCwd}`,
      { cause: operationError },
    );
  }
  if (operationError) {
    throw operationError;
  }
  if (workspaceCleanupError) {
    throw new Error(
      `Feedback reporting succeeded, but its temporary Convex workspace could not be removed and may remain at: ${isolatedCwd}`,
      { cause: workspaceCleanupError },
    );
  }

  if (outputPath) {
    writeStdout(
      `Exported ${feedback.length} ${pluralize(feedback.length, "feedback item")} to:\n${outputPath}\n`,
    );
    if (options.includeContact) {
      writeStderr(
        "Warning: This export contains contact email and is outside automatic retention cleanup. Delete it when no longer needed.\n",
      );
    }
    if (!isDone) {
      writeStderr(
        "Warning: This CSV is incomplete; more matching feedback is available. Increase --limit and export to a new path.\n",
      );
    }
    return;
  }

  writeStdout(
    formatTerminalReport(feedback, {
      hasMore: !isDone,
      now: getNow(),
      status,
    }),
  );
}

export function isDirectInvocation(moduleUrl, argvEntry) {
  return (
    Boolean(argvEntry) &&
    moduleUrl === pathToFileURL(path.resolve(argvEntry)).href
  );
}

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`Feedback command failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
