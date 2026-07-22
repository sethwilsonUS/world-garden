import { describe, expect, it } from "vitest";

import {
  majorVersion,
  validateToolchainVersions,
} from "./validate-toolchain.mjs";

const alignedVersions = {
  runtimeVersion: "v24.15.0",
  nvmVersion: "24",
  engineRange: "24.x",
  declaredNodeTypes: "^24.0.0",
  installedNodeTypes: "24.10.1",
};

describe("validateToolchainVersions", () => {
  it("accepts patch differences within one Node major", () => {
    expect(validateToolchainVersions(alignedVersions)).toMatchObject({
      errors: [],
      expectedMajor: 24,
    });
  });

  it("reports every source that drifts from the runtime contract", () => {
    const result = validateToolchainVersions({
      ...alignedVersions,
      runtimeVersion: "v22.15.0",
      declaredNodeTypes: "^26.1.1",
      installedNodeTypes: "26.1.1",
    });

    expect(result.errors).toEqual([
      "runtime uses major 22; expected Node 24",
      "declaredTypes uses major 26; expected Node 24",
      "installedTypes uses major 26; expected Node 24",
    ]);
  });
});

describe("majorVersion", () => {
  it("rejects version declarations without a numeric major", () => {
    expect(() => majorVersion("lts/*", ".nvmrc")).toThrow(
      ".nvmrc does not contain a major version",
    );
  });
});
