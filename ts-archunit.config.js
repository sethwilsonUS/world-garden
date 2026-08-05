/** @type {import("@nielspeter/ts-archunit").CliConfig} */
const config = {
  // The active TypeScript project is declared in arch.rules.mts.
  rules: [
    "arch.rules.mts",
    "mobile/arch.rules.mts",
    "packages/domain/arch.rules.mts",
  ],
  baseline: "arch-baseline.json",
  format: "auto",
};

module.exports = config;
