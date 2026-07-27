import path from "node:path";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  resolvePreviewBuildConfig,
  runPreviewBuild,
  runPreviewBuildCli,
} from "./build-preview.mjs";

const previewEnv = {
  VERCEL_ENV: "preview",
  VERCEL_URL: "World-Garden-Git-Voice.Example.Vercel.App",
  CURIO_CONVEX_PREVIEW_NAME: "codex/edge-tts-auth-policy",
  CONVEX_DEPLOY_KEY: "preview:seth-wilson:world-garden|secret",
  TTS_QUOTA_BYPASS_SECRET: "tts-secret-never-in-argv",
  PRODUCT_FEEDBACK_WRITE_SECRET: "feedback-secret-never-in-argv",
  VERCEL_AUTOMATION_BYPASS_SECRET: "vercel-secret-never-in-argv",
};

describe("resolvePreviewBuildConfig", () => {
  it("builds an HTTPS origin from Vercel's generated preview hostname", () => {
    expect(resolvePreviewBuildConfig(previewEnv)).toEqual({
      audioGenerationBaseUrl:
        "https://world-garden-git-voice.example.vercel.app",
      previewName: "codex/edge-tts-auth-policy",
    });
  });

  it.each([
    ["a production build", { ...previewEnv, VERCEL_ENV: "production" }],
    [
      "a missing preview name",
      { ...previewEnv, CURIO_CONVEX_PREVIEW_NAME: "" },
    ],
    [
      "a production deploy key",
      { ...previewEnv, CONVEX_DEPLOY_KEY: "prod:deployment|secret" },
    ],
    [
      "a Preview key for another team",
      {
        ...previewEnv,
        CONVEX_DEPLOY_KEY: "preview:other-team:world-garden|secret",
      },
    ],
    [
      "a Preview key for another project",
      {
        ...previewEnv,
        CONVEX_DEPLOY_KEY: "preview:seth-wilson:other-project|secret",
      },
    ],
    [
      "a Preview key without a credential",
      {
        ...previewEnv,
        CONVEX_DEPLOY_KEY: "preview:seth-wilson:world-garden|",
      },
    ],
    [
      "a Preview key with trailing whitespace",
      {
        ...previewEnv,
        CONVEX_DEPLOY_KEY: "preview:seth-wilson:world-garden|secret\n",
      },
    ],
    [
      "a missing TTS attestation secret",
      { ...previewEnv, TTS_QUOTA_BYPASS_SECRET: "" },
    ],
    [
      "a missing product feedback write secret",
      { ...previewEnv, PRODUCT_FEEDBACK_WRITE_SECRET: undefined },
    ],
    [
      "a blank product feedback write secret",
      { ...previewEnv, PRODUCT_FEEDBACK_WRITE_SECRET: "" },
    ],
    [
      "a whitespace-only product feedback write secret",
      { ...previewEnv, PRODUCT_FEEDBACK_WRITE_SECRET: "   " },
    ],
    [
      "a padded product feedback write secret",
      {
        ...previewEnv,
        PRODUCT_FEEDBACK_WRITE_SECRET: " feedback-secret-never-in-argv ",
      },
    ],
    [
      "a URL with a path",
      { ...previewEnv, VERCEL_URL: "safe.vercel.app/attacker" },
    ],
    [
      "a lookalike domain",
      { ...previewEnv, VERCEL_URL: "safe.vercel.app.attacker.example" },
    ],
  ])("fails closed for %s", (_label, env) => {
    expect(() => resolvePreviewBuildConfig(env)).toThrow();
  });
});

describe("runPreviewBuildCli", () => {
  it("validates check-only mode without building Next or mutating Convex", () => {
    const build = vi.fn();

    runPreviewBuildCli({
      args: ["--check-only"],
      env: previewEnv,
      build,
    });

    expect(build).not.toHaveBeenCalled();
  });
});

describe("scripts/build.sh Preview flow", () => {
  it("validates locally, authenticates with a dry run, then starts the real deploy", () => {
    const fixtureRoot = mkdtempSync(
      path.join(tmpdir(), "curio-preview-build-order-"),
    );
    const binDirectory = path.join(fixtureRoot, "bin");
    const commandLog = path.join(fixtureRoot, "commands.log");
    mkdirSync(binDirectory);

    const writeCommandRecorder = (command) => {
      const executable = path.join(binDirectory, command);
      writeFileSync(
        executable,
        `#!/bin/sh\nprintf '%s' '${command}' >> "$CURIO_COMMAND_LOG"\nfor arg in "$@"; do\n  printf ' <%s>' "$arg" >> "$CURIO_COMMAND_LOG"\ndone\nprintf '\\n' >> "$CURIO_COMMAND_LOG"\n`,
      );
      chmodSync(executable, 0o755);
    };

    try {
      writeCommandRecorder("node");
      writeCommandRecorder("npx");

      const result = spawnSync("/bin/bash", ["scripts/build.sh"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          CURIO_COMMAND_LOG: commandLog,
          PATH: `${binDirectory}:${process.env.PATH ?? ""}`,
          VERCEL_ENV: "preview",
          VERCEL_GIT_COMMIT_REF: "feature/bunnies",
        },
      });

      expect(result.status, result.stderr).toBe(0);
      expect(readFileSync(commandLog, "utf8").trim().split("\n")).toEqual([
        "node <scripts/build-preview.mjs> <--check-only>",
        "npx <convex> <deploy> <--dry-run> <--preview-create> <feature/bunnies>",
        "npx <convex> <deploy> <--cmd> <node scripts/build-preview.mjs> <--preview-name> <feature/bunnies>",
      ]);
    } finally {
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  });
});

