import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const verifierPath = fileURLToPath(import.meta.url);
const EXPECTED_VERSION = "1.79.0";
const EXPECTED_CODES = new Set([
  "anti-slop(no-chained-type-assertions)",
  "anti-slop(no-reflect-apply)",
  "anti-slop(no-reflect-get)",
  "anti-slop(no-unknown-type-aliases)",
  "anti-slop(no-widen-then-assert)",
]);
const MAX_ANTI_SLOP_SUPPRESSIONS = 0;
const allowedSuppressionFiles = new Set();

const rootDirectory = path.dirname(path.dirname(verifierPath));
const oxlintLauncher = path.join(
  rootDirectory,
  "node_modules",
  "oxlint",
  "bin",
  "oxlint",
);
const configPath = path.join(rootDirectory, ".oxlintrc.json");
const canaryPath = path.join(rootDirectory, "tools", "oxlint", "canary.ts");

const readJson = (filePath) => JSON.parse(readFileSync(filePath, "utf8"));

export const assertNodeRuntime = (version = process.versions.node) => {
  const [majorVersion, minorVersion] = version
    .split(".", 2)
    .map((part) => Number.parseInt(part, 10));
  if (
    majorVersion !== 24 ||
    !Number.isInteger(minorVersion) ||
    minorVersion < 3
  ) {
    throw new Error(
      `Anti-slop requires Node 24.3.0 or newer within the 24.x release line; found v${version}`,
    );
  }
};

const assertPinnedPackages = () => {
  const rootManifest = readJson(path.join(rootDirectory, "package.json"));
  const oxlintManifest = readJson(
    path.join(rootDirectory, "node_modules", "oxlint", "package.json"),
  );
  const pluginsManifest = readJson(
    path.join(
      rootDirectory,
      "node_modules",
      "@oxlint",
      "plugins",
      "package.json",
    ),
  );

  for (const packageName of ["oxlint", "@oxlint/plugins"]) {
    const declaredVersion = rootManifest.devDependencies?.[packageName];
    if (declaredVersion !== EXPECTED_VERSION) {
      throw new Error(
        `${packageName} must be declared exactly as ${EXPECTED_VERSION}; found ${JSON.stringify(declaredVersion)}`,
      );
    }
  }

  for (const [packageName, manifest] of [
    ["oxlint", oxlintManifest],
    ["@oxlint/plugins", pluginsManifest],
  ]) {
    if (manifest.version !== EXPECTED_VERSION) {
      throw new Error(
        `${packageName} ${EXPECTED_VERSION} must be installed; found ${JSON.stringify(manifest.version)}`,
      );
    }
  }

  if (oxlintManifest.bin?.oxlint !== "bin/oxlint") {
    throw new Error("The installed oxlint manifest does not expose bin/oxlint");
  }
  if (!statSync(oxlintLauncher).isFile()) {
    throw new Error(`The oxlint Node launcher is missing at ${oxlintLauncher}`);
  }
};

const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const oxlintImplicitIgnoredDirectoryPaths = new Set([".git"]);

const ignoredDirectoryPaths = () => {
  const ignorePatterns = readJson(configPath).ignorePatterns;
  if (!Array.isArray(ignorePatterns)) {
    throw new Error("Oxlint ignorePatterns must be an array");
  }

  const directoryPaths = new Set(oxlintImplicitIgnoredDirectoryPaths);
  for (const pattern of ignorePatterns) {
    if (
      typeof pattern !== "string" ||
      !pattern.endsWith("/**") ||
      pattern.length <= 3 ||
      /[*?\[\]{}]/u.test(pattern.slice(0, -3))
    ) {
      throw new Error(
        `Oxlint ignore pattern ${JSON.stringify(pattern)} must be an explicit directory /** glob`,
      );
    }
    directoryPaths.add(pattern.slice(0, -3));
  }
  return directoryPaths;
};

const sourceFiles = (directory, skippedDirectoryPaths, scanRootDirectory) => {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path
      .relative(scanRootDirectory, absolutePath)
      .replaceAll(path.sep, "/");

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        skippedDirectoryPaths.has(relativePath)
      ) {
        continue;
      }
      files.push(
        ...sourceFiles(absolutePath, skippedDirectoryPaths, scanRootDirectory),
      );
      continue;
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push({ absolutePath, relativePath });
    }
  }

  return files;
};

