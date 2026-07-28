import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { main as runCostReport } from "./ai-cost-report.mjs";
import { main as runFeedbackReport } from "./product-feedback-report.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");

const forbidden = (name) => async () => {
  throw new Error(`${name} must not run while showing help`);
};

const captureHelp = async (main, flag, dependencies) => {
  let stdout = "";

  await main([flag], REPO_ROOT, {
    ...dependencies,
    writeStdout: (text) => {
      stdout += text;
    },
  });

  return stdout;
};

describe("report CLI contract", () => {
  it("keeps canonical and compatibility npm aliases aligned", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(REPO_ROOT, "package.json"), "utf8"),
    );
    const { scripts } = packageJson;

    expect(scripts["report:feedback"]).toBe(
      "node scripts/product-feedback-report.mjs",
    );
    expect(scripts.feedback).toBe(scripts["report:feedback"]);

    expect(scripts["report:costs"]).toBe("node scripts/ai-cost-report.mjs");
    expect(scripts["analytics:costs"]).toBe(scripts["report:costs"]);
  });

  it("documents shared flags and handles both help forms without I/O", async () => {
    const feedbackDependencies = {
      createWorkspace: forbidden("feedback workspace creation"),
      runConvexPage: forbidden("feedback query"),
    };
    const costDependencies = {
      fetchReport: forbidden("cost report request"),
      loadEnv: forbidden("environment loading"),
    };

    const feedbackLong = await captureHelp(
      runFeedbackReport,
      "--help",
      feedbackDependencies,
    );
    const feedbackShort = await captureHelp(
      runFeedbackReport,
      "-h",
      feedbackDependencies,
    );
    const costLong = await captureHelp(
      runCostReport,
      "--help",
      costDependencies,
    );
    const costShort = await captureHelp(runCostReport, "-h", costDependencies);

    expect(feedbackShort).toBe(feedbackLong);
    expect(costShort).toBe(costLong);

    expect(feedbackLong).toMatch(/Usage:\n  npm run report:feedback(?:\n| )/);
    expect(costLong).toMatch(
      /Usage:\n  npm run report:costs -- --from YYYY-MM-DD --to YYYY-MM-DD(?:\n| )/,
    );

    for (const help of [feedbackLong, costLong]) {
      expect(help).toMatch(/^  --csv\s+/m);
      expect(help).toMatch(/^  --output <path>\s+/m);
      expect(help).toMatch(/^  --limit <count>\s+/m);
      expect(help).toMatch(/^  --help, -h\s+Show this help\.$/m);
    }
  });
});
