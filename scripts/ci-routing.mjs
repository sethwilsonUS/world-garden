import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);

const routeNames = ["web", "mobile", "python", "docs", "architecture"];

export const ALL_CI_ROUTES = Object.freeze(
  Object.fromEntries(routeNames.map((name) => [name, "true"])),
);

export const CI_JOB_ROUTES = Object.freeze({
  lint: ["web"],
  typecheck: ["web"],
  test: ["web"],
  build: ["web"],
  browser: ["web"],
  mobile: ["mobile"],
  python: ["python"],
  docs: ["docs"],
  architecture: ["architecture"],
});

const allRoutes = () => ({ ...ALL_CI_ROUTES });
const noRoutes = () =>
  Object.fromEntries(routeNames.map((name) => [name, "false"]));

const select = (routes, ...names) => {
  for (const name of names) routes[name] = "true";
};

const normalizeRepositoryPath = (value) => {
  const normalized = String(value).replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("\0")
  ) {
    return null;
  }
  return normalized;
};

const isCiInfrastructure = (filePath) =>
  filePath.startsWith(".github/workflows/") ||
  filePath.startsWith(".github/actions/") ||
  filePath === ".github/dependabot.yml" ||
  filePath === "scripts/ci-routing.mjs" ||
  filePath === "scripts/ci-routing.test.mjs";

const sharedWorkspaceFiles = new Set([
  ".nvmrc",
  ".npmrc",
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
]);

const architectureFiles = new Set([
  "arch-baseline.json",
  "arch.rules.mts",
  "mobile/arch.rules.mts",
  "mobile/tsconfig.arch.json",
  "ts-archunit.config.js",
  "tsconfig.arch.json",
]);

const webConfigurationFiles = new Set([
  "eslint.config.mjs",
  "next.config.ts",
  "playwright.auth.config.ts",
  "playwright.config.ts",
  "postcss.config.mjs",
  "proxy.ts",
  "tsconfig.json",
  "vercel.json",
  "vitest.config.mts",
]);

const routeKnownPath = (filePath, routes) => {
  if (isCiInfrastructure(filePath)) return false;

  if (filePath.endsWith(".md")) {
    select(routes, "docs");
    return true;
  }

  if (filePath.startsWith("docs/")) {
    select(routes, "docs");
    return true;
  }

  if (sharedWorkspaceFiles.has(filePath)) {
    select(routes, "web", "mobile", "docs", "architecture");
    return true;
  }

  if (filePath.startsWith("convex/") || filePath.startsWith("packages/")) {
    select(routes, "web", "mobile", "architecture");
    return true;
  }

  if (filePath === "tsconfig.json") {
    select(routes, "web", "architecture");
    return true;
  }

  if (architectureFiles.has(filePath)) {
    select(routes, "architecture");
    return true;
  }

  if (filePath.startsWith("mobile/")) {
    select(routes, "mobile", "architecture");
    return true;
  }

  if (
    filePath.startsWith("app/") ||
    filePath.startsWith("components/") ||
    filePath.startsWith("hooks/") ||
    filePath.startsWith("lib/") ||
    filePath.startsWith("types/") ||
    filePath === "next.config.ts" ||
    filePath === "proxy.ts"
  ) {
    select(routes, "web", "architecture");
    return true;
  }

  if (filePath.startsWith("public/") || filePath.startsWith("e2e/")) {
    select(routes, "web");
    return true;
  }

  if (
    filePath.startsWith("_python/") ||
    filePath === "requirements.txt" ||
    filePath.startsWith("requirements-") ||
    filePath === "scripts/dev-tts.py" ||
    filePath === "scripts/ensure-edge-tts.sh"
  ) {
    select(routes, "python");
    return true;
  }

  if (filePath === "scripts/validate-doc-links.mjs") {
    select(routes, "docs");
    return true;
  }

  if (filePath.startsWith("scripts/")) {
    select(routes, "web");
    return true;
  }

  if (
    webConfigurationFiles.has(filePath) ||
    /^playwright(?:\.[^.]+)*\.config\.ts$/.test(filePath)
  ) {
    select(routes, "web");
    return true;
  }

  return false;
};