const commentRanges = (sourceText, relativePath) => {
  const sourceFile = ts.createSourceFile(
    relativePath,
    sourceText,
    ts.ScriptTarget.Latest,
    false,
  );
  const rangesByStart = new Map();
  const addRanges = (ranges) => {
    for (const range of ranges ?? []) rangesByStart.set(range.pos, range);
  };
  const visit = (node) => {
    addRanges(ts.getLeadingCommentRanges(sourceText, node.getFullStart()));
    addRanges(ts.getTrailingCommentRanges(sourceText, node.end));
    for (const child of node.getChildren(sourceFile)) visit(child);
  };

  visit(sourceFile);
  return {
    ranges: [...rangesByStart.values()].sort(
      (left, right) => left.pos - right.pos,
    ),
    sourceFile,
  };
};

export const assertSuppressionPolicy = ({
  scanRootDirectory = rootDirectory,
  skippedDirectoryPaths = ignoredDirectoryPaths(),
} = {}) => {
  const directiveCommentPattern =
    /^(?:\/\/|\/\*)\s*oxlint-(?:disable|enable)(?:-(?:line|next-line))?\b/u;
  const suppressions = [];
  const forbidden = [];

  for (const { absolutePath, relativePath } of sourceFiles(
    scanRootDirectory,
    skippedDirectoryPaths,
    scanRootDirectory,
  )) {
    const sourceText = readFileSync(absolutePath, "utf8");
    const { ranges, sourceFile } = commentRanges(sourceText, relativePath);
    for (const range of ranges) {
      const comment = sourceText.slice(range.pos, range.end);
      if (!directiveCommentPattern.test(comment)) continue;
      const line = sourceFile.getLineAndCharacterOfPosition(range.pos).line + 1;
      const location = `${relativePath}:${line}`;
      suppressions.push(location);
      if (!allowedSuppressionFiles.has(relativePath)) forbidden.push(location);
    }
  }

  if (forbidden.length > 0) {
    throw new Error(
      `Anti-slop suppressions are not allowed; rejected ${forbidden.join(", ")}`,
    );
  }
  if (suppressions.length > MAX_ANTI_SLOP_SUPPRESSIONS) {
    throw new Error(
      `At most ${MAX_ANTI_SLOP_SUPPRESSIONS} anti-slop suppressions are allowed; found ${suppressions.length}: ${suppressions.join(", ")}`,
    );
  }
};

const assertCanary = () => {
  const result = spawnSync(
    process.execPath,
    [
      oxlintLauncher,
      "--config",
      configPath,
      "--disable-nested-config",
      "--format",
      "json",
      canaryPath,
    ],
    {
      cwd: rootDirectory,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 30_000,
    },
  );

  if (result.error !== undefined) {
    throw new Error(
      `Could not run the oxlint Node launcher: ${result.error.message}`,
    );
  }
  if (result.signal !== null) {
    throw new Error(`The anti-slop canary ended with signal ${result.signal}`);
  }
  if (result.status !== 1) {
    throw new Error(
      `The anti-slop canary must exit 1; exited ${JSON.stringify(result.status)}. stderr: ${result.stderr.trim() || "<empty>"}`,
    );
  }
  if (result.stderr.trim() !== "") {
    throw new Error(
      `The anti-slop canary wrote unexpected stderr: ${result.stderr.trim()}`,
    );
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `The anti-slop canary did not return valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    !report ||
    !Array.isArray(report.diagnostics) ||
    report.number_of_files !== 1 ||
    report.number_of_rules !== EXPECTED_CODES.size
  ) {
    throw new Error("The anti-slop canary returned a malformed report");
  }

  const actualCodes = report.diagnostics.map((diagnostic) => diagnostic?.code);
  const unexpectedCodes = actualCodes.filter(
    (code) => !EXPECTED_CODES.has(code),
  );
  const missingCodes = [...EXPECTED_CODES].filter(
    (code) => !actualCodes.includes(code),
  );
  const malformedDiagnostics = report.diagnostics.filter(
    (diagnostic) =>
      diagnostic?.severity !== "error" ||
      diagnostic?.filename?.replaceAll("\\", "/") !== "tools/oxlint/canary.ts",
  );

  if (
    actualCodes.length !== EXPECTED_CODES.size ||
    new Set(actualCodes).size !== EXPECTED_CODES.size ||
    unexpectedCodes.length > 0 ||
    missingCodes.length > 0 ||
    malformedDiagnostics.length > 0
  ) {
    throw new Error(
      `The anti-slop canary returned the wrong diagnostics. Expected ${JSON.stringify([...EXPECTED_CODES])}; received ${JSON.stringify(actualCodes)}`,
    );
  }
};

if (import.meta.main) {
  try {
    assertNodeRuntime();
    assertPinnedPackages();
    assertSuppressionPolicy();
    assertCanary();
    console.log(
      `Anti-slop canary passed: all ${EXPECTED_CODES.size} selected rules loaded through the pinned Node launcher.`,
    );
  } catch (error) {
    console.error(
      `Anti-slop verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
