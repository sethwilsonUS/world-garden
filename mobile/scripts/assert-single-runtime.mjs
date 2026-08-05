import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const mobilePackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

const expectedReactVersion = mobilePackage.dependencies.react;
const expectedVersions = new Map([
  ["react", expectedReactVersion],
  ["react-dom", expectedReactVersion],
  ["react-native", mobilePackage.dependencies["react-native"]],
  [
    "react-native-gesture-handler",
    mobilePackage.dependencies["react-native-gesture-handler"],
  ],
  ["react-native-reanimated", mobilePackage.dependencies["react-native-reanimated"]],
  ["react-native-worklets", mobilePackage.dependencies["react-native-worklets"]],
]);

const npmCli = process.env.npm_execpath;
const command = npmCli === undefined ? "npm" : process.execPath;
const errors = [];
const resolvedRuntimes = [];

for (const [packageName, expectedVersion] of expectedVersions) {
  const queryArgs = ["query", `#${packageName}`, "--json"];
  const args = npmCli === undefined ? queryArgs : [npmCli, ...queryArgs];
  const result = spawnSync(command, args, {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  });

  if (result.error !== undefined) throw result.error;

  let installations;

  try {
    installations = JSON.parse(result.stdout);
  } catch (error) {
    console.error(result.stderr);
    throw new Error(`npm could not query ${packageName}`, { cause: error });
  }

  if (result.status !== 0) {
    errors.push(`npm query for ${packageName} exited with status ${result.status}`);
    continue;
  }

  const physicalPaths = new Set(
    installations.map(
      (installation) =>
        installation.realpath ?? installation.path ?? installation.location,
    ),
  );
  const versions = [...new Set(installations.map(({ version }) => version))].sort();

  if (physicalPaths.size !== 1) {
    errors.push(
      `${packageName} must have one physical installation, but found: ${[...physicalPaths].join(", ") || "none"}`,
    );
  }

  if (versions.length !== 1 || versions[0] !== expectedVersion) {
    errors.push(
      `${packageName} resolved to ${versions.join(", ") || "none"}, expected ${expectedVersion}`,
    );
  }

  if (physicalPaths.size === 1 && versions.length === 1) {
    resolvedRuntimes.push(`${packageName}@${versions[0]}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(resolvedRuntimes.join(", "));
}