export const classifyPaths = (paths) => {
  if (!Array.isArray(paths) || paths.length === 0) return allRoutes();

  const routes = noRoutes();
  // Markdown may link to any tracked file, so every non-empty change needs the
  // inexpensive documentation link check even when no Markdown changed.
  select(routes, "docs");
  for (const value of paths) {
    const filePath = normalizeRepositoryPath(value);
    if (filePath === null || !routeKnownPath(filePath, routes)) {
      return allRoutes();
    }
  }
  return routes;
};

export const parseNulSeparatedPaths = (value) =>
  Buffer.from(value).toString("utf8").split("\0").filter(Boolean);

export const verifyRequiredJobs = ({
  classifierResult,
  routes,
  jobResults,
}) => {
  const errors = [];

  if (classifierResult !== "success") {
    errors.push(
      `Classifier returned ${JSON.stringify(classifierResult)}; expected "success"`,
    );
  }

  for (const routeName of routeNames) {
    const value = routes?.[routeName];
    if (value !== "true" && value !== "false") {
      errors.push(
        `Route "${routeName}" must be "true" or "false"; received ${JSON.stringify(value)}`,
      );
    }
  }

  for (const [jobName, selectedBy] of Object.entries(CI_JOB_ROUTES)) {
    const result = jobResults?.[jobName];
    if (result === "failure" || result === "cancelled") {
      errors.push(`Job "${jobName}" returned terminal result "${result}"`);
      continue;
    }
    if (result !== "success" && result !== "skipped") {
      errors.push(
        `Job "${jobName}" returned unknown result ${JSON.stringify(result)}`,
      );
      continue;
    }

    const selected = selectedBy.some(
      (routeName) => routes?.[routeName] === "true",
    );
    if (selected && result !== "success") {
      errors.push(
        `Selected job "${jobName}" returned "${result}"; expected "success"`,
      );
    }
  }

  return { errors };
};

const assertCommitSha = (value, label) => {
  if (!/^[a-f\d]{40}$/i.test(value ?? "") || /^0+$/.test(value)) {
    throw new Error(`${label} is not a usable full commit SHA`);
  }
};

const classifyGitDiff = () => {
  const baseSha = process.env.CI_BASE_SHA;
  const headSha = process.env.CI_HEAD_SHA;

  try {
    assertCommitSha(baseSha, "CI_BASE_SHA");
    assertCommitSha(headSha, "CI_HEAD_SHA");
    const output = execFileSync(
      "git",
      [
        "diff",
        "--no-renames",
        "--name-only",
        "--diff-filter=ACDMRTUXB",
        "-z",
        baseSha,
        headSha,
      ],
      { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
    );
    const changedPaths = parseNulSeparatedPaths(output);
    if (changedPaths.length === 0) {
      console.error(
        "CI change classification found an empty diff; selecting every gate.",
      );
      return allRoutes();
    }
    return classifyPaths(changedPaths);
  } catch (error) {
    console.error(
      `CI change classification could not read the diff; selecting every gate. ${error instanceof Error ? error.message : String(error)}`,
    );
    return allRoutes();
  }
};

const routesFromEnvironment = () =>
  Object.fromEntries(
    routeNames.map((name) => [
      name,
      process.env[`CI_ROUTE_${name.toUpperCase()}`],
    ]),
  );

const jobResultsFromEnvironment = () =>
  Object.fromEntries(
    Object.keys(CI_JOB_ROUTES).map((name) => [
      name,
      process.env[`CI_RESULT_${name.toUpperCase()}`],
    ]),
  );

const runCli = () => {
  const command = process.argv[2];
  if (command === "classify") {
    const routes = classifyGitDiff();
    for (const name of routeNames) console.log(`${name}=${routes[name]}`);
    return;
  }

  if (command === "verify") {
    const result = verifyRequiredJobs({
      classifierResult: process.env.CI_RESULT_CLASSIFIER,
      routes: routesFromEnvironment(),
      jobResults: jobResultsFromEnvironment(),
    });
    if (result.errors.length > 0) {
      console.error("Required CI failed:");
      for (const error of result.errors) console.error(`- ${error}`);
      process.exitCode = 1;
      return;
    }
    console.log("Required CI passed: every selected gate completed successfully.");
    return;
  }

  console.error("Usage: node scripts/ci-routing.mjs <classify|verify>");
  process.exitCode = 2;
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  runCli();
}
