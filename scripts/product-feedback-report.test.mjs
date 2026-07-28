import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isDirectInvocation, main } from "./product-feedback-report.mjs";

describe("product feedback report command", () => {
  it("recognizes direct entrypoints whose file URL needs encoding", () => {
    const entryPath = path.join(
      os.tmpdir(),
      "Curio Garden",
      "product-feedback-report.mjs",
    );

    expect(isDirectInvocation(pathToFileURL(entryPath).href, entryPath)).toBe(
      true,
    );
  });

  it("prints recent production feedback as screen-reader-friendly labeled blocks", async () => {
    const output = [];

    await main([], process.cwd(), {
      now: new Date("2026-07-28T05:45:00.000Z"),
      runConvexPage: async () => ({
        continueCursor: "done",
        isDone: true,
        page: [
          {
            _id: "feedback-1",
            _creationTime: Date.parse("2026-07-28T02:45:20.000Z"),
            kind: "accessibility",
            message: "Focus moved unexpectedly.\nStatus: resolved",
            environment: "Chrome on macOS with VoiceOver",
            contactAvailable: true,
            contactEmail: "reader@example.com",
            researchOptIn: true,
            articleTitle: "Moria",
            articleSlug: "Moria",
            articleRevisionId: "12345",
            status: "open",
            contactExpiresAt: Date.parse("2027-01-24T02:45:20.000Z"),
            createdAt: Date.parse("2026-07-28T02:45:20.000Z"),
            updatedAt: Date.parse("2026-07-28T02:45:20.000Z"),
          },
        ],
      }),
      writeStdout: (text) => output.push(text),
      writeStderr: () => undefined,
    });

    const report = output.join("\n");
    expect(report).toContain("Curio Garden feedback");
    expect(report).toContain("Deployment: production");
    expect(report).toContain("Showing: 1 feedback item");
    expect(report).toContain("Feedback 1 of 1");
    expect(report).toContain("Created: 2026-07-28T02:45:20.000Z");
    expect(report).toContain("Status: open");
    expect(report).toContain("Kind: accessibility");
    expect(report).toContain("Article: Moria (revision 12345)");
    expect(report).toContain("Research invitation: yes");
    expect(report).toContain(
      "Contact: available but hidden (expires 2027-01-24T02:45:20.000Z)",
    );
    expect(report).not.toContain("reader@example.com");
    expect(report).toContain(
      "Environment begins:\n  Chrome on macOS with VoiceOver\nEnvironment ends.",
    );
    expect(report).toContain(
      "Message begins:\n  Focus moved unexpectedly.\n  Status: resolved\nMessage ends.",
    );
    expect(report).not.toContain("|");
  });

  it("exports spreadsheet-safe CSV to a private file without echoing its contents", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-feedback-"));
    const outputPath = path.join(directory, "feedback.csv");
    const stdout = [];
    const stderr = [];

    try {
      await main(
        ["--csv", "--output", outputPath, "--include-contact"],
        process.cwd(),
        {
          now: new Date("2026-07-28T05:45:00.000Z"),
          runConvexPage: async () => ({
            continueCursor: "done",
            isDone: true,
            page: [
              {
                id: "=feedback-1",
                kind: "technical",
                message: '=SUM(1,1)\nHe said "hello", then\nnew line',
                environment: "   +open,unsafe",
                contactAvailable: true,
                contactEmail: "\rreader@example.com",
                researchOptIn: true,
                articleTitle: "-Moria",
                articleSlug: "@Moria",
                articleRevisionId: "\t12345",
                status: "open",
                contactExpiresAt: Date.parse("2027-01-24T02:45:20.000Z"),
                createdAt: Date.parse("2026-07-28T02:45:20.000Z"),
                updatedAt: Date.parse("2026-07-28T03:45:20.000Z"),
              },
            ],
          }),
          writeStdout: (text) => stdout.push(text),
          writeStderr: (text) => stderr.push(text),
        },
      );

      const csv = await readFile(outputPath, "utf8");
      const fileStat = await stat(outputPath);
      expect(csv).toMatch(
        /^feedback_id,created_at_utc,updated_at_utc,status,kind,message,environment,research_opt_in,article_title,article_slug,article_revision_id,contact_available,contact_email,contact_expires_at_utc\r\n/,
      );
      expect(csv).toContain("'=feedback-1");
      expect(csv).toContain(`"'=SUM(1,1)\nHe said ""hello"", then\nnew line"`);
      expect(csv).toContain(`"'   +open,unsafe"`);
      expect(csv).toContain("'-Moria");
      expect(csv).toContain("'@Moria");
      expect(csv).toContain("'\t12345");
      expect(csv).toContain('"\'\rreader@example.com"');
      expect(csv).toContain("2026-07-28T02:45:20.000Z");
      expect(fileStat.mode & 0o777).toBe(0o600);

      const summary = stdout.join("\n");
      expect(summary).toContain("Exported 1 feedback item");
      expect(summary).toContain(outputPath);
      expect(summary).not.toContain("reader@example.com");
      expect(summary).not.toContain("SUM(1,1)");
      expect(stderr.join("\n")).toContain(
        "This export contains contact email and is outside automatic retention cleanup.",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("continues through an empty nonterminal page without losing feedback", async () => {
    const cursors = [];
    const reportRunIds = [];
    const snapshots = [];
    const output = [];
    const feedback = (id, message, createdAt) => ({
      id,
      kind: "product",
      message,
      contactAvailable: false,
      researchOptIn: false,
      status: "open",
      createdAt,
      updatedAt: createdAt,
    });
    const pages = new Map([
      [
        null,
        {
          page: [
            feedback("one", "First message", 3_000),
            feedback("two", "Second message", 2_000),
          ],
          isDone: false,
          continueCursor: "cursor-1",
          snapshotBefore: 42_000,
        },
      ],
      ["cursor-1", { page: [], isDone: false, continueCursor: "cursor-2" }],
      [
        "cursor-2",
        {
          page: [feedback("three", "Third message", 1_000)],
          isDone: true,
          continueCursor: "done",
        },
      ],
    ]);

    await main([], process.cwd(), {
      now: new Date("2026-07-28T05:45:00.000Z"),
      reportRunId: "report-run-1",
      runConvexPage: async ({ cursor, reportRunId, snapshotBefore }) => {
        cursors.push(cursor);
        reportRunIds.push(reportRunId);
        snapshots.push(snapshotBefore);
        return pages.get(cursor);
      },
      writeStdout: (text) => output.push(text),
      writeStderr: () => undefined,
    });

    expect(cursors).toEqual([null, "cursor-1", "cursor-2"]);
    expect(reportRunIds).toEqual([
      "report-run-1",
      "report-run-1",
      "report-run-1",
    ]);
    expect(snapshots).toEqual([undefined, 42_000, 42_000]);
    const report = output.join("\n");
    expect(report).toContain("Showing: 3 feedback items");
    expect(report.indexOf("First message")).toBeLessThan(
      report.indexOf("Second message"),
    );
    expect(report.indexOf("Second message")).toBeLessThan(
      report.indexOf("Third message"),
    );
  });

  it("uses the internal reader on Curio Garden production without passing local secrets", async () => {
    const calls = [];
    const output = [];
    const deploySecret = "deploy-secret-sentinel";
    const writeSecret = "write-secret-sentinel";

    await main([], process.cwd(), {
      now: new Date("2026-07-28T05:45:00.000Z"),
      reportRunId: "production-report-run",
      processEnv: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        LANG: "en_US.UTF-8",
        CONVEX_DEPLOY_KEY: deploySecret,
        CONVEX_OVERRIDE_ACCESS_TOKEN: "override-token-sentinel",
        CONVEX_PROVISION_HOST: "https://attacker.invalid",
        OPENAI_API_KEY: "unrelated-secret-sentinel",
        PRODUCT_FEEDBACK_WRITE_SECRET: writeSecret,
      },
      execFile: async (file, args, options) => {
        const isolatedPackage = JSON.parse(
          await readFile(path.join(options.cwd, "package.json"), "utf8"),
        );
        calls.push({ file, args, options, isolatedPackage });
        return {
          stdout: JSON.stringify({
            page: [],
            isDone: true,
            continueCursor: "done",
            snapshotBefore: Date.parse("2026-07-28T05:45:00.000Z"),
          }),
          stderr: "",
        };
      },
      writeStdout: (text) => output.push(text),
      writeStderr: () => undefined,
    });

    expect(calls).toHaveLength(1);
    const [{ file, args, options, isolatedPackage }] = calls;
    expect(file).toBe(process.execPath);
    expect(args[0]).toMatch(/node_modules[/\\]convex[/\\]bin[/\\]main\.js$/);
    expect(args).toContain("productFeedback:listProductFeedbackForOwner");
    expect(args).toContain("--deployment");
    expect(args).toContain("seth-wilson:world-garden:prod");
    expect(args).toContain("--typecheck");
    expect(args).toContain("disable");
    expect(args).not.toContain("--prod");
    expect(args).not.toContain("--push");
    const serializedArgs = args.join(" ");
    expect(serializedArgs).not.toContain("adminSecret");
    expect(serializedArgs).not.toContain(deploySecret);
    expect(serializedArgs).not.toContain(writeSecret);
    expect(serializedArgs).toContain('"reportRunId":"production-report-run"');
    expect(options.cwd).not.toBe(process.cwd());
    expect(options.env).not.toHaveProperty("CONVEX_DEPLOY_KEY");
    expect(options.env).not.toHaveProperty("CONVEX_OVERRIDE_ACCESS_TOKEN");
    expect(options.env).not.toHaveProperty("CONVEX_PROVISION_HOST");
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(options.env).not.toHaveProperty("PRODUCT_FEEDBACK_WRITE_SECRET");
    expect(options.env).toMatchObject({ LANG: "en_US.UTF-8" });
    expect(isolatedPackage).toEqual({
      private: true,
      dependencies: { convex: "*" },
    });
    expect(output.join("\n")).not.toContain(deploySecret);
    expect(output.join("\n")).not.toContain(writeSecret);
  });

  it("requires an explicit private-file destination before fetching contact email", async () => {
    let queryCalled = false;

    await expect(
      main(["--csv", "--include-contact"], process.cwd(), {
        runConvexPage: async () => {
          queryCalled = true;
          throw new Error("should not query");
        },
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      }),
    ).rejects.toThrow(
      "--include-contact requires --csv and an explicit --output path",
    );
    expect(queryCalled).toBe(false);
  });

  it("refuses to overwrite an existing export", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-feedback-"));
    const outputPath = path.join(directory, "feedback.csv");
    let queryCalled = false;

    try {
      await writeFile(outputPath, "keep me", "utf8");

      await expect(
        main(
          ["--csv", "--include-contact", "--output", outputPath],
          process.cwd(),
          {
            runConvexPage: async () => {
              queryCalled = true;
              return { page: [], isDone: true, continueCursor: "done" };
            },
            writeStdout: () => undefined,
            writeStderr: () => undefined,
          },
        ),
      ).rejects.toThrow(
        `Refusing to overwrite existing feedback export: ${outputPath}`,
      );
      expect(queryCalled).toBe(false);
      await expect(readFile(outputPath, "utf8")).resolves.toBe("keep me");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("prints command help without querying feedback", async () => {
    const output = [];
    let queryCalled = false;

    await main(["--help"], process.cwd(), {
      runConvexPage: async () => {
        queryCalled = true;
        throw new Error("should not query");
      },
      writeStdout: (text) => output.push(text),
      writeStderr: () => undefined,
    });

    const help = output.join("\n");
    expect(queryCalled).toBe(false);
    expect(help).toContain("npm run feedback");
    expect(help).toContain("--csv");
    expect(help).toContain("--output <path>");
    expect(help).toContain("--include-contact");
    expect(help).toContain("--status <status>");
    expect(help).toContain("--limit <count>");
    expect(help).toContain(
      "The dedicated contact email field is hidden unless explicitly included",
    );
  });

  it("applies an explicit status and terminal limit to the owner query", async () => {
    const calls = [];

    await main(["--status", "resolved", "--limit", "2"], process.cwd(), {
      now: new Date("2026-07-28T05:45:00.000Z"),
      reportRunId: "status-report-run",
      runConvexPage: async (options) => {
        calls.push(options);
        return { page: [], isDone: true, continueCursor: "done" };
      },
      writeStdout: () => undefined,
      writeStderr: () => undefined,
    });

    expect(calls).toEqual([
      {
        cursor: null,
        limit: 2,
        reportRunId: "status-report-run",
        status: "resolved",
        snapshotBefore: undefined,
        includeContact: false,
      },
    ]);
  });

  it("reports an empty open queue as a successful result", async () => {
    const output = [];

    await main([], process.cwd(), {
      runConvexPage: async () => ({
        page: [],
        isDone: true,
        continueCursor: "done",
      }),
      writeStdout: (text) => output.push(text),
      writeStderr: () => undefined,
    });

    expect(output.join("\n")).toContain("No open feedback found.");
  });

  it("rejects deployment overrides instead of risking a different database", async () => {
    let queryCalled = false;

    await expect(
      main(["--deployment", "dev"], process.cwd(), {
        runConvexPage: async () => {
          queryCalled = true;
          throw new Error("should not query");
        },
      }),
    ).rejects.toThrow("Unknown option: --deployment");
    expect(queryCalled).toBe(false);
  });

  it("fails loudly when Convex repeats a nonterminal pagination cursor", async () => {
    let calls = 0;

    await expect(
      main([], process.cwd(), {
        runConvexPage: async () => {
          calls += 1;
          if (calls > 2) throw new Error("pagination loop continued");
          return {
            page: [],
            isDone: false,
            continueCursor: "repeated-cursor",
          };
        },
      }),
    ).rejects.toThrow("Convex repeated a feedback pagination cursor");
    expect(calls).toBe(2);
  });

  it("uses a unique ignored reports path for CSV when no output is supplied", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-feedback-"));
    const expectedPath = path.join(
      directory,
      ".reports",
      "feedback",
      "feedback-2026-07-28T05-45-00-000Z.csv",
    );

    try {
      await main(["--csv"], directory, {
        now: new Date("2026-07-28T05:45:00.000Z"),
        runConvexPage: async () => ({
          page: [],
          isDone: true,
          continueCursor: "done",
        }),
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      });

      await expect(readFile(expectedPath, "utf8")).resolves.toMatch(
        /^feedback_id,created_at_utc/,
      );
      expect((await stat(expectedPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("announces when the terminal limit leaves more feedback available", async () => {
    const output = [];

    await main(["--limit", "1"], process.cwd(), {
      runConvexPage: async () => ({
        page: [
          {
            id: "one",
            kind: "product",
            message: "One visible item",
            contactAvailable: false,
            researchOptIn: false,
            status: "open",
            createdAt: 1_000,
            updatedAt: 1_000,
          },
        ],
        isDone: false,
        continueCursor: "more",
      }),
      writeStdout: (text) => output.push(text),
      writeStderr: () => undefined,
    });

    expect(output.join("\n")).toContain(
      "More feedback is available. Increase --limit to view it.",
    );
  });

  it("defensively excludes expired contact details from CSV", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-feedback-"));
    const outputPath = path.join(directory, "expired.csv");
    const now = new Date("2026-07-28T05:45:00.000Z");

    try {
      await main(
        ["--csv", "--include-contact", "--output", outputPath],
        process.cwd(),
        {
          now,
          runConvexPage: async () => ({
            page: [
              {
                id: "expired",
                kind: "product",
                message: "Expired contact",
                contactAvailable: true,
                contactEmail: "expired@example.com",
                contactExpiresAt: now.getTime(),
                researchOptIn: true,
                status: "open",
                createdAt: 1_000,
                updatedAt: 1_000,
              },
            ],
            isDone: true,
            continueCursor: "done",
          }),
          writeStdout: () => undefined,
          writeStderr: () => undefined,
        },
      );

      const csv = await readFile(outputPath, "utf8");
      expect(csv).not.toContain("expired@example.com");
      expect(csv).not.toContain(now.toISOString());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not serialize active contact email unless the export opted in", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-feedback-"));
    const outputPath = path.join(directory, "redacted.csv");

    try {
      await main(["--csv", "--output", outputPath], process.cwd(), {
        now: new Date("2026-07-28T05:45:00.000Z"),
        runConvexPage: async () => ({
          page: [
            {
              id: "active",
              kind: "product",
              message: "Active contact",
              contactAvailable: true,
              contactEmail: "active@example.com",
              contactExpiresAt: Date.parse("2027-01-24T02:45:20.000Z"),
              researchOptIn: true,
              status: "open",
              createdAt: 1_000,
              updatedAt: 1_000,
            },
          ],
          isDone: true,
          continueCursor: "done",
        }),
        writeStdout: () => undefined,
        writeStderr: () => undefined,
      });

      expect(await readFile(outputPath, "utf8")).not.toContain(
        "active@example.com",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("announces when a CSV limit makes the export incomplete", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-feedback-"));
    const outputPath = path.join(directory, "limited.csv");
    const stderr = [];

    try {
      await main(
        ["--csv", "--limit", "1", "--output", outputPath],
        process.cwd(),
        {
          runConvexPage: async () => ({
            page: [
              {
                id: "one",
                kind: "product",
                message: "One exported item",
                contactAvailable: false,
                researchOptIn: false,
                status: "open",
                createdAt: 1_000,
                updatedAt: 1_000,
              },
            ],
            isDone: false,
            continueCursor: "more",
          }),
          writeStdout: () => undefined,
          writeStderr: (text) => stderr.push(text),
        },
      );

      expect(stderr.join("\n")).toContain(
        "This CSV is incomplete; more matching feedback is available.",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("attempts partial-export cleanup even when closing the file fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-feedback-"));
    const outputPath = path.join(directory, "partial.csv");
    const removed = [];

    try {
      await expect(
        main(["--csv", "--output", outputPath], process.cwd(), {
          openFile: async () => ({
            writeFile: async () => {
              throw new Error("simulated write failure");
            },
            sync: async () => undefined,
            close: async () => {
              throw new Error("simulated close failure");
            },
          }),
          removeFile: async (filePath) => {
            removed.push(filePath);
          },
          runConvexPage: async () => ({
            page: [],
            isDone: true,
            continueCursor: "done",
          }),
          writeStdout: () => undefined,
          writeStderr: () => undefined,
        }),
      ).rejects.toThrow("simulated write failure");
      expect(removed).toEqual([outputPath]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rechecks contact expiry when the CSV is finally serialized", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "curio-feedback-"));
    const outputPath = path.join(directory, "expiry-boundary.csv");
    const times = [
      new Date("2030-01-01T00:00:00.000Z"),
      new Date("2030-01-01T00:02:00.000Z"),
    ];
    let clockCall = 0;

    try {
      await main(
        ["--csv", "--include-contact", "--output", outputPath],
        process.cwd(),
        {
          getNow: () => times[Math.min(clockCall++, times.length - 1)],
          runConvexPage: async () => ({
            page: [
              {
                id: "near-expiry",
                kind: "product",
                message: "Contact expired during export",
                contactAvailable: true,
                contactEmail: "near-expiry@example.com",
                contactExpiresAt: Date.parse("2030-01-01T00:01:00.000Z"),
                researchOptIn: true,
                status: "open",
                createdAt: 1_000,
                updatedAt: 1_000,
              },
            ],
            isDone: true,
            continueCursor: "done",
          }),
          writeStdout: () => undefined,
          writeStderr: () => undefined,
        },
      );

      expect(await readFile(outputPath, "utf8")).not.toContain(
        "near-expiry@example.com",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("distinguishes an undeployed feedback reader from a login failure", async () => {
    await expect(
      main([], process.cwd(), {
        execFile: async () => {
          const error = new Error("Convex command failed");
          error.stderr =
            "Could not find function productFeedback:listProductFeedbackForOwner";
          throw error;
        },
        processEnv: { HOME: process.env.HOME, PATH: process.env.PATH },
      }),
    ).rejects.toThrow(
      "The production feedback reader is not deployed yet. Deploy the current main branch and try again.",
    );
  });
});
