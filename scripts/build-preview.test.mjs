import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  resolvePreviewBuildConfig,
  runPreviewBuild,
} from "./build-preview.mjs";

const previewEnv = {
  VERCEL_ENV: "preview",
  VERCEL_URL: "World-Garden-Git-Voice.Example.Vercel.App",
  CURIO_CONVEX_PREVIEW_NAME: "codex/edge-tts-auth-policy",
  CONVEX_DEPLOY_KEY: "preview:curio:world-garden|secret",
  TTS_QUOTA_BYPASS_SECRET: "tts-secret-never-in-argv",
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
      "a missing TTS attestation secret",
      { ...previewEnv, TTS_QUOTA_BYPASS_SECRET: "" },
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

  it("sets the exact origin and pipes secrets into Convex before building Next", () => {
    const run = vi.fn(() => ({ status: 0 }));
    const root = "/workspace/curio";

    runPreviewBuild({ env: previewEnv, root, run });

    expect(run).toHaveBeenNthCalledWith(
      1,
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
      4,
      process.execPath,
      [path.join(root, "node_modules/next/dist/bin/next"), "build"],
      expect.objectContaining({ env: previewEnv, stdio: "inherit" }),
    );

    const allArguments = run.mock.calls.flatMap(([, args]) => args);
    expect(allArguments).not.toContain("tts-secret-never-in-argv");
    expect(allArguments).not.toContain("vercel-secret-never-in-argv");
  });

  it("does not build Next when configuring Convex fails", () => {
    const run = vi.fn(() => ({ status: 1 }));

    expect(() => runPreviewBuild({ env: previewEnv, run })).toThrow(
      "Configuring the Convex Preview audio origin failed",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not build Next when syncing a required secret fails", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 1 });

    expect(() => runPreviewBuild({ env: previewEnv, run })).toThrow(
      "Configuring the Convex Preview TTS attestation secret failed",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("allows an unprotected Preview without a Vercel bypass secret", () => {
    const run = vi.fn(() => ({ status: 0 }));
    const env = { ...previewEnv };
    delete env.VERCEL_AUTOMATION_BYPASS_SECRET;

    runPreviewBuild({ env, run });

    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[2][1][0]).toMatch(/next\/dist\/bin\/next$/);
  });

  it("keeps preview names as one process argument", () => {
    const run = vi.fn(() => ({ status: 0 }));
    const env = {
      ...previewEnv,
      CURIO_CONVEX_PREVIEW_NAME: "feature/voice;still-one-argument",
    };

    runPreviewBuild({ env, run });

    expect(run.mock.calls[0][1]).toContain("feature/voice;still-one-argument");
  });
});
