import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  formatHumanReport,
  fetchCostReport,
  isDirectInvocation,
  main,
  parseArgs,
  resolveReportUrl,
  serializeAiCostReportCsv,
} from "./ai-cost-report.mjs";

const sampleReport = {
  range: {
    from: "2026-07-01",
    to: "2026-08-01",
    timezone: "UTC",
  },
  costs: {
    estimated_direct_ai_cost_micros: 125_000,
    estimated_direct_ai_cost_known_subtotal_micros: 125_000,
    estimated_direct_ai_cost_quality: "derived_from_provider_usage",
    estimated_direct_ai_cost_reason: null,
    reconciled_direct_ai_cost_micros: 130_000,
    reconciled_direct_ai_cost_quality: "provider_reported",
    reconciled_allocated_micros: 130_000,
    reconciled_unallocated_micros: 0,
    allocated_infrastructure_cost_micros: null,
    allocated_infrastructure_cost_reason:
      "No explicit infrastructure allocation is configured.",
    fully_loaded_cost_micros: null,
    fully_loaded_cost_reason:
      "Fully loaded cost requires an explicit infrastructure allocation.",
    estimate_to_actual_variance_micros: 5_000,
    estimate_to_actual_variance_reason: null,
    reconciliation: {
      quality: "provider_reported",
      coverage_fraction: 1,
      explanation: "One provider statement covers the complete range.",
      allocation_quality: "locally_allocated",
      allocation_methods: ["input_tokens"],
    },
    attempts: {
      total: 5,
      successful: 3,
      failed_before_dispatch: 1,
      failed_after_dispatch: 0,
      unknown_after_dispatch: 1,
      potentially_billable: 4,
    },
    fallback: { attempts: 1, succeeded: 1 },
    daily: [
      {
        day: "2026-07-01",
        estimated_direct_ai_cost_micros: 25_000,
        reconciled_direct_ai_cost_micros: 26_000,
      },
      {
        day: "2026-07-02",
        estimated_direct_ai_cost_micros: 100_000,
        reconciled_direct_ai_cost_micros: 104_000,
      },
    ],
    by_provider: [
      {
        provider: "openai",
        estimated_direct_ai_cost_micros: 125_000,
        reconciled_direct_ai_cost_micros: 130_000,
      },
    ],
    by_operation: [
      {
        operation: "tts",
        estimated_direct_ai_cost_micros: 125_000,
        reconciled_direct_ai_cost_micros: 130_000,
      },
    ],
  },
  audio: {
    unique_generated_audio_seconds: 7_200,
    response_audio_bytes: 42_000,
  },
  cache: {
    cache_request_hit_rate: 0.75,
    reuse_factor: 3,
    cache_hits: 3,
    cache_misses: 1,
    unique_generated_assets: 1,
    reused_asset_serves: 3,
    avoided_generation: 3,
    concurrent_generation_races: 1,
    cache_write_failures: 0,
    pipeline_generated_sections: 2,
    pipeline_reused_sections: 4,
  },
  listening: {
    signed_in_unique_heard_seconds: 3_600,
    signed_in_unique_heard_hours: 1,
  },
  unit_costs: {
    reconciled_direct_ai_cost_per_observed_useful_hour: 130_000,
    reconciled_direct_ai_cost_per_observed_useful_hour_reason: null,
    reconciled_direct_ai_cost_per_observed_useful_hour_coverage_quality:
      "marker_precedes_range_no_known_gaps",
    fully_loaded_cost_per_observed_useful_hour: null,
    explanation:
      "Fully loaded cost is unavailable because no infrastructure allocation is configured.",
  },
  generation_use: {
    observed_meaningful_use: 4,
    no_observed_meaningful_use: 2,
    awaiting_observation: 1,
    external_consumption_unknown: 3,
    observed_meaningful_use_rate: 2 / 3,
    no_observed_meaningful_use_rate: 1 / 3,
    rate_reason: null,
  },
  coverage: {
    starts_at: "2026-07-01T00:00:00.000Z",
    observed_activity_start_day: "2026-07-01",
    range_coverage: "marker_precedes_requested_range",
    instrumentation_completeness: "no_known_gaps",
    instrumentation_completeness_reason:
      "No rollup inconsistency was detected; best-effort delivery is not guaranteed.",
    reconciliation_status: "provider_reported_and_fully_allocated",
    measurement_quality_counts: {
      estimated_cost_known_attempts: 4,
      estimated_cost_unknown_attempts: 1,
      derived_from_provider_usage_attempts: 3,
      locally_measured_estimate_attempts: 1,
      provider_attempt_accounting_gap_rows: 0,
      measured_generation_duration_ms: 1_000,
      estimated_generation_duration_ms: 2_000,
    },
    excluded_populations: [
      "Guest listening",
      "External podcast and downloaded-file listening",
    ],
    known_blind_spots: ["Direct browser Edge cache hits"],
  },
};

