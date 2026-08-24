import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const VERCEL_HOSTNAME_PATTERN =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.vercel\.app$/;
const PREVIEW_DEPLOY_KEY_PATTERN = /^preview:seth-wilson:world-garden\|\S+$/;

const assertSecretValue = (value, name, { required }) => {
  if (!value) {
    if (required) {
      throw new Error(`${name} is required for Convex Preview builds.`);
    }
    return;
  }

  if (!value.trim() || value !== value.trim()) {
    throw new Error(`${name} must be a non-empty value without padding.`);
  }
};

export const resolvePreviewBuildConfig = (env = process.env) => {
  if (env.VERCEL_ENV !== "preview") {
    throw new Error(
      "The Convex Preview build helper may only run for Vercel Preview deployments.",
    );
  }

  const previewName = env.CURIO_CONVEX_PREVIEW_NAME?.trim();
  if (!previewName) {
    throw new Error("The Convex Preview deployment name is unavailable.");
  }

  if (!PREVIEW_DEPLOY_KEY_PATTERN.test(env.CONVEX_DEPLOY_KEY ?? "")) {
    throw new Error(
      "A Convex Preview deploy key for seth-wilson/world-garden is required; refusing to select another deployment target.",
    );
  }

  assertSecretValue(env.TTS_QUOTA_BYPASS_SECRET, "TTS_QUOTA_BYPASS_SECRET", {
    required: true,
  });
  assertSecretValue(
    env.PRODUCT_FEEDBACK_WRITE_SECRET,
    "PRODUCT_FEEDBACK_WRITE_SECRET",
    { required: true },
  );
  assertSecretValue(
    env.VERCEL_AUTOMATION_BYPASS_SECRET,
    "VERCEL_AUTOMATION_BYPASS_SECRET",
    { required: false },
  );

  const deploymentHostname = env.VERCEL_URL?.trim().toLowerCase();
  if (
    !deploymentHostname ||
    !VERCEL_HOSTNAME_PATTERN.test(deploymentHostname)
  ) {
    throw new Error(
      "VERCEL_URL must be a generated *.vercel.app deployment hostname.",
    );
  }

  return {
    previewName,
    audioGenerationBaseUrl: `https://${deploymentHostname}`,
  };
};

const assertCommandSucceeded = (result, description) => {
  if (result.error) {
    throw new Error(`${description} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const suffix = result.signal ? ` (signal ${result.signal})` : "";
    throw new Error(`${description} failed${suffix}.`);
  }
};

export const runPreviewBuild = ({
  env = process.env,
  root = process.cwd(),
  run = spawnSync,
} = {}) => {
  const { previewName, audioGenerationBaseUrl } =
    resolvePreviewBuildConfig(env);
  const convexCli = path.join(root, "node_modules/convex/bin/main.js");
  const nextCli = path.join(root, "node_modules/next/dist/bin/next");
  const commandOptions = { env, stdio: "inherit" };

  const buildResult = run(
    process.execPath,
    [nextCli, "build", "--webpack"],
    commandOptions,
  );
  assertCommandSucceeded(buildResult, "Building the Next.js Preview");

  const setConvexSecret = (name, value, description) => {
    const result = run(
      process.execPath,
      [convexCli, "env", "set", name, "--preview-name", previewName],
      {
        env,
        input: value,
        stdio: ["pipe", "inherit", "inherit"],
      },
    );
    assertCommandSucceeded(result, description);
  };

  setConvexSecret(
    "TTS_QUOTA_BYPASS_SECRET",
    env.TTS_QUOTA_BYPASS_SECRET,
    "Configuring the Convex Preview TTS attestation secret",
  );

  setConvexSecret(
    "PRODUCT_FEEDBACK_WRITE_SECRET",
    env.PRODUCT_FEEDBACK_WRITE_SECRET,
    "Configuring the Convex Preview product feedback write secret",
  );

  if (env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    setConvexSecret(
      "VERCEL_AUTOMATION_BYPASS_SECRET",
      env.VERCEL_AUTOMATION_BYPASS_SECRET,
      "Configuring the Convex Preview Vercel protection secret",
    );
  }

  const configureResult = run(
    process.execPath,
    [
      convexCli,
      "env",
      "set",
      "AUDIO_GENERATION_BASE_URL",
      audioGenerationBaseUrl,
      "--preview-name",
      previewName,
    ],
    commandOptions,
  );
  assertCommandSucceeded(
    configureResult,
    "Configuring the Convex Preview audio origin",
  );
};

export const runPreviewBuildCli = ({
  args = process.argv.slice(2),
  env = process.env,
  build = runPreviewBuild,
} = {}) => {
  if (args.length === 1 && args[0] === "--check-only") {
    resolvePreviewBuildConfig(env);
    return;
  }
  if (args.length > 0) {
    throw new Error(`Unknown Preview build argument: ${args.join(" ")}`);
  }
  build({ env });
};

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  try {
    runPreviewBuildCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
