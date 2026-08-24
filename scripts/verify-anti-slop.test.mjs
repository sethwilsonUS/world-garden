import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  assertNodeRuntime,
  assertSuppressionPolicy,
} from "./verify-anti-slop.mjs";

const verifierPath = path.join(import.meta.dirname, "verify-anti-slop.mjs");
let fixtureRoot;

const writeProbe = (relativePath, source) => {
  const absolutePath = path.join(fixtureRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source);
};

const verifyFixture = () =>
  assertSuppressionPolicy({
    scanRootDirectory: fixtureRoot,
    skippedDirectoryPaths: new Set(),
  });

beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), "curio-anti-slop-verifier-"));
});

afterEach(() => {
  rmSync(fixtureRoot, { force: true, recursive: true });
});

describe("anti-slop verification", () => {
  it.each(["24.3.0", "24.15.0"])(
    "accepts supported Node runtime %s",
    (version) => {
      expect(() => assertNodeRuntime(version)).not.toThrow();
    },
  );

  it.each(["23.11.0", "24.2.9", "25.0.0"])(
    "rejects unsupported Node runtime %s",
    (version) => {
      expect(() => assertNodeRuntime(version)).toThrow(
        "Node 24.3.0 or newer within the 24.x release line",
      );
    },
  );

  it("runs the verifier when its CLI entrypoint is invoked through a symlink", () => {
    const symlinkPath = path.join(fixtureRoot, "verify-anti-slop.mjs");
    symlinkSync(verifierPath, symlinkPath);

    const result = spawnSync(process.execPath, [symlinkPath], {
      cwd: path.resolve(import.meta.dirname, ".."),
      encoding: "utf8",
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain("Anti-slop canary passed");
  });

  it("ignores suppression directives inside dependency trees at any depth", () => {
    for (const relativePath of [
      "node_modules/root-dependency/index.ts",
      "mobile/node_modules/mobile-dependency/index.ts",
      "packages/domain/node_modules/domain-dependency/index.ts",
    ]) {
      writeProbe(
        relativePath,
        "// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- dependency fixture\nvoid ({} as unknown as { value: string });\n",
      );
    }

    expect(verifyFixture).not.toThrow();
  });

  it("still rejects a suppression directive in owned malformed source", () => {
    writeProbe(
      "scripts/owned.ts",
      "const unfinished = (\n// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- owned fixture",
    );

    expect(verifyFixture).toThrow("scripts/owned.ts:2");
  });

  it("does not interpret directive-like string or template content as comments", () => {
    writeProbe(
      "scripts/owned.ts",
      'const host = "example.test";\nexport const values = ["// oxlint-disable anti-slop/no-chained-type-assertions", `https://${host}/path// oxlint-disable`];\n',
    );

    expect(verifyFixture).not.toThrow();
  });
});