describe("runPreviewBuild", () => {
  it("uses a preview selector accepted by the installed Convex CLI", () => {
    const convexCli = path.join(
      process.cwd(),
      "node_modules/convex/bin/main.js",
    );
    const result = spawnSync(
      process.execPath,
      [
        convexCli,
        "env",
        "set",
        "__CURIO_PREVIEW_SELECTOR_PROBE__",
        "--preview-name",
        "curio-preview-selector-probe",
        "--help",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("unknown option");
  });

  it("builds Next before syncing secrets and writes the exact audio origin last", () => {
    const run = vi.fn(() => ({ status: 0 }));
    const root = "/workspace/curio";

    runPreviewBuild({ env: previewEnv, root, run });

    expect(run).toHaveBeenNthCalledWith(
      1,
      process.execPath,
      [path.join(root, "node_modules/next/dist/bin/next"), "build"],
      expect.objectContaining({ env: previewEnv, stdio: "inherit" }),
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      process.execPath,
      [
        path.join(root, "node_modules/convex/bin/main.js"),
        "env",
        "set",
        "TTS_QUOTA_BYPASS_SECRET",
        "--preview-name",
        "codex/edge-tts-auth-policy",
      ],
      expect.objectContaining({
        env: previewEnv,
        input: "tts-secret-never-in-argv",
        stdio: ["pipe", "inherit", "inherit"],
      }),
    );
    expect(run).toHaveBeenNthCalledWith(
      3,
      process.execPath,
      [
        path.join(root, "node_modules/convex/bin/main.js"),
        "env",
        "set",
        "PRODUCT_FEEDBACK_WRITE_SECRET",
        "--preview-name",
        "codex/edge-tts-auth-policy",
      ],
      expect.objectContaining({
        env: previewEnv,
        input: "feedback-secret-never-in-argv",
        stdio: ["pipe", "inherit", "inherit"],
      }),
    );
    expect(run).toHaveBeenNthCalledWith(
      4,
      process.execPath,
      [
        path.join(root, "node_modules/convex/bin/main.js"),
        "env",
        "set",
        "VERCEL_AUTOMATION_BYPASS_SECRET",
        "--preview-name",
        "codex/edge-tts-auth-policy",
      ],
      expect.objectContaining({
        env: previewEnv,
        input: "vercel-secret-never-in-argv",
        stdio: ["pipe", "inherit", "inherit"],
      }),
    );
    expect(run).toHaveBeenNthCalledWith(
      5,
      process.execPath,
      [
        path.join(root, "node_modules/convex/bin/main.js"),
        "env",
        "set",
        "AUDIO_GENERATION_BASE_URL",
        "https://world-garden-git-voice.example.vercel.app",
        "--preview-name",
        "codex/edge-tts-auth-policy",
      ],
      expect.objectContaining({ env: previewEnv, stdio: "inherit" }),
    );

    const allArguments = run.mock.calls.flatMap(([, args]) => args);
    expect(allArguments).not.toContain("tts-secret-never-in-argv");
    expect(allArguments).not.toContain("feedback-secret-never-in-argv");
    expect(allArguments).not.toContain("vercel-secret-never-in-argv");
  });

  it("does not mutate Convex when the Next.js build fails", () => {
    const run = vi.fn(() => ({ status: 1 }));

    expect(() => runPreviewBuild({ env: previewEnv, run })).toThrow(
      "Building the Next.js Preview failed",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("stops after Next when syncing a required secret fails", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 });

    expect(() => runPreviewBuild({ env: previewEnv, run })).toThrow(
      "Configuring the Convex Preview TTS attestation secret failed",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("stops before optional configuration when the feedback secret fails to sync", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 });

    expect(() => runPreviewBuild({ env: previewEnv, run })).toThrow(
      "Configuring the Convex Preview product feedback write secret failed",
    );
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("writes the audio origin only after every required secret is synced", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 });

    expect(() => runPreviewBuild({ env: previewEnv, run })).toThrow(
      "Configuring the Convex Preview audio origin failed",
    );
    expect(run).toHaveBeenCalledTimes(5);
  });

  it("allows an unprotected Preview without a Vercel bypass secret", () => {
    const run = vi.fn(() => ({ status: 0 }));
    const env = { ...previewEnv };
    delete env.VERCEL_AUTOMATION_BYPASS_SECRET;

    runPreviewBuild({ env, run });

    expect(run).toHaveBeenCalledTimes(4);
    expect(run.mock.calls[0][1][0]).toMatch(/next\/dist\/bin\/next$/);
    expect(run.mock.calls[3][1]).toContain("AUDIO_GENERATION_BASE_URL");
  });

  it("keeps preview names as one process argument", () => {
    const run = vi.fn(() => ({ status: 0 }));
    const env = {
      ...previewEnv,
      CURIO_CONVEX_PREVIEW_NAME: "feature/voice;still-one-argument",
    };

    runPreviewBuild({ env, run });

    expect(run.mock.calls[1][1]).toContain("feature/voice;still-one-argument");
  });
});