describe("AI cost report CLI", () => {
  it("recognizes direct entrypoints whose file URL needs encoding", () => {
    const entryPath = path.join(
      os.tmpdir(),
      "Curio Garden",
      "ai-cost-report.mjs",
    );

    expect(isDirectInvocation(pathToFileURL(entryPath).href, entryPath)).toBe(
      true,
    );
  });

  it("uses the shared stderr and exit-one convention for command errors", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(import.meta.dirname, "ai-cost-report.mjs"), "--bogus"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "AI cost report failed: Unknown option: --bogus",
    );
  });

  it("requires bounded UTC date arguments", () => {
    expect(
      parseArgs(["--from", "2026-07-01", "--to", "2026-08-01", "--json"]),
    ).toEqual({
      csv: false,
      from: "2026-07-01",
      help: false,
      json: true,
      limit: undefined,
      output: undefined,
      to: "2026-08-01",
    });

    expect(() => parseArgs(["--from", "2026-07-01"])).toThrow(
      "--from and --to are required",
    );
    expect(() =>
      parseArgs(["--from", "yesterday", "--to", "2026-08-01"]),
    ).toThrow("YYYY-MM-DD");
    expect(() =>
      parseArgs(["--from", "2026-01-01", "--to", "2026-04-02"]),
    ).toThrow("90 days");
  });

  it("parses the shared terminal and CSV flags and rejects unsafe combinations", () => {
    expect(
      parseArgs([
        "--from",
        "2026-07-01",
        "--to",
        "2026-08-01",
        "--csv",
        "--output",
        "costs.csv",
        "--limit",
        "7",
      ]),
    ).toEqual({
      csv: true,
      from: "2026-07-01",
      help: false,
      json: false,
      limit: 7,
      output: "costs.csv",
      to: "2026-08-01",
    });
    expect(parseArgs(["--help"])).toMatchObject({ help: true });
    expect(parseArgs(["-h"])).toMatchObject({ help: true });
    expect(() =>
      parseArgs([
        "--from",
        "2026-07-01",
        "--to",
        "2026-08-01",
        "--output",
        "costs.csv",
      ]),
    ).toThrow("--output requires --csv");
    expect(() =>
      parseArgs([
        "--from",
        "2026-07-01",
        "--to",
        "2026-08-01",
        "--csv",
        "--json",
      ]),
    ).toThrow("--csv and --json cannot be used together");
    expect(() =>
      parseArgs(["--from", "2026-07-01", "--to", "2026-08-01", "--limit", "0"]),
    ).toThrow("--limit must be an integer from 1 to 10000");
  });

  it("builds the owner route without leaking the secret into the URL", () => {
    const url = resolveReportUrl({
      baseUrl: "https://curiogarden.org",
      from: "2026-07-01",
      to: "2026-08-01",
    });

    expect(url).toBe(
      "https://curiogarden.org/api/analytics/costs?from=2026-07-01&to=2026-08-01",
    );
    expect(url).not.toContain("secret");
  });

  it("renders labeled, screen-reader-friendly sections instead of a pipe table", () => {
    const output = formatHumanReport(sampleReport);

    expect(output).toContain("# Curio Garden AI cost ledger");
    expect(output).toContain("Reconciled direct AI spend: $0.130000");
    expect(output).toContain(
      "Reconciled direct AI cost per observed useful hour: $0.130000",
    );
    expect(output).toContain("Signed-in unique heard hours: 1.00");
    expect(output).toContain("External consumption unknown: 3");
    expect(output).toContain("Guest listening");
    expect(output).toContain("## Daily direct AI spend");
    expect(output).toContain("Day: 2026-07-01");
    expect(output).toContain("Provider: openai");
    expect(output).toContain("Operation: tts");
    expect(output).toContain("Known estimated subtotal: $0.125000");
    expect(output).toContain("Estimate-to-actual variance: $0.005000");
    expect(output).toContain("Provider attempts: 5");
    expect(output).toContain("Unknown after dispatch: 1");
    expect(output).toContain("Fallback attempts: 1");
    expect(output).toContain("Pipeline generated sections: 2");
    expect(output).toContain("Pipeline reused sections: 4");
    expect(output).toContain("Observed meaningful use rate: 66.7%");
    expect(output).toContain(
      "Temporal range coverage: marker_precedes_requested_range",
    );
    expect(output).toContain(
      "Unit-cost coverage quality: marker_precedes_range_no_known_gaps",
    );
    expect(output).toContain("Instrumentation completeness: no_known_gaps");
    expect(output).toContain("Provider-usage estimate attempts: 3");
    expect(output).not.toContain(" | ");
  });

  it("limits each repeated breakdown without changing headline totals", () => {
    const output = formatHumanReport(sampleReport, { limit: 1 });

    expect(output).toContain("Estimated direct AI spend: $0.125000");
    expect(output).toContain("Day: 2026-07-01");
    expect(output).not.toContain("Day: 2026-07-02");
    expect(output).toContain(
      "More daily entries are available. Increase --limit to view them.",
    );
  });

  it("renders unavailable values as unavailable rather than zero", () => {
    const output = formatHumanReport({
      ...sampleReport,
      costs: {
        ...sampleReport.costs,
        reconciled_direct_ai_cost_micros: null,
      },
      unit_costs: {
        reconciled_direct_ai_cost_per_observed_useful_hour: null,
        fully_loaded_cost_per_observed_useful_hour: null,
        explanation: "No provider statement covers this period.",
      },
    });

    expect(output).toContain("Reconciled direct AI spend: unavailable");
    expect(output).toContain(
      "Reconciled direct AI cost per observed useful hour: unavailable",
    );
    expect(output).toContain("No provider statement covers this period.");
  });

  it("serializes stable, spreadsheet-safe total and breakdown CSV rows", () => {
    const report = {
      ...sampleReport,
      costs: {
        ...sampleReport.costs,
        by_provider: [
          {
            provider: "=openai",
            estimated_direct_ai_cost_micros: 125_000,
            reconciled_direct_ai_cost_micros: 130_000,
          },
          {
            provider: "  |edge",
            estimated_direct_ai_cost_micros: null,
            reconciled_direct_ai_cost_micros: null,
          },
          {
            provider: " \u0001=hidden",
            estimated_direct_ai_cost_micros: null,
            reconciled_direct_ai_cost_micros: null,
          },
        ],
      },
    };

    const csv = serializeAiCostReportCsv(report, { limit: 3 });

    expect(csv).toMatch(
      /^breakdown,key,estimated_direct_ai_cost_micros,reconciled_direct_ai_cost_micros\r\n/,
    );
    expect(csv).toContain("total,all,125000,130000\r\n");
    expect(csv).toContain("day,2026-07-01,25000,26000\r\n");
    expect(csv).toContain("provider,'=openai,125000,130000\r\n");
    expect(csv).toContain("provider,'  |edge,,\r\n");
    expect(csv).toContain("provider,' \u0001=hidden,,\r\n");
    expect(csv).toContain("operation,tts,125000,130000\r\n");
  });

  it("prints help without loading environment or fetching a report", async () => {
    const output = [];
    let envLoaded = false;
    let fetched = false;

    await main(["--help"], process.cwd(), {
      fetchReport: async () => {
        fetched = true;
        throw new Error("should not fetch");
      },
      loadEnv: async () => {
        envLoaded = true;
      },
      writeStdout: (text) => output.push(text),
    });

    const help = output.join("");
    expect(envLoaded).toBe(false);
    expect(fetched).toBe(false);
    expect(help).toContain("npm run report:costs");
    expect(help).toContain("--csv");
    expect(help).toContain("--output <path>");
    expect(help).toContain("--limit <count>");
    expect(help).toContain("--help, -h");
    expect(help).toContain(
      "The terminal view defaults to 50 entries per breakdown",
    );
  });

  it("exports CSV to a new private file without echoing report contents", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-ai-costs-"));
    const outputPath = path.join(directory, "costs.csv");
    const stdout = [];

    try {
      await main(
        [
          "--from",
          "2026-07-01",
          "--to",
          "2026-08-01",
          "--csv",
          "--output",
          outputPath,
          "--limit",
          "1",
        ],
        process.cwd(),
        {
          fetchReport: async () => sampleReport,
          loadEnv: async () => undefined,
          writeStdout: (text) => stdout.push(text),
        },
      );

      const csv = await readFile(outputPath, "utf8");
      const fileStat = await stat(outputPath);
      expect(csv).toContain("total,all,125000,130000");
      expect(csv).toContain("day,2026-07-01,25000,26000");
      expect(csv).not.toContain("day,2026-07-02,100000,104000");
      expect(fileStat.mode & 0o777).toBe(0o600);
      expect(stdout.join("")).toContain("Exported 4 AI cost rows");
      expect(stdout.join("")).toContain(outputPath);
      expect(stdout.join("")).not.toContain("125000");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an export before fetching", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-ai-costs-"));
    const outputPath = path.join(directory, "costs.csv");
    let fetched = false;

    try {
      await writeFile(outputPath, "keep me", "utf8");
      await expect(
        main(
          [
            "--from",
            "2026-07-01",
            "--to",
            "2026-08-01",
            "--csv",
            "--output",
            outputPath,
          ],
          process.cwd(),
          {
            fetchReport: async () => {
              fetched = true;
              return sampleReport;
            },
            loadEnv: async () => undefined,
          },
        ),
      ).rejects.toThrow(
        `Refusing to overwrite existing AI cost export: ${outputPath}`,
      );
      expect(fetched).toBe(false);
      await expect(readFile(outputPath, "utf8")).resolves.toBe("keep me");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("removes a reserved partial export when report fetching fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-ai-costs-"));
    const outputPath = path.join(directory, "costs.csv");

    try {
      await expect(
        main(
          [
            "--from",
            "2026-07-01",
            "--to",
            "2026-08-01",
            "--csv",
            "--output",
            outputPath,
          ],
          process.cwd(),
          {
            fetchReport: async () => {
              throw new Error("synthetic fetch failure");
            },
            loadEnv: async () => undefined,
          },
        ),
      ).rejects.toThrow("synthetic fetch failure");
      await expect(readFile(outputPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("times out a stalled report and removes the reserved CSV", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-ai-costs-"));
    const outputPath = path.join(directory, "costs.csv");

    try {
      await expect(
        main(
          [
            "--from",
            "2026-07-01",
            "--to",
            "2026-08-01",
            "--csv",
            "--output",
            outputPath,
          ],
          process.cwd(),
          {
            fetchReport: async (options) =>
              await fetchCostReport({
                ...options,
                baseUrl: "https://curiogarden.org",
                secret: "synthetic-owner-secret",
                timeoutMs: 5,
                fetchImpl: async (_input, init) =>
                  await new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener(
                      "abort",
                      () => reject(init.signal.reason),
                      { once: true },
                    );
                  }),
              }),
            loadEnv: async () => undefined,
          },
        ),
      ).rejects.toThrow("Cost report request timed out after 5 ms");
      await expect(readFile(outputPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps the original operation error as the cause if cleanup fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-ai-costs-"));
    const outputPath = path.join(directory, "costs.csv");

    try {
      let caught;
      try {
        await main(
          [
            "--from",
            "2026-07-01",
            "--to",
            "2026-08-01",
            "--csv",
            "--output",
            outputPath,
          ],
          process.cwd(),
          {
            fetchReport: async () => {
              throw new Error("synthetic report failure");
            },
            loadEnv: async () => undefined,
            removeFile: async () => {
              throw new Error("synthetic cleanup failure");
            },
          },
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toMatchObject({
        message: `Could not remove partial AI cost export: ${outputPath}`,
        cause: { message: "synthetic report failure" },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps a successfully written CSV when closing the export fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-ai-costs-"));
    const outputPath = path.join(directory, "costs.csv");
    const removeFile = vi.fn().mockResolvedValue(undefined);
    let closeAttempts = 0;

    try {
      await expect(
        main(
          [
            "--from",
            "2026-07-01",
            "--to",
            "2026-08-01",
            "--csv",
            "--output",
            outputPath,
          ],
          process.cwd(),
          {
            fetchReport: async () => sampleReport,
            loadEnv: async () => undefined,
            openFile: async () => ({
              writeFile: async (contents) =>
                await writeFile(outputPath, contents, {
                  encoding: "utf8",
                  mode: 0o600,
                }),
              close: async () => {
                closeAttempts += 1;
                if (closeAttempts === 1) {
                  throw new Error("synthetic close failure");
                }
              },
            }),
            removeFile,
          },
        ),
      ).rejects.toThrow("synthetic close failure");

      expect(removeFile).not.toHaveBeenCalled();
      expect(closeAttempts).toBe(2);
      await expect(readFile(outputPath, "utf8")).resolves.toContain(
        "breakdown,key,estimated_direct_ai_cost_micros",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
