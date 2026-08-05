import { describe, expect, it } from "vitest";

import {
  ALL_CI_ROUTES,
  classifyPaths,
  parseNulSeparatedPaths,
  verifyRequiredJobs,
} from "./ci-routing.mjs";

const routes = (selected = []) =>
  Object.fromEntries(
    Object.keys(ALL_CI_ROUTES).map((name) => [
      name,
      selected.includes(name) ? "true" : "false",
    ]),
  );

const successfulResults = {
  lint: "skipped",
  typecheck: "skipped",
  test: "skipped",
  build: "skipped",
  browser: "skipped",
  mobile: "skipped",
  python: "skipped",
  docs: "skipped",
  architecture: "skipped",
};

describe("classifyPaths", () => {
  it.each([
    ["mobile/app/index.tsx", ["mobile", "architecture"]],
    ["app/(app)/page.tsx", ["web", "architecture"]],
    ["components/SearchForm.tsx", ["web", "architecture"]],
    ["public/favicon.ico", ["web"]],
    ["e2e/showcase.spec.ts", ["web"]],
    ["_python/test_tts.py", ["python"]],
    ["requirements.txt", ["python"]],
    ["docs/toolchain.md", ["docs"]],
    ["mobile/README.md", ["docs"]],
    [".github/pull_request_template.md", ["docs"]],
    ["arch.rules.mts", ["architecture"]],
  ])("routes %s to the smallest safe gate set", (path, selected) => {
    expect(classifyPaths([path])).toEqual(routes(selected));
  });

  it.each([
    "convex/articles.ts",
    "packages/domain/src/article.ts",
    "package.json",
    "package-lock.json",
    ".nvmrc",
  ])("routes shared input %s to web, mobile, and architecture", (path) => {
    expect(classifyPaths([path])).toEqual(
      routes(["web", "mobile", "architecture"]),
    );
  });

  it.each([
    ".github/workflows/ci.yml",
    ".github/dependabot.yml",
    "scripts/ci-routing.mjs",
    "scripts/ci-routing.test.mjs",
    "an-unclassified-root-file.xyz",
  ])("fails safe to every gate for CI or unknown input %s", (path) => {
    expect(classifyPaths([path])).toEqual(ALL_CI_ROUTES);
  });

  it("fails safe when the diff is unexpectedly empty", () => {
    expect(classifyPaths([])).toEqual(ALL_CI_ROUTES);
  });

  it("unions categories across renamed, deleted, or mixed paths", () => {
    expect(
      classifyPaths([
        "mobile/src/old-name.ts",
        "mobile/src/new-name.ts",
        "public/deleted-image.png",
        "docs/renamed-guide.md",
      ]),
    ).toEqual(routes(["web", "mobile", "docs", "architecture"]));
  });

  it("normalizes Windows-style separators before matching", () => {
    expect(classifyPaths(["mobile\\src\\screen.tsx"])).toEqual(
      routes(["mobile", "architecture"]),
    );
  });
});

describe("parseNulSeparatedPaths", () => {
  it("preserves spaces and ignores the final empty NUL field", () => {
    expect(
      parseNulSeparatedPaths(
        Buffer.from("mobile/app/index.tsx\0docs/a useful guide.md\0"),
      ),
    ).toEqual(["mobile/app/index.tsx", "docs/a useful guide.md"]);
  });
});

describe("verifyRequiredJobs", () => {
  it("accepts successful selected jobs and skipped unselected jobs", () => {
    const result = verifyRequiredJobs({
      classifierResult: "success",
      routes: routes(["mobile", "architecture"]),
      jobResults: {
        ...successfulResults,
        mobile: "success",
        architecture: "success",
      },
    });

    expect(result).toEqual({ errors: [] });
  });

  it("rejects a selected job that GitHub skipped", () => {
    const result = verifyRequiredJobs({
      classifierResult: "success",
      routes: routes(["web"]),
      jobResults: successfulResults,
    });

    expect(result.errors).toContain(
      'Selected job "lint" returned "skipped"; expected "success"',
    );
  });

  it.each(["failure", "cancelled"])(
    "rejects any %s job result even when its route was unselected",
    (failedResult) => {
      const result = verifyRequiredJobs({
        classifierResult: "success",
        routes: routes([]),
        jobResults: { ...successfulResults, python: failedResult },
      });

      expect(result.errors).toContain(
        `Job "python" returned terminal result "${failedResult}"`,
      );
    },
  );

  it("rejects a failed classifier and malformed or missing outputs", () => {
    const malformedRoutes = routes([]);
    malformedRoutes.mobile = "yes";
    delete malformedRoutes.docs;

    const result = verifyRequiredJobs({
      classifierResult: "failure",
      routes: malformedRoutes,
      jobResults: successfulResults,
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Classifier returned "failure"; expected "success"',
        'Route "mobile" must be "true" or "false"; received "yes"',
        'Route "docs" must be "true" or "false"; received undefined',
      ]),
    );
  });

  it("rejects a missing or unknown job result", () => {
    const jobResults = { ...successfulResults, mobile: "queued" };
    delete jobResults.docs;

    const result = verifyRequiredJobs({
      classifierResult: "success",
      routes: routes([]),
      jobResults,
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Job "mobile" returned unknown result "queued"',
        'Job "docs" returned unknown result undefined',
      ]),
    );
  });
});
