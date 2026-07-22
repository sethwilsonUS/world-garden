import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultProjectRoot = path.resolve(path.dirname(scriptPath), "..");

const readJson = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

export const majorVersion = (value, label) => {
  const match = String(value).match(/\d+/);
  if (!match) {
    throw new Error(`${label} does not contain a major version: ${value}`);
  }
  return Number.parseInt(match[0], 10);
};

export const validateToolchainVersions = ({
  runtimeVersion,
  nvmVersion,
  engineRange,
  declaredNodeTypes,
  installedNodeTypes,
}) => {
  const versions = {
    runtime: majorVersion(runtimeVersion, "Node runtime"),
    nvm: majorVersion(nvmVersion, ".nvmrc"),
    engine: majorVersion(engineRange, "engines.node"),
    declaredTypes: majorVersion(declaredNodeTypes, "declared @types/node"),
    installedTypes: majorVersion(installedNodeTypes, "installed @types/node"),
  };
  const expectedMajor = versions.nvm;
  const errors = Object.entries(versions)
    .filter(([, major]) => major !== expectedMajor)
    .map(
      ([source, major]) =>
        `${source} uses major ${major}; expected Node ${expectedMajor}`,
    );

  return { errors, expectedMajor, versions };
};

export const readToolchainVersions = async (
  projectRoot = defaultProjectRoot,
) => {
  const [packageJson, nodeTypesPackage, nvmVersion] = await Promise.all([
    readJson(path.join(projectRoot, "package.json")),
    readJson(path.join(projectRoot, "node_modules/@types/node/package.json")),
    readFile(path.join(projectRoot, ".nvmrc"), "utf8"),
  ]);

  return {
    runtimeVersion: process.version,
    nvmVersion: nvmVersion.trim(),
    engineRange: packageJson.engines?.node,
    declaredNodeTypes: packageJson.devDependencies?.["@types/node"],
    installedNodeTypes: nodeTypesPackage.version,
  };
};

const run = async () => {
  const result = validateToolchainVersions(await readToolchainVersions());
  if (result.errors.length > 0) {
    console.error("Node toolchain versions are not aligned:");
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Node ${result.expectedMajor} toolchain aligned across runtime, .nvmrc, package engine, and @types/node.`,
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  await run();
}
