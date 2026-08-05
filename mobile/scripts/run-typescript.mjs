import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const requireFromMobile = createRequire(
  new URL("../package.json", import.meta.url),
);
const typescriptCli = requireFromMobile.resolve("typescript/bin/tsc");
const result = spawnSync(process.execPath, [typescriptCli, ...process.argv.slice(2)], {
  stdio: "inherit",
});

if (result.error !== undefined) throw result.error;

process.exitCode = result.status ?? 1;
